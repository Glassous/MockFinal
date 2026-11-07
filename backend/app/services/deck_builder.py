"""Deck 构建编排（P4）：规划 → 逐页 Builder 构建 → Validator 最终门禁 → 存储交付。

状态机（Plan §8.2）：
- job：pending → planning → building → done / partial / failed / canceled；
- deck：planning → building → ready / partial / failed；单页重建与取消见下；
- page：planned → building → validating → ready / failed / canceled。

硬性约束：
- **规划成功 ≠ 页面 ready**：只有 Builder 交付 bundle 且主 API 独立调用 Validator 通过后，
  页面才写 ready、bundle_key 与 current_version；
- Builder/Validator 不可用一律 fail-closed（页面不 ready，中文原因）；
- 重建（单页/整册）不重规划；旧版本在新版本成功前保持 current，失败时保留旧 ready 页面；
- 后台任务使用独立 `SessionLocal`，长 IO（Builder 轮询/Validator）期间不持有 DB session；
- 取消只由 `/api/decks/{id}/cancel` 设置 `cancel_requested` 触发，客户端断开不取消；
- 事件文本 ≤4KB、每 job ≤200 条；页面级事件按页分配预算，避免早期页面耗尽预算。
"""
import asyncio
import hashlib
import json
import logging
import time
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import SessionLocal
from ..models import (
    DeckBuildEvent,
    DeckBuildJob,
    DeckPage,
    KnowledgePoint,
    Material,
    ReviewDeck,
    Workspace,
    utcnow,
)
from . import storage
from .bundle_store import (
    BundleStoreError,
    delete_page_objects,
    save_bundle,
    save_thumbnail,
)
from .deck_planner import (
    DeckPlanningError,
    LLMNotConfiguredError,
    build_outline,
    build_page_brief,
    default_llm_call,
    plan_pages,
    resolve_source_refs,
)
from .page_builder_client import (
    PageBuilderClient,
    PageBuilderError,
    PageBuilderUnavailableError,
)
from .page_validator import (
    DEFAULT_VIEWPORTS,
    PageValidatorClient,
    PageValidatorError,
    PageValidatorUnavailableError,
)
from .sectioner import backfill_missing_sections, fetch_sections_from_db

logger = logging.getLogger(__name__)

ACTIVE_JOB_STATUSES = ("pending", "planning", "building", "validating")
MAX_EVENTS_PER_JOB = 200
MAX_EVENT_TEXT_BYTES = 4096
# 轮询 Builder 的间隔（Plan §8.4：0.5–1s）；取消标记也按该节奏检查
EVENT_POLL_INTERVAL_SECONDS = 0.6
# Builder 事件 → deck_build_events 类型映射（INTERNAL_API §3.3 / Plan §6.7）
BUILDER_EVENT_TYPE_MAP = {
    "stage": "stage",
    "text": "text",
    "tool": "tool",
    "check": "validation",
    "page_done": "stage",
    "error": "error",
    "retry": "retry",
}


# ===== 客户端工厂（测试可注入 MockTransport）=====
def make_builder_client() -> PageBuilderClient:
    """按当前配置创建 Builder 客户端；集成测试 monkeypatch 本函数注入假服务。"""
    return PageBuilderClient()


def make_validator_client() -> PageValidatorClient:
    """按当前配置创建 Validator 客户端；集成测试 monkeypatch 本函数注入假服务。"""
    return PageValidatorClient()


# ===== 进行中的 Builder 构建（用于 job 总超时时取消上游）=====
_inflight_builds: dict[int, set[str]] = {}


def _register_inflight(job_id: int, build_id: str) -> None:
    _inflight_builds.setdefault(job_id, set()).add(build_id)


def _unregister_inflight(job_id: int, build_id: str) -> None:
    build_ids = _inflight_builds.get(job_id)
    if build_ids is None:
        return
    build_ids.discard(build_id)
    if not build_ids:
        _inflight_builds.pop(job_id, None)


def _current_task_cancelling() -> bool:
    task = asyncio.current_task()
    return bool(task is not None and task.cancelling())


# ===== 纯逻辑辅助（可单测）=====
def next_page_attempt_action(attempts_done: int, max_attempts: int) -> str:
    """已完成的尝试次数 < 上限时重试，否则失败（最终校验失败专用）。"""
    return "retry" if int(attempts_done) < max(1, int(max_attempts)) else "fail"


def _page_event_budget(total_pages: int) -> int:
    """按页数分配 Builder 事件预算，保证每页都有机会写事件且总量 ≤200。"""
    reserve = 16  # 预留 job 级阶段/收尾/错误事件
    per_page = (MAX_EVENTS_PER_JOB - reserve) // max(1, int(total_pages or 1))
    return max(3, min(16, per_page))


def _json_size(payload: dict) -> int:
    return len(json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8"))


def _truncate_payload(payload: dict) -> dict:
    """把事件 payload 压到 ≤4KB（UTF-8 字节），优先截断字符串字段。"""
    if _json_size(payload) <= MAX_EVENT_TEXT_BYTES:
        return payload
    trimmed: dict[str, Any] = {}
    for key, value in payload.items():
        if isinstance(value, str):
            trimmed[key] = value[:1000] + "…" if len(value) > 1000 else value
        else:
            trimmed[key] = value
    if _json_size(trimmed) <= MAX_EVENT_TEXT_BYTES:
        return trimmed
    message = str(payload.get("message") or payload.get("text") or "")
    # 逐字节截断兜底，确保不因超长中文撑爆事件表
    encoded = message.encode("utf-8")[: MAX_EVENT_TEXT_BYTES - 64]
    safe = encoded.decode("utf-8", errors="ignore")
    return {"message": safe + "…"}


def _section_parts(section: Any) -> tuple[Any, Any, str]:
    """从 dict / Row / ORM 对象中取出 (material_id, id, content)。"""
    if isinstance(section, Mapping):
        return section.get("material_id"), section.get("id"), str(section.get("content") or "")
    if isinstance(section, (tuple, list)):
        if len(section) >= 3:
            return section[0], section[1], str(section[2] or "")
        return None, section[0] if section else None, ""
    return (
        getattr(section, "material_id", None),
        getattr(section, "id", None),
        str(getattr(section, "content", "") or ""),
    )


def compute_source_signature(sections: Iterable[Any]) -> str:
    """计算工作区资料分节的稳定签名（id + content 的 sha256）。

    输入可以是 `(material_id, id, content)` 行、带同名字段的 ORM 对象或 dict。
    排序固定为 (material_id, id)，保证与查询顺序无关。
    """
    entries: list[tuple[int, int, str]] = []
    for section in sections:
        material_id, section_id, content = _section_parts(section)
        try:
            mid = int(material_id) if material_id is not None else 0
            sid = int(section_id)
        except (TypeError, ValueError):
            continue
        entries.append((mid, sid, content))
    entries.sort(key=lambda item: (item[0], item[1]))
    digest = hashlib.sha256()
    for _, section_id, content in entries:
        digest.update(f"{section_id}\x1f{content}\x1f".encode("utf-8"))
    return digest.hexdigest()


async def workspace_source_signature(db: AsyncSession, workspace_id: int) -> str:
    """读取工作区全部分节并计算签名（请求内复用传入 session）。"""
    from ..models import MaterialSection

    rows = await db.execute(
        select(
            MaterialSection.material_id,
            MaterialSection.id,
            MaterialSection.content,
        ).where(MaterialSection.workspace_id == workspace_id)
    )
    return compute_source_signature(rows.all())


def _flatten_sections(grouped: Mapping[int, Sequence[Mapping]]) -> dict[int, dict]:
    """把 {material_id: [section...]} 展平为 {section_id: section + material_id}。"""
    flat: dict[int, dict] = {}
    for material_id, sections in grouped.items():
        for section in sections:
            section_id = int(section["id"])
            flat[section_id] = {**section, "material_id": material_id}
    return flat


def _build_material_index(
    grouped: Mapping[int, Sequence[Mapping]], filenames: Mapping[int, str]
) -> list[dict]:
    """构造大纲 prompt 的资料索引；单节正文截断到 1200 字（planner 会再次兜底）。"""
    index: list[dict] = []
    for material_id in sorted(grouped.keys()):
        sections = grouped[material_id]
        index.append(
            {
                "material_id": material_id,
                "filename": filenames.get(material_id, f"资料#{material_id}"),
                "sections": [
                    {
                        "id": int(section["id"]),
                        "heading": str(section.get("heading") or ""),
                        "text": str(section.get("content") or "")[:1200],
                    }
                    for section in sections
                ],
            }
        )
    return index


async def _append_event(
    db: AsyncSession,
    job_id: int,
    event_type: str,
    payload: dict,
    *,
    page_id: int | None = None,
) -> None:
    """写一条构建事件；超过每 job 200 条上限时丢弃并记日志。"""
    # autoflush=False：先 flush 已加入的事件，计数才包含同一事务内的上一条
    await db.flush()
    count = await db.scalar(
        select(func.count()).select_from(DeckBuildEvent).where(DeckBuildEvent.job_id == job_id)
    )
    if count is not None and count >= MAX_EVENTS_PER_JOB:
        logger.warning("构建任务 %s 事件已达 %d 条上限，丢弃 %s 事件", job_id, count, event_type)
        return
    db.add(
        DeckBuildEvent(
            job_id=job_id,
            page_id=page_id,
            type=event_type,
            payload=_truncate_payload(dict(payload or {})),
        )
    )


async def _is_cancel_requested(job_id: int) -> bool:
    async with SessionLocal() as db:
        value = await db.scalar(
            select(DeckBuildJob.cancel_requested).where(DeckBuildJob.id == job_id)
        )
    return bool(value)


async def _bump_job_counts(
    db: AsyncSession, job_id: int, *, ready: int = 0, failed: int = 0
) -> tuple[int, int, int]:
    """原子累加 job 页级计数（避免并发页面的读改写丢失），返回 (ready, failed, total)。"""
    values: dict[str, Any] = {}
    if ready:
        values["ready_pages"] = DeckBuildJob.ready_pages + ready
    if failed:
        values["failed_pages"] = DeckBuildJob.failed_pages + failed
    if values:
        await db.execute(update(DeckBuildJob).where(DeckBuildJob.id == job_id).values(**values))
    row = (
        await db.execute(
            select(
                DeckBuildJob.ready_pages,
                DeckBuildJob.failed_pages,
                DeckBuildJob.total_pages,
            ).where(DeckBuildJob.id == job_id)
        )
    ).one()
    return int(row.ready_pages or 0), int(row.failed_pages or 0), int(row.total_pages or 0)


async def _cancel_job(job_id: int, *, message: str = "任务已取消，可重新发起") -> None:
    """把活跃 job 落为 canceled（只由取消标记触发）；已就绪页面保留。"""
    async with SessionLocal() as db:
        job = await db.get(DeckBuildJob, job_id)
        if job is None or job.status not in ACTIVE_JOB_STATUSES:
            return
        job.status = "canceled"
        job.stage = "任务已取消"
        job.finished_at = utcnow()
        deck = await db.get(ReviewDeck, job.deck_id)
        if (
            deck is not None
            and job.target_page_id is None
            and deck.status in ("planning", "building")
        ):
            deck.status = "canceled"
        await _append_event(db, job_id, "error", {"message": message})
        await db.commit()
        logger.info("构建任务 %s 已取消", job_id)


async def _fail_job(job_id: int, error: str, *, stage: str = "构建失败") -> None:
    """把 job 落为 failed，并写中文错误事件；已终态的任务不覆盖。"""
    message = (error or "构建失败，请稍后重试").strip()[:2000]
    async with SessionLocal() as db:
        job = await db.get(DeckBuildJob, job_id)
        if job is None:
            return
        if job.status not in ACTIVE_JOB_STATUSES:
            return
        job.status = "failed"
        job.stage = stage
        job.error = message
        job.finished_at = utcnow()
        deck = await db.get(ReviewDeck, job.deck_id)
        if deck is not None and deck.status in ("draft", "planning", "building"):
            rows = await db.execute(
                select(DeckPage.status, DeckPage.bundle_key).where(DeckPage.deck_id == deck.id)
            )
            usable = sum(1 for status, key in rows.all() if status == "ready" and key)
            deck.status = "partial" if usable else "failed"
        await _append_event(db, job_id, "error", {"message": message})
        await db.commit()
        logger.warning("构建任务 %s 失败：%s", job_id, message)


def _friendly_error(exc: Exception) -> str:
    if isinstance(
        exc,
        (
            DeckPlanningError,
            LLMNotConfiguredError,
            PageBuilderError,
            PageValidatorError,
            BundleStoreError,
            ValueError,
        ),
    ):
        return str(exc)
    name = type(exc).__name__
    detail = str(exc)[:200]
    return f"构建失败（{name}）：{detail}" if detail else f"构建失败（{name}）"


def _attach_source_refs(outline: dict, sections: Mapping[int, Mapping]) -> int:
    """为每个知识点解析 source_refs，返回 unverified 的知识点数量。"""
    unverified_count = 0
    for chapter in outline.get("chapters", []):
        for kp in chapter.get("knowledge_points", []):
            keywords = [str(kp.get("title") or "")]
            keywords.extend(str(item) for item in (kp.get("key_points") or [])[:5])
            keywords.extend(str(item) for item in (kp.get("objectives") or [])[:3])
            refs, unverified = resolve_source_refs(
                kp.get("section_ids") or [], sections, keywords=keywords
            )
            kp["source_refs"] = refs
            kp["source_unverified"] = unverified
            if unverified:
                unverified_count += 1
    return unverified_count


# ===== 构建上下文与结果 =====
@dataclass
class _PageRef:
    """构建期使用的页面快照（不持有 ORM 对象，避免跨 session 使用）。"""

    id: int
    ordinal: int
    title: str
    kind: str


@dataclass
class _BuildContext:
    job_id: int
    deck_id: int
    workspace_id: int
    user_id: int
    total_pages: int = 0
    target_page_id: int | None = None
    feedback: str | None = None


@dataclass
class _PageOutcome:
    status: str  # ready / retry / failed / canceled / aborted
    message: str = ""
    feedback: str | None = None
    validation: dict | None = None


# ===== 后台任务入口 =====
async def run_deck_build_job(job_id: int, *, replan: bool = False) -> None:
    """后台构建任务入口（fire-and-forget，任何异常都不得外溢到事件循环）。

    - 首次构建/重新规划：大纲规划后逐页真实构建；
    - 整册重建（rebuild_all）与单页重建：不重新规划，直接重建页面新版本；
    - 总超时 `deck_job_timeout_seconds`：取消 Builder、未完成页面落失败、job failed。
    """
    try:
        await asyncio.wait_for(
            _run(job_id, replan=replan),
            timeout=max(30, int(settings.deck_job_timeout_seconds)),
        )
    except TimeoutError:
        await _fail_job_timeout(job_id)
        return
    except asyncio.CancelledError:
        await _fail_job(job_id, "服务停止导致构建任务中断，请重新发起", stage="构建中断")
        raise
    except Exception as exc:  # noqa: BLE001 —— 后台任务必须兜底落库
        logger.exception("构建任务 %s 异常", job_id)
        await _fail_job(job_id, _friendly_error(exc))


async def _fail_job_timeout(job_id: int) -> None:
    """job 总超时：先 best-effort 取消 Builder 进行中的构建，再落失败与页面终态。"""
    build_ids = list(_inflight_builds.get(job_id) or ())
    _inflight_builds.pop(job_id, None)
    if build_ids:
        builder = make_builder_client()
        for build_id in build_ids:
            try:
                await builder.cancel_build(build_id)
            except Exception:  # noqa: BLE001 —— 超时清理失败不阻断落库
                logger.warning("取消 Builder 构建失败（已忽略）：%s", build_id, exc_info=True)
    timeout_minutes = max(1, int(settings.deck_job_timeout_seconds) // 60)
    message = (
        f"构建任务超过总时长限制（{timeout_minutes} 分钟）已终止，"
        "未完成页面已标记失败；可重试或拆分知识点后重新构建"
    )
    async with SessionLocal() as db:
        job = await db.get(DeckBuildJob, job_id)
        if job is None or job.status not in ACTIVE_JOB_STATUSES:
            return
        pages = (
            await db.execute(select(DeckPage).where(DeckPage.deck_id == job.deck_id))
        ).scalars().all()
        for page in pages:
            if page.status in ("planned", "building", "validating"):
                # 有旧 bundle 的重建页面保留 ready，避免不可读
                page.status = "ready" if page.bundle_key else "failed"
        job.status = "failed"
        job.stage = "构建超时"
        job.error = message
        job.finished_at = utcnow()
        deck = await db.get(ReviewDeck, job.deck_id)
        if (
            deck is not None
            and job.target_page_id is None
            and deck.status in ("planning", "building")
        ):
            usable = sum(1 for page in pages if page.status == "ready" and page.bundle_key)
            deck.status = "partial" if usable else "failed"
        await _append_event(db, job_id, "error", {"message": message})
        await db.commit()
        logger.warning("构建任务 %s 超过总时长限制，已终止", job_id)


async def _run(job_id: int, *, replan: bool) -> None:
    # ===== 步骤 1：读取任务/Deck/工作区，确定执行模式 =====
    async with SessionLocal() as db:
        job = await db.get(DeckBuildJob, job_id)
        if job is None:
            logger.warning("构建任务 %s 不存在（可能已随 Deck 删除）", job_id)
            return
        if job.status not in ("pending", "planning"):
            logger.info("构建任务 %s 当前状态 %s，跳过执行", job_id, job.status)
            return
        if job.cancel_requested:
            await _cancel_job(job_id, message="任务已取消")
            return

        deck = await db.get(ReviewDeck, job.deck_id)
        if deck is None:
            job.status = "failed"
            job.stage = "构建失败"
            job.error = "复习页不存在或已被删除"
            job.finished_at = utcnow()
            await _append_event(db, job_id, "error", {"message": job.error})
            await db.commit()
            return
        workspace = await db.get(Workspace, deck.workspace_id)
        if workspace is None:
            job.status = "failed"
            job.stage = "构建失败"
            job.error = "工作区不存在或已被删除"
            job.finished_at = utcnow()
            deck.status = "failed"
            await _append_event(db, job_id, "error", {"message": job.error})
            await db.commit()
            return

        page_count = int(
            await db.scalar(
                select(func.count()).select_from(DeckPage).where(DeckPage.deck_id == deck.id)
            )
            or 0
        )
        if job.target_page_id:
            mode = "single"
        elif page_count and not replan:
            mode = "rebuild"
        else:
            mode = "plan"

        ctx = _BuildContext(
            job_id=job_id,
            deck_id=deck.id,
            workspace_id=workspace.id,
            user_id=workspace.user_id,
            total_pages=0,
            target_page_id=job.target_page_id,
            feedback=(job.feedback or "").strip() or None,
        )

        job.started_at = job.started_at or utcnow()
        if mode == "plan":
            job.status = "planning"
            job.stage = "正在读取资料分节…"
            job.progress = 5
            deck.status = "planning"
        else:
            job.status = "building"
            job.progress = 1
            job.ready_pages = 0
            job.failed_pages = 0
            if mode == "single":
                job.total_pages = 1
                job.stage = "正在准备重建页面…"
            else:
                job.total_pages = page_count
                job.stage = f"正在准备逐页重建 {page_count} 个页面…"
                deck.status = "building"
        await _append_event(db, job_id, "stage", {"text": job.stage})
        await db.commit()

        workspace_name = workspace.name
        workspace_description = workspace.description
        deck_density = str((deck.style or {}).get("density") or "standard")

    # ===== 步骤 2：规划（仅首次构建/重新规划）=====
    if mode == "plan":
        planned = await _plan_and_create_pages(
            ctx, workspace_name, workspace_description, deck_density, replan=replan
        )
        if not planned:
            return

    # ===== 步骤 3：读取页面快照与 Page Brief =====
    pages = await _load_pages(ctx, mode)
    if pages is None:
        return
    ctx.total_pages = len(pages)

    briefs = await build_page_briefs(ctx.deck_id, page_ids=[page.id for page in pages])
    brief_map: dict[int, dict] = {}
    for brief in briefs:
        page_id_text = str(brief.get("page_id") or "")
        if page_id_text.startswith("page_"):
            try:
                brief_map[int(page_id_text.removeprefix("page_"))] = brief
            except ValueError:
                continue

    # ===== 步骤 4：并发构建页面（默认 2）=====
    failures = await _build_pages(ctx, pages, brief_map, rebuild=(mode != "plan"))
    canceled = await _is_cancel_requested(ctx.job_id)
    await _finalize(ctx, mode, failures, canceled=canceled)


async def _plan_and_create_pages(
    ctx: _BuildContext,
    workspace_name: str,
    workspace_description: str,
    deck_density: str,
    *,
    replan: bool,
) -> bool:
    """执行大纲规划并写入知识点/页面，随后把 job 切到 building。"""
    failed_backfill = await backfill_missing_sections(ctx.workspace_id)
    grouped = await fetch_sections_from_db(ctx.workspace_id)
    if not grouped:
        detail = "当前工作区没有可用于规划的资料分节，请先上传资料并等待解析完成"
        if failed_backfill:
            detail = f"以下资料尚未完成解析分节，无法规划：{'、'.join(failed_backfill)}"
        await _fail_job(ctx.job_id, detail, stage="规划失败")
        return False

    flat_sections = _flatten_sections(grouped)
    signature = compute_source_signature(flat_sections.values())

    async with SessionLocal() as db:
        rows = await db.execute(
            select(Material.id, Material.filename).where(Material.id.in_(list(grouped.keys())))
        )
        filenames = {material_id: filename for material_id, filename in rows.all()}

    material_index = _build_material_index(grouped, filenames)
    section_count = len(flat_sections)

    async with SessionLocal() as db:
        job = await db.get(DeckBuildJob, ctx.job_id)
        if job is None:
            return False
        if job.cancel_requested:
            await _cancel_job(ctx.job_id)
            return False
        job.stage = f"已读取 {len(grouped)} 份资料 / {section_count} 个分节，正在调用 LLM 规划大纲…"
        job.progress = 20
        await _append_event(db, ctx.job_id, "stage", {"text": job.stage})
        await db.commit()

    # LLM 规划期间不持有 DB session
    outline = await build_outline(
        default_llm_call, workspace_name, workspace_description, material_index
    )
    unverified_count = _attach_source_refs(outline, flat_sections)
    plans = plan_pages(outline["chapters"], deck_density)

    if await _is_cancel_requested(ctx.job_id):
        await _cancel_job(ctx.job_id)
        return False

    old_storage_keys: list[str] = []
    async with SessionLocal() as db:
        job = await db.get(DeckBuildJob, ctx.job_id)
        if job is None:
            return False
        if job.cancel_requested:
            await _cancel_job(ctx.job_id)
            return False
        deck = await db.get(ReviewDeck, ctx.deck_id)
        if deck is None:
            job.status = "failed"
            job.stage = "规划失败"
            job.error = "复习页不存在或已被删除"
            job.finished_at = utcnow()
            await _append_event(db, ctx.job_id, "error", {"message": job.error})
            await db.commit()
            return False

        existing_pages = int(
            await db.scalar(
                select(func.count()).select_from(DeckPage).where(DeckPage.deck_id == ctx.deck_id)
            )
            or 0
        )
        if existing_pages and not replan:
            # 路由层已拦截；这里兜底，避免重复规划覆盖已有页面
            job.status = "failed"
            job.stage = "规划失败"
            job.error = "当前复习页已有页面计划，未允许重新规划"
            job.finished_at = utcnow()
            deck.status = "failed"
            await _append_event(db, ctx.job_id, "error", {"message": job.error})
            await db.commit()
            return False

        if replan:
            old_rows = await db.execute(
                select(DeckPage.bundle_key, DeckPage.thumbnail_key).where(
                    DeckPage.deck_id == ctx.deck_id
                )
            )
            old_storage_keys = [key for row in old_rows.all() for key in row if key]
            await db.execute(delete(DeckPage).where(DeckPage.deck_id == ctx.deck_id))
            await db.execute(delete(KnowledgePoint).where(KnowledgePoint.deck_id == ctx.deck_id))

        leaf_ids: list[int] = []
        for chapter_index, chapter in enumerate(outline["chapters"]):
            chapter_row = KnowledgePoint(
                deck_id=ctx.deck_id,
                parent_id=None,
                ordinal=chapter_index,
                title=str(chapter.get("title") or f"章节 {chapter_index + 1}")[:255],
                summary="",
                importance="normal",
                difficulty="medium",
                objectives=[],
                key_points=[],
                formulas=[],
                misconceptions=[],
                source_refs=[],
                interaction_idea="",
            )
            db.add(chapter_row)
            await db.flush()
            for kp_index, kp in enumerate(chapter.get("knowledge_points", [])):
                row = KnowledgePoint(
                    deck_id=ctx.deck_id,
                    parent_id=chapter_row.id,
                    ordinal=kp_index,
                    title=str(kp.get("title") or f"知识点 {kp_index + 1}")[:255],
                    summary=str(kp.get("summary") or ""),
                    importance=str(kp.get("importance") or "normal"),
                    difficulty=str(kp.get("difficulty") or "medium"),
                    objectives=list(kp.get("objectives") or []),
                    key_points=list(kp.get("key_points") or []),
                    formulas=list(kp.get("formulas") or []),
                    misconceptions=list(kp.get("misconceptions") or []),
                    source_refs=list(kp.get("source_refs") or []),
                    interaction_idea=str(kp.get("interaction_idea") or ""),
                )
                db.add(row)
                await db.flush()
                leaf_ids.append(row.id)

        created_pages: list[DeckPage] = []
        for plan in plans:
            indices = [int(index) for index in plan["kp_indices"]]
            page_kp_ids = [leaf_ids[index] for index in indices if 0 <= index < len(leaf_ids)]
            if not page_kp_ids:
                continue
            primary_index = int(plan["primary_kp_index"])
            primary_id = (
                leaf_ids[primary_index] if 0 <= primary_index < len(leaf_ids) else page_kp_ids[0]
            )
            page = DeckPage(
                deck_id=ctx.deck_id,
                knowledge_point_ids=page_kp_ids,
                primary_knowledge_point_id=primary_id,
                ordinal=int(plan["ordinal"]),
                title=str(plan.get("title") or "未命名页面")[:255],
                kind=str(plan.get("kind") or "concept"),
                status="planned",
                current_version=0,
                manifest={},
                validation={},
                build_attempts=0,
            )
            db.add(page)
            created_pages.append(page)

        if not created_pages:
            job.status = "failed"
            job.stage = "规划失败"
            job.error = "页面计划为空，无法开始构建"
            job.finished_at = utcnow()
            deck.status = "failed"
            await _append_event(db, ctx.job_id, "error", {"message": job.error})
            await db.commit()
            return False

        deck.outline = {
            "chapters": outline["chapters"],
            "page_plan": plans,
            "density": deck_density,
            "source_signature": signature,
            "generated_at": utcnow().isoformat(),
            "unverified_knowledge_points": unverified_count,
        }
        deck.source_signature = signature
        deck.status = "building"
        ctx.total_pages = len(created_pages)

        job.status = "building"
        job.total_pages = len(created_pages)
        job.ready_pages = 0
        job.failed_pages = 0
        job.progress = 5
        job.stage = f"规划完成：{len(created_pages)} 个页面计划，开始逐页构建…"
        chapter_count = len(outline["chapters"])
        kp_count = sum(len(chapter.get("knowledge_points", [])) for chapter in outline["chapters"])
        summary = (
            f"规划完成：{chapter_count} 章、{kp_count} 个知识点、"
            f"{len(created_pages)} 个页面计划；开始调用页面构建服务。"
        )
        if unverified_count:
            summary += f" 其中 {unverified_count} 个知识点未能可靠引用资料，已标记 unverified。"
        await _append_event(db, ctx.job_id, "text", {"message": summary})
        await _append_event(db, ctx.job_id, "stage", {"text": job.stage})
        await db.commit()
        logger.info("构建任务 %s 规划完成：%d 个页面计划", ctx.job_id, len(created_pages))

    # 旧版本（重新规划前）的对象 best-effort 清理，不阻断新构建
    for key in old_storage_keys:
        try:
            await storage.delete(key)
        except Exception:  # noqa: BLE001 —— 外部清理失败不得阻断构建
            logger.warning("清理旧页面存储对象失败（已忽略）：%s", key, exc_info=True)
    return True


async def _load_pages(ctx: _BuildContext, mode: str) -> list[_PageRef] | None:
    """读取本次任务要处理的页面快照；页面缺失时把 job 落失败。"""
    async with SessionLocal() as db:
        if mode == "single":
            page = await db.get(DeckPage, int(ctx.target_page_id or 0))
            if page is None or page.deck_id != ctx.deck_id:
                await _fail_job(ctx.job_id, "要重建的页面不存在或已被删除", stage="构建失败")
                return None
            rows = [page]
        else:
            rows = list(
                (
                    await db.execute(
                        select(DeckPage)
                        .where(DeckPage.deck_id == ctx.deck_id)
                        .order_by(DeckPage.ordinal, DeckPage.id)
                    )
                )
                .scalars()
                .all()
            )
        if not rows:
            await _fail_job(ctx.job_id, "当前复习页没有可构建的页面，请先完成规划", stage="构建失败")
            return None
        if mode == "single":
            job = await db.get(DeckBuildJob, ctx.job_id)
            if job is not None and int(job.total_pages or 0) != 1:
                job.total_pages = 1
                await db.commit()
        return [
            _PageRef(id=page.id, ordinal=page.ordinal, title=page.title, kind=page.kind)
            for page in rows
        ]


async def _build_pages(
    ctx: _BuildContext,
    pages: list[_PageRef],
    brief_map: Mapping[int, dict],
    *,
    rebuild: bool,
) -> list[tuple[str, str]]:
    """按 page_builder_concurrency 并发构建页面；单页失败不影响其他页。"""
    semaphore = asyncio.Semaphore(max(1, int(settings.page_builder_concurrency)))
    failures: list[tuple[str, str]] = []

    async def worker(page: _PageRef) -> None:
        async with semaphore:
            if await _is_cancel_requested(ctx.job_id):
                await _cancel_page(ctx, page)
                return
            brief = brief_map.get(page.id)
            if brief is None:
                message = "页面缺少知识点关联，无法组装构建 brief，请重新规划该知识点"
                await _commit_page_failure(ctx, page, message)
                failures.append((page.title, message))
                return
            try:
                outcome = await _build_one_page(ctx, page, brief, rebuild=rebuild)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 —— 单页异常不得阻断其他页
                logger.exception("页面 %s 构建异常", page.id)
                message = "页面构建发生内部错误，请稍后重试"
                await _commit_page_failure(ctx, page, message)
                failures.append((page.title, message))
                return
            if outcome.status == "failed":
                failures.append((page.title, outcome.message))

    if not pages:
        return failures
    await asyncio.gather(*(worker(page) for page in pages))
    return failures


async def _build_one_page(
    ctx: _BuildContext, page: _PageRef, brief: dict, *, rebuild: bool
) -> _PageOutcome:
    """单页构建（含最终校验失败重试）；返回终态结果。"""
    max_attempts = max(1, int(settings.deck_page_max_attempts))
    feedback = ctx.feedback if (rebuild and ctx.target_page_id == page.id) else None
    attempts_done = 0
    started = time.monotonic()

    def log_outcome(status: str, *, error: str | None = None) -> None:
        logger.log(
            logging.INFO if status == "ready" else logging.WARNING,
            "page_build status=%s deck_id=%s job_id=%s page_id=%s attempts=%s "
            "duration_ms=%s error=%s",
            status,
            ctx.deck_id,
            ctx.job_id,
            page.id,
            attempts_done,
            int((time.monotonic() - started) * 1000),
            error or "",
        )

    while True:
        if await _is_cancel_requested(ctx.job_id):
            await _cancel_page(ctx, page)
            return _PageOutcome("canceled", "任务已取消")
        attempt_no = await _begin_page_attempt(ctx, page)
        if attempt_no is None:
            return _PageOutcome("aborted")
        attempts_done += 1

        try:
            outcome = await asyncio.wait_for(
                _attempt_page(ctx, page, brief, feedback, attempt_no),
                timeout=float(
                    settings.page_builder_timeout_seconds
                    + settings.page_validator_timeout_seconds
                ),
            )
        except TimeoutError:
            outcome = _PageOutcome(
                "failed",
                "页面构建或校验超时（已超过单页时间上限），请稍后重试或拆分该页知识点",
            )
        except PageBuilderUnavailableError as exc:
            outcome = _PageOutcome("failed", str(exc) or "页面构建服务暂不可用，请稍后重试")
        except PageValidatorUnavailableError as exc:
            outcome = _PageOutcome(
                "failed", str(exc) or "页面校验服务暂不可用，页面未放行（fail-closed），请稍后重试"
            )
        except (PageBuilderError, PageValidatorError, BundleStoreError) as exc:
            outcome = _PageOutcome("failed", str(exc) or "页面构建/校验失败，请稍后重试")
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 —— 单页兜底，绝不把异常外溢到 gather
            logger.exception("页面 %s 构建过程异常", page.id)
            outcome = _PageOutcome("failed", "页面构建发生内部错误，请稍后重试")

        if outcome.status in ("ready", "aborted"):
            if outcome.status == "ready":
                log_outcome("ready")
            return outcome
        if outcome.status == "canceled":
            await _cancel_page(ctx, page)
            log_outcome("canceled")
            return outcome
        if outcome.status == "retry":
            if next_page_attempt_action(attempts_done, max_attempts) == "retry":
                feedback = outcome.feedback
                await _record_retry_event(ctx, page, attempts_done, max_attempts, outcome.message)
                continue
            message = (
                f"{outcome.message}；已尝试 {attempts_done} 次，"
                "建议精简页面内容或拆分知识点后重新构建"
            )
            await _commit_page_failure(ctx, page, message, validation=outcome.validation)
            log_outcome("failed", error=message)
            return _PageOutcome("failed", message, validation=outcome.validation)

        await _commit_page_failure(ctx, page, outcome.message, validation=outcome.validation)
        log_outcome("failed", error=outcome.message)
        return outcome


# ===== 单页构建流程 =====
async def _attempt_page(
    ctx: _BuildContext,
    page: _PageRef,
    brief: dict,
    feedback: str | None,
    attempt_no: int,
) -> _PageOutcome:
    """一次尝试：创建 Builder 构建 → 轮询事件 → 取 bundle → Validator 门禁 → 保存/落库。"""
    builder = make_builder_client()
    build_id = f"bld_{page.id}_v{int(attempt_no)}_{uuid.uuid4().hex[:8]}"
    _register_inflight(ctx.job_id, build_id)
    try:
        await builder.create_build(
            build_id,
            brief,
            feedback=feedback,
            timeout=settings.page_builder_timeout_seconds,
        )

        after_seq = 0
        mirror_state = {
            "count": 0,
            "text": 0,
            "budget": _page_event_budget(ctx.total_pages),
        }
        while True:
            if await _is_cancel_requested(ctx.job_id):
                await _cancel_builder_build(builder, build_id)
                return _PageOutcome("canceled", "任务已取消")
            snapshot = await builder.get_build(build_id)
            events_payload = await builder.get_events(build_id, after_seq)
            after_seq = int(events_payload.get("next_seq") or after_seq)
            await _mirror_builder_events(ctx, page, events_payload.get("events") or [], mirror_state)

            status = str(snapshot.get("status") or "")
            if status == "succeeded":
                break
            if status in ("failed", "canceled"):
                message = str(snapshot.get("error") or "").strip()
                if status == "canceled":
                    message = "页面构建被上游取消，请稍后重试"
                return _PageOutcome("failed", message or "页面构建失败，请稍后重试")
            await asyncio.sleep(EVENT_POLL_INTERVAL_SECONDS)

        bundle_payload = await builder.get_bundle(build_id)
        bundle = bundle_payload.get("bundle")
        if not isinstance(bundle, dict):
            return _PageOutcome("failed", "页面构建服务未返回有效 bundle，请稍后重试")

        if not await _set_page_validating(ctx, page):
            return _PageOutcome("aborted")

        validator = make_validator_client()
        report = await validator.validate(bundle, viewports=None, screenshot=True)
        summary = _validation_summary(report)
        if report["status"] == "failed":
            return _PageOutcome(
                "retry",
                message=_report_issue_message(report),
                feedback=_feedback_from_report(report),
                validation=summary,
            )

        version = await _next_page_version(page.id)
        if version is None:
            return _PageOutcome("aborted")
        bundle_key = await save_bundle(
            user_id=ctx.user_id,
            workspace_id=ctx.workspace_id,
            deck_id=ctx.deck_id,
            page_id=page.id,
            version=version,
            bundle=bundle,
        )
        thumbnail_key: str | None = None
        screenshots = report.get("screenshots") or []
        if screenshots:
            try:
                thumbnail_key = await save_thumbnail(
                    user_id=ctx.user_id,
                    workspace_id=ctx.workspace_id,
                    deck_id=ctx.deck_id,
                    page_id=page.id,
                    version=version,
                    image=screenshots[0].get("data_uri", ""),
                )
            except Exception:  # noqa: BLE001 —— 缩略图失败不影响页面交付
                logger.warning("保存页面缩略图失败（已忽略）：page_id=%s", page.id, exc_info=True)

        committed = await _commit_page_ready(
            ctx, page, build_id, bundle, bundle_key, thumbnail_key, summary
        )
        if not committed:
            # 页面/job 已被删除：清理刚写入的对象，避免孤儿数据
            await delete_page_objects(bundle_key, thumbnail_key)
            return _PageOutcome("aborted")
        return _PageOutcome("ready", validation=summary)
    finally:
        # job 总超时/任务取消时保留登记，由 _fail_job_timeout 统一取消 Builder
        if not _current_task_cancelling():
            _unregister_inflight(ctx.job_id, build_id)


async def _cancel_builder_build(builder: PageBuilderClient, build_id: str) -> None:
    try:
        await builder.cancel_build(build_id)
    except Exception:  # noqa: BLE001 —— 取消是 best-effort，不得阻断本地落库
        logger.warning("取消 Builder 构建失败（已忽略）：%s", build_id, exc_info=True)


def _event_text(payload: Any) -> str:
    """从 Builder 事件 payload 中提取可展示文本（不含隐藏推理）。"""
    if isinstance(payload, dict):
        for key in ("text", "message", "detail"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        name = payload.get("name") or payload.get("tool")
        if isinstance(name, str) and name.strip():
            return name.strip()
        try:
            return json.dumps(payload, ensure_ascii=False)[:1200]
        except (TypeError, ValueError):
            return ""
    return str(payload or "")[:1200]


async def _mirror_builder_events(
    ctx: _BuildContext,
    page: _PageRef,
    events: Sequence[Mapping],
    state: dict,
) -> None:
    """把 Builder 事件转写为 deck_build_events（带 page_id，按页预算限流）。"""
    if not events:
        return
    pending: list[tuple[str, dict]] = []
    for event in events:
        source_type = str(event.get("type") or "")
        event_type = BUILDER_EVENT_TYPE_MAP.get(source_type)
        if event_type is None:
            continue
        if event_type == "text":
            # 文本增量只保留少量，避免刷屏并挤占阶段/校验事件
            if state["text"] >= max(3, state["budget"] // 2):
                continue
            state["text"] += 1
        if state["count"] >= state["budget"]:
            continue
        state["count"] += 1
        pending.append(
            (
                event_type,
                {
                    "page_id": page.id,
                    "text": _event_text(event.get("payload"))[:1200],
                    "builder_seq": int(event.get("seq") or 0),
                },
            )
        )
    if not pending:
        return
    async with SessionLocal() as db:
        job = await db.get(DeckBuildJob, ctx.job_id)
        if job is None:
            return
        for event_type, payload in pending:
            await _append_event(db, ctx.job_id, event_type, payload, page_id=page.id)
        await db.commit()


# ===== 页面状态落库 =====
async def _begin_page_attempt(ctx: _BuildContext, page: _PageRef) -> int | None:
    """标记页面 building / 尝试次数 +1，写阶段事件；页面被删除时返回 None。"""
    async with SessionLocal() as db:
        job = await db.get(DeckBuildJob, ctx.job_id)
        row = await db.get(DeckPage, page.id)
        if job is None or row is None:
            return None
        if job.cancel_requested:
            return None
        row.build_attempts = int(row.build_attempts or 0) + 1
        attempt_no = row.build_attempts
        # 重建时旧版本仍可读：有 bundle 的页面保持 ready，直到新版本成功
        if not row.bundle_key:
            row.status = "building"
        job.stage = f"正在构建第 {page.ordinal + 1}/{ctx.total_pages} 页：{page.title}"
        stage = job.stage
        await _append_event(
            db,
            ctx.job_id,
            "stage",
            {"text": stage, "page_id": page.id, "attempt": attempt_no},
            page_id=page.id,
        )
        await db.commit()
        return attempt_no


async def _set_page_validating(ctx: _BuildContext, page: _PageRef) -> bool:
    """Builder 成功后标记 validating（仅无旧 bundle 的页面），并更新阶段文案。"""
    async with SessionLocal() as db:
        job = await db.get(DeckBuildJob, ctx.job_id)
        row = await db.get(DeckPage, page.id)
        if job is None or row is None:
            return False
        if not row.bundle_key:
            row.status = "validating"
        job.stage = f"正在最终校验第 {page.ordinal + 1}/{ctx.total_pages} 页：{page.title}"
        await db.commit()
        return True


async def _next_page_version(page_id: int) -> int | None:
    async with SessionLocal() as db:
        page = await db.get(DeckPage, page_id)
        if page is None:
            return None
        return int(page.current_version or 0) + 1


async def _commit_page_ready(
    ctx: _BuildContext,
    page: _PageRef,
    build_id: str,
    bundle: dict,
    bundle_key: str,
    thumbnail_key: str | None,
    summary: dict,
) -> bool:
    """新版本成功后才切换 current_version/bundle_key，保证旧版本在失败时仍可读。"""
    async with SessionLocal() as db:
        job = await db.get(DeckBuildJob, ctx.job_id)
        row = await db.get(DeckPage, page.id)
        if job is None or row is None:
            return False
        version = int(row.current_version or 0) + 1
        manifest = bundle.get("manifest")
        row.current_version = version
        row.bundle_key = bundle_key
        row.thumbnail_key = thumbnail_key
        row.manifest = manifest if isinstance(manifest, dict) else {}
        row.validation = summary
        row.status = "ready"
        row.builder_build_id = build_id
        ready, failed, total = await _bump_job_counts(db, ctx.job_id, ready=1)
        progress = min(99, int(((ready + failed) / max(1, total)) * 100))
        job.stage = f"已完成第 {page.ordinal + 1}/{ctx.total_pages} 页：{page.title}"
        job.progress = progress
        await _append_event(
            db,
            ctx.job_id,
            "page_ready",
            {
                "page_id": page.id,
                "title": page.title,
                "version": version,
                "validation_status": summary.get("status"),
                "issue_count": summary.get("issue_count", 0),
            },
            page_id=page.id,
        )
        await _append_event(
            db,
            ctx.job_id,
            "validation",
            {
                "page_id": page.id,
                "status": summary.get("status"),
                "issue_count": summary.get("issue_count", 0),
                "duration_ms": summary.get("duration_ms", 0),
            },
            page_id=page.id,
        )
        await db.commit()
        return True


async def _commit_page_failure(
    ctx: _BuildContext,
    page: _PageRef,
    message: str,
    *,
    validation: dict | None = None,
) -> None:
    """页面失败落库：无旧 bundle 才标 failed；旧版本保持 ready 与可读。"""
    async with SessionLocal() as db:
        job = await db.get(DeckBuildJob, ctx.job_id)
        row = await db.get(DeckPage, page.id)
        if job is None or row is None:
            return
        if not row.bundle_key:
            row.status = "failed"
        if validation:
            row.validation = validation
        ready, failed, total = await _bump_job_counts(db, ctx.job_id, failed=1)
        progress = min(99, int(((ready + failed) / max(1, total)) * 100))
        job.stage = f"第 {page.ordinal + 1}/{ctx.total_pages} 页构建失败：{page.title}"
        job.progress = progress
        await _append_event(
            db,
            ctx.job_id,
            "error",
            {
                "page_id": page.id,
                "title": page.title,
                "message": (message or "页面构建失败，请稍后重试")[:1500],
            },
            page_id=page.id,
        )
        await db.commit()


async def _cancel_page(ctx: _BuildContext, page: _PageRef) -> None:
    """取消页面：无旧版本 → canceled；有旧版本 → 保持 ready 可读。"""
    async with SessionLocal() as db:
        row = await db.get(DeckPage, page.id)
        if row is None:
            return
        row.status = "ready" if row.bundle_key else "canceled"
        await db.commit()


async def _record_retry_event(
    ctx: _BuildContext,
    page: _PageRef,
    attempts_done: int,
    max_attempts: int,
    message: str,
) -> None:
    async with SessionLocal() as db:
        job = await db.get(DeckBuildJob, ctx.job_id)
        if job is None:
            return
        next_attempt = attempts_done + 1
        job.stage = f"第 {next_attempt}/{max_attempts} 次尝试：{page.title}（根据校验问题修复）"
        stage = job.stage
        await _append_event(
            db,
            ctx.job_id,
            "retry",
            {
                "page_id": page.id,
                "message": (message or "最终校验未通过，正在重试")[:1000],
                "attempt": next_attempt,
                "max_attempts": max_attempts,
            },
            page_id=page.id,
        )
        await _append_event(
            db, ctx.job_id, "stage", {"text": stage, "page_id": page.id}, page_id=page.id
        )
        await db.commit()


def _validation_summary(report: dict) -> dict:
    """页面 validation 摘要：状态、问题数、至多 20 条问题、耗时与检查视口。"""
    issues = report.get("issues") or []
    return {
        "status": report.get("status"),
        "issue_count": len(issues),
        "issues": issues[:20],
        "duration_ms": int(report.get("duration_ms") or 0),
        "viewports": [f"{width}x{height}" for width, height in DEFAULT_VIEWPORTS],
        "checked_at": utcnow().isoformat(),
    }


def _report_issue_message(report: dict) -> str:
    errors = [item for item in report.get("issues") or [] if item.get("severity") == "error"]
    if not errors:
        errors = list(report.get("issues") or [])
    codes = sorted({str(item.get("code") or "UNKNOWN") for item in errors})[:4]
    code_text = "、".join(codes) if codes else "未通过最终校验"
    return f"页面未通过最终校验（{len(errors)} 个问题：{code_text}）"


def _feedback_from_report(report: dict) -> str:
    """把校验问题整理成重试 feedback（≤2000 字），只带结构化问题，不重灌资料。"""
    lines = ["上一版页面未通过最终校验，请修复以下问题后重新生成整页："]
    for issue in (report.get("issues") or [])[:8]:
        location: list[str] = []
        if issue.get("viewport"):
            location.append(f"视口 {issue['viewport']}")
        if issue.get("selector"):
            location.append(f"选择器 {issue['selector']}")
        suffix = f"（{'，'.join(location)}）" if location else ""
        severity = issue.get("severity") or "error"
        lines.append(f"- [{severity}] {issue.get('code')}: {issue.get('message')}{suffix}")
    return "\n".join(lines)[:2000]


def _failure_summary(failures: Sequence[tuple[str, str]]) -> str:
    if not failures:
        return ""
    head = "；".join(f"「{title}」{message}" for title, message in failures[:3])
    suffix = f"（另有 {len(failures) - 3} 页失败）" if len(failures) > 3 else ""
    return f"以下页面构建失败：{head}{suffix}"[:2000]


async def _finalize(
    ctx: _BuildContext,
    mode: str,
    failures: Sequence[tuple[str, str]],
    *,
    canceled: bool,
) -> None:
    """收尾：job 终态、Deck 状态、已取消页面；已就绪页面始终保留。"""
    async with SessionLocal() as db:
        job = await db.get(DeckBuildJob, ctx.job_id)
        if job is None:
            return
        if job.status not in ACTIVE_JOB_STATUSES:
            # 取消接口/启动自愈已提前落终态，不覆盖
            return
        deck = await db.get(ReviewDeck, ctx.deck_id)
        pages = (
            await db.execute(select(DeckPage).where(DeckPage.deck_id == ctx.deck_id))
        ).scalars().all()

        if canceled:
            for page in pages:
                if page.status in ("planned", "building", "validating"):
                    page.status = "ready" if page.bundle_key else "canceled"
            job.status = "canceled"
            job.stage = "任务已取消，已就绪页面保留"
            job.finished_at = utcnow()
            if mode != "single" and deck is not None:
                deck.status = "canceled"
            await _append_event(
                db,
                ctx.job_id,
                "error",
                {"message": "任务已取消：已就绪页面保留，未完成页面可稍后重试"},
            )
            await db.commit()
            return

        total = max(1, int(job.total_pages or 0))
        ready = int(job.ready_pages or 0)
        job.progress = 100
        job.finished_at = utcnow()
        if ready >= total:
            job.status = "done"
            job.error = None
            job.stage = f"构建完成：{total}/{total} 页已就绪"
        elif ready > 0:
            job.status = "partial"
            job.error = None
            job.stage = f"部分完成：{ready}/{total} 页已就绪，其余页面可重试"
        else:
            job.status = "failed"
            job.stage = "构建失败"
            job.error = _failure_summary(failures) or "所有页面均构建失败，请检查构建服务或稍后重试"

        if deck is not None:
            usable = sum(1 for page in pages if page.status == "ready" and page.bundle_key)
            if pages and usable == len(pages):
                deck.status = "ready"
            elif usable:
                deck.status = "partial"
            else:
                deck.status = "failed"

        await _append_event(db, ctx.job_id, "stage", {"text": job.stage})
        if job.status == "failed":
            await _append_event(db, ctx.job_id, "error", {"message": job.error or job.stage})
        await db.commit()


async def build_page_briefs(deck_id: int, *, page_ids: Sequence[int] | None = None) -> list[dict]:
    """按当前大纲/页面计划组装 Page Brief（P4 传给 Builder）。

    返回列表元素的 page_id 为 `page_{db_id}`；`page_ids` 非空时只组装这些页面。
    数据不足（未规划、资料已删除）时返回空列表或空 source_excerpts，不抛业务异常
    （由调用方决定如何失败）。
    """
    async with SessionLocal() as db:
        deck = await db.get(ReviewDeck, deck_id)
        if deck is None:
            raise DeckPlanningError("复习页不存在")
        kps = (
            await db.execute(
                select(KnowledgePoint)
                .where(KnowledgePoint.deck_id == deck_id)
                .order_by(KnowledgePoint.id)
            )
        ).scalars().all()
        page_query = select(DeckPage).where(DeckPage.deck_id == deck_id)
        if page_ids is not None:
            page_query = page_query.where(DeckPage.id.in_(list(page_ids)))
        pages = (
            await db.execute(page_query.order_by(DeckPage.ordinal, DeckPage.id))
        ).scalars().all()
        workspace_id = deck.workspace_id

    kp_by_id = {kp.id: kp for kp in kps}
    page_dicts: list[dict] = []
    page_objects: list[DeckPage] = []
    for page in pages:
        primary = kp_by_id.get(page.primary_knowledge_point_id)
        page_dicts.append(
            {
                "id": page.id,
                "ordinal": page.ordinal,
                "title": page.title,
                "summary": (primary.summary if primary is not None else ""),
            }
        )
        page_objects.append(page)

    grouped = await fetch_sections_from_db(workspace_id)
    flat_sections = _flatten_sections(grouped)

    briefs: list[dict] = []
    for page, page_dict in zip(page_objects, page_dicts):
        kp = kp_by_id.get(page.primary_knowledge_point_id)
        if kp is None:
            for kp_id in page.knowledge_point_ids or []:
                kp = kp_by_id.get(int(kp_id))
                if kp is not None:
                    break
        if kp is None:
            logger.warning("页面 %s 找不到关联知识点，跳过 brief 组装", page.id)
            continue
        brief = build_page_brief(deck, kp, page_dicts, flat_sections, current_page=page_dict)
        brief["page_id"] = f"page_{page.id}"
        briefs.append(brief)
    return briefs
