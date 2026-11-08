"""Deck 路由（P3/P4）：复习页 CRUD、规划/构建、事件、页面 bundle/缩略图与重建。

归属约定：所有资源都沿 deck → workspace → user 校验，他人资源一律 404。
P4 的真实页面构建依赖内部 Builder/Validator 服务：任一未配置或不可用时
返回中文 503/失败页面，fail-closed，不伪造构建成功；P6 的页面问答走 SSE，
未配置 LLM 时在开流前返回 503。
"""
import asyncio
import json
import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..models import (
    DeckBuildEvent,
    DeckBuildJob,
    DeckPage,
    Material,
    PageChatMessage,
    ReviewDeck,
    User,
    Workspace,
)
from ..schemas import (
    DeckBuildRequest,
    DeckBuildResponse,
    DeckCreate,
    DeckEventOut,
    DeckJobOut,
    DeckOut,
    DeckPageOut,
    DeckPageSummary,
    DeckProgressOut,
    DeckProgressUpdate,
    DeckUpdate,
    PageBundleOut,
    PageMessageCreate,
    PageMessageOut,
    PageRebuildRequest,
)
from ..services import bundle_store, page_chat, storage
from ..services.deck_builder import (
    ACTIVE_JOB_STATUSES,
    run_deck_build_job,
    workspace_source_signature,
)
from ..tasks import spawn
from .workspaces import get_owned_workspace

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["decks"])

EVENT_PAGE_LIMIT = 500


async def get_owned_deck(deck_id: int, user: User, db: AsyncSession) -> ReviewDeck:
    """Deck 归属校验：deck → workspace → user，他人资源 404。"""
    deck = await db.get(ReviewDeck, deck_id)
    if deck is None:
        raise HTTPException(status_code=404, detail="复习页不存在")
    workspace = await db.get(Workspace, deck.workspace_id)
    if workspace is None or workspace.user_id != user.id:
        raise HTTPException(status_code=404, detail="复习页不存在")
    return deck


async def _get_owned_page(deck: ReviewDeck, page_id: int, db: AsyncSession) -> DeckPage:
    page = await db.get(DeckPage, page_id)
    if page is None or page.deck_id != deck.id:
        raise HTTPException(status_code=404, detail="页面不存在")
    return page


async def _get_owned_job(job_id: int, user: User, db: AsyncSession) -> DeckBuildJob:
    job = await db.get(DeckBuildJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="构建任务不存在")
    deck = await db.get(ReviewDeck, job.deck_id)
    if deck is None:
        raise HTTPException(status_code=404, detail="构建任务不存在")
    workspace = await db.get(Workspace, deck.workspace_id)
    if workspace is None or workspace.user_id != user.id:
        raise HTTPException(status_code=404, detail="构建任务不存在")
    return job


async def _get_active_job(db: AsyncSession, deck_id: int) -> DeckBuildJob | None:
    result = await db.execute(
        select(DeckBuildJob)
        .where(
            DeckBuildJob.deck_id == deck_id,
            DeckBuildJob.status.in_(list(ACTIVE_JOB_STATUSES)),
        )
        .order_by(DeckBuildJob.id)
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _active_jobs_by_deck(db: AsyncSession, deck_ids: list[int]) -> dict[int, int]:
    if not deck_ids:
        return {}
    rows = await db.execute(
        select(DeckBuildJob.deck_id, DeckBuildJob.id)
        .where(
            DeckBuildJob.deck_id.in_(deck_ids),
            DeckBuildJob.status.in_(list(ACTIVE_JOB_STATUSES)),
        )
        .order_by(DeckBuildJob.id)
    )
    mapping: dict[int, int] = {}
    for deck_id, job_id in rows.all():
        mapping.setdefault(deck_id, job_id)
    return mapping


async def _latest_jobs_by_deck(db: AsyncSession, deck_ids: list[int]) -> dict[int, int]:
    """每个 Deck 最近一次任务（含已结束），供前端恢复构建结果与失败原因。"""
    if not deck_ids:
        return {}
    rows = await db.execute(
        select(DeckBuildJob.deck_id, DeckBuildJob.id)
        .where(DeckBuildJob.deck_id.in_(deck_ids))
        .order_by(DeckBuildJob.deck_id, DeckBuildJob.id.desc())
    )
    mapping: dict[int, int] = {}
    for deck_id, job_id in rows.all():
        mapping.setdefault(deck_id, job_id)
    return mapping


async def _pages_by_deck(db: AsyncSession, deck_ids: list[int]) -> dict[int, list[DeckPage]]:
    mapping: dict[int, list[DeckPage]] = {deck_id: [] for deck_id in deck_ids}
    if not deck_ids:
        return mapping
    rows = await db.execute(
        select(DeckPage)
        .where(DeckPage.deck_id.in_(deck_ids))
        .order_by(DeckPage.deck_id, DeckPage.ordinal, DeckPage.id)
    )
    for page in rows.scalars().all():
        mapping.setdefault(page.deck_id, []).append(page)
    return mapping


async def _pages_for_deck(db: AsyncSession, deck_id: int) -> list[DeckPage]:
    rows = await db.execute(
        select(DeckPage)
        .where(DeckPage.deck_id == deck_id)
        .order_by(DeckPage.ordinal, DeckPage.id)
    )
    return list(rows.scalars().all())


def _continue_page_id(deck: ReviewDeck, pages: list[DeckPage]) -> int | None:
    """继续阅读页：优先上次阅读页，其次第一个 ready，最后第一个未取消页。"""
    by_id = {page.id: page for page in pages}
    last = by_id.get(deck.last_page_id) if deck.last_page_id else None
    if last is not None and last.status != "canceled":
        return last.id
    for page in pages:
        if page.status == "ready":
            return page.id
    for page in pages:
        if page.status != "canceled":
            return page.id
    return None


def _page_summary(page: DeckPage) -> DeckPageSummary:
    """页面摘要：附带 manifest 标题与 validation 摘要，避免前端为列表逐页拉 bundle。"""
    manifest = page.manifest if isinstance(page.manifest, dict) else {}
    validation = page.validation if isinstance(page.validation, dict) else {}
    manifest_title = manifest.get("title")
    issue_count = validation.get("issue_count")
    if not isinstance(issue_count, int):
        issues = validation.get("issues")
        issue_count = len(issues) if isinstance(issues, list) else 0
    validation_status = validation.get("status")
    teaching = manifest.get("teaching")
    teaching = teaching if isinstance(teaching, dict) else {}
    role = teaching.get("role")
    checks = teaching.get("check")
    check_count = len(checks) if isinstance(checks, list) else 0
    estimated = manifest.get("estimated_minutes")
    teaching_report = validation.get("teaching")
    teaching_score = (
        teaching_report.get("score") if isinstance(teaching_report, dict) else None
    )
    return DeckPageSummary(
        id=page.id,
        ordinal=page.ordinal,
        title=page.title,
        kind=page.kind,
        status=page.status,
        current_version=page.current_version,
        primary_knowledge_point_id=page.primary_knowledge_point_id,
        knowledge_point_ids=list(page.knowledge_point_ids or []),
        has_bundle=bool(page.bundle_key),
        manifest_title=(
            str(manifest_title) if isinstance(manifest_title, str) and manifest_title.strip() else None
        ),
        validation_status=str(validation_status) if validation_status else None,
        validation_issue_count=int(issue_count or 0),
        teaching_role=str(role) if isinstance(role, str) and role else None,
        estimated_minutes=int(estimated) if isinstance(estimated, (int, float)) else None,
        check_count=check_count,
        teaching_score=int(teaching_score) if isinstance(teaching_score, (int, float)) else None,
    )


def _require_page_services() -> None:
    """构建/重建前置条件：LLM + Builder + Validator 必须全部配置，缺失返回 503。"""
    missing: list[str] = []
    if not settings.llm_configured:
        missing.append("LLM 服务（LLM_API_KEY）")
    if not settings.page_builder_configured:
        missing.append("页面构建服务（PAGE_BUILDER_URL / PAGE_BUILDER_TOKEN）")
    if not settings.page_validator_configured:
        missing.append("页面校验服务（PAGE_VALIDATOR_URL / PAGE_VALIDATOR_TOKEN）")
    if missing:
        raise HTTPException(
            status_code=503,
            detail=(
                f"页面构建所需服务未配置：{'、'.join(missing)}；"
                "请在后端 .env 中补齐后重试"
            ),
        )


def _deck_out(
    deck: ReviewDeck,
    pages: list[DeckPage],
    *,
    source_changed: bool,
    active_job_id: int | None,
    last_job_id: int | None = None,
) -> DeckOut:
    return DeckOut(
        id=deck.id,
        workspace_id=deck.workspace_id,
        title=deck.title,
        status=deck.status,
        style=deck.style or {},
        outline=deck.outline or {},
        source_signature=deck.source_signature,
        last_page_id=deck.last_page_id,
        completed_page_ids=list(deck.completed_page_ids or []),
        created_at=deck.created_at,
        updated_at=deck.updated_at,
        pages=[_page_summary(page) for page in pages],
        total_pages=len(pages),
        ready_pages=sum(1 for page in pages if page.status == "ready"),
        failed_pages=sum(1 for page in pages if page.status == "failed"),
        planned_pages=sum(1 for page in pages if page.status == "planned"),
        continue_page_id=_continue_page_id(deck, pages),
        active_job_id=active_job_id,
        last_job_id=last_job_id,
        source_changed=source_changed,
    )


async def _deck_detail(db: AsyncSession, deck: ReviewDeck) -> DeckOut:
    pages = await _pages_for_deck(db, deck.id)
    active_job = await _get_active_job(db, deck.id)
    latest_map = await _latest_jobs_by_deck(db, [deck.id])
    source_changed = False
    if deck.source_signature:
        current = await workspace_source_signature(db, deck.workspace_id)
        source_changed = current != deck.source_signature
    return _deck_out(
        deck,
        pages,
        source_changed=source_changed,
        active_job_id=active_job.id if active_job else None,
        last_job_id=latest_map.get(deck.id),
    )


# ===== 列表 / 创建 =====
@router.get(
    "/workspaces/{workspace_id}/decks", response_model=list[DeckOut], status_code=200
)
async def list_decks(
    workspace_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await get_owned_workspace(workspace_id, user, db)
    rows = await db.execute(
        select(ReviewDeck)
        .where(ReviewDeck.workspace_id == workspace_id)
        .order_by(ReviewDeck.updated_at.desc(), ReviewDeck.id.desc())
    )
    decks = list(rows.scalars().all())
    deck_ids = [deck.id for deck in decks]
    pages_map = await _pages_by_deck(db, deck_ids)
    active_map = await _active_jobs_by_deck(db, deck_ids)
    latest_map = await _latest_jobs_by_deck(db, deck_ids)

    current_signature: str | None = None
    if any(deck.source_signature for deck in decks):
        current_signature = await workspace_source_signature(db, workspace_id)

    result: list[DeckOut] = []
    for deck in decks:
        source_changed = bool(
            deck.source_signature
            and current_signature is not None
            and deck.source_signature != current_signature
        )
        result.append(
            _deck_out(
                deck,
                pages_map.get(deck.id, []),
                source_changed=source_changed,
                active_job_id=active_map.get(deck.id),
                last_job_id=latest_map.get(deck.id),
            )
        )
    return result


@router.post(
    "/workspaces/{workspace_id}/decks", response_model=DeckOut, status_code=200
)
async def create_deck(
    workspace_id: int,
    body: DeckCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    workspace = await get_owned_workspace(workspace_id, user, db)
    title = (body.title or "").strip()
    if body.title is not None and not title:
        raise HTTPException(status_code=400, detail="复习页标题不能为空")
    if not title:
        title = f"{workspace.name} · 复习页"
    deck = ReviewDeck(
        workspace_id=workspace.id,
        title=title[:255],
        status="draft",
        style=body.style.model_dump(),
        outline={},
        completed_page_ids=[],
    )
    db.add(deck)
    await db.commit()
    await db.refresh(deck)
    return await _deck_detail(db, deck)


# ===== 详情 / 更新 / 删除 =====
@router.get("/decks/{deck_id}", response_model=DeckOut, status_code=200)
async def get_deck(
    deck_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    deck = await get_owned_deck(deck_id, user, db)
    return await _deck_detail(db, deck)


@router.patch("/decks/{deck_id}", response_model=DeckOut, status_code=200)
async def update_deck(
    deck_id: int,
    body: DeckUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新标题/风格；风格变更只影响后续构建或单页重做，不自动重排已有页面。"""
    deck = await get_owned_deck(deck_id, user, db)
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="复习页标题不能为空")
        deck.title = title[:255]
    if body.style is not None:
        incoming = body.style.model_dump()
        provided = body.style.model_fields_set
        if provided:
            # 部分更新：只覆盖显式传入的字段，避免改密度时把预设重置为默认值
            deck.style = {**(deck.style or {}), **{key: incoming[key] for key in provided}}
        else:
            deck.style = incoming
    await db.commit()
    await db.refresh(deck)
    return await _deck_detail(db, deck)


@router.delete("/decks/{deck_id}", status_code=204)
async def delete_deck(
    deck_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """级联删除页面/知识点/任务/事件/聊天，并 best-effort 清理 bundle/缩略图对象。"""
    deck = await get_owned_deck(deck_id, user, db)
    pages = await _pages_for_deck(db, deck.id)
    active_jobs = (
        await db.execute(
            select(DeckBuildJob).where(
                DeckBuildJob.deck_id == deck.id,
                DeckBuildJob.status.in_(list(ACTIVE_JOB_STATUSES)),
            )
        )
    ).scalars().all()
    for job in active_jobs:
        # 后台任务下次检查标记时发现 Deck 已删则直接退出；这里只做 best-effort 取消
        job.cancel_requested = True

    storage_keys = [
        key
        for page in pages
        for key in (page.bundle_key, page.thumbnail_key)
        if key
    ]
    await db.delete(deck)
    await db.commit()

    for key in storage_keys:
        try:
            await storage.delete(key)
        except Exception:  # noqa: BLE001 —— 外部清理失败不得影响 204
            logger.warning("删除复习页存储对象失败（已忽略）：%s", key, exc_info=True)
    return None


# ===== 构建 / 取消 =====
@router.post("/decks/{deck_id}/build", response_model=DeckBuildResponse, status_code=200)
async def build_deck(
    deck_id: int,
    body: DeckBuildRequest | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """创建构建任务：首次构建（规划 + 逐页构建）、整册重建或重新规划。

    - LLM / Builder / Validator 任一未配置 → 503（中文说明缺哪个）；
    - 已有页面：`rebuild_all=true` 逐页重建新版本（不再 503），旧版本在新页 ready 前保持可读；
    - `replan=true` 仅在没有页面或全部页面失败时允许（保持 P3 规则）；
    - 同一 Deck 同时最多一个活跃 job（409）。
    """
    deck = await get_owned_deck(deck_id, user, db)
    request = body or DeckBuildRequest()
    if request.rebuild_all and request.replan:
        raise HTTPException(status_code=400, detail="rebuild_all 与 replan 不能同时使用")

    _require_page_services()

    active_job = await _get_active_job(db, deck.id)
    if active_job is not None:
        raise HTTPException(
            status_code=409, detail="当前复习页已有进行中的构建任务，请等待完成或先取消"
        )

    pages = await _pages_for_deck(db, deck.id)
    all_failed = bool(pages) and all(page.status == "failed" for page in pages)
    if pages and not request.rebuild_all and not request.replan:
        if all_failed:
            raise HTTPException(
                status_code=409,
                detail=(
                    "当前复习页全部页面失败；如需重新规划请设置 replan=true，"
                    "如需按现有计划逐页重建请设置 rebuild_all=true"
                ),
            )
        raise HTTPException(
            status_code=409,
            detail="当前复习页已有页面；如需整册重建请设置 rebuild_all=true，或对单页发起重建",
        )
    if request.replan and pages and not all_failed:
        raise HTTPException(
            status_code=409,
            detail="只有当前复习页没有任何页面或全部页面失败时才允许重新规划",
        )

    needs_planning = not pages or request.replan
    if needs_planning:
        indexed = await db.execute(
            select(Material.id)
            .where(Material.workspace_id == deck.workspace_id, Material.status == "indexed")
            .limit(1)
        )
        if indexed.first() is None:
            raise HTTPException(
                status_code=400, detail="当前工作区没有已就绪的资料，请先上传资料并等待解析完成"
            )

    job = DeckBuildJob(
        deck_id=deck.id,
        workspace_id=deck.workspace_id,
        status="pending",
        stage="任务已创建，等待构建…",
        progress=0,
        total_pages=0 if needs_planning else len(pages),
        ready_pages=0,
        failed_pages=0,
    )
    deck.status = "planning" if needs_planning else "building"
    db.add(job)
    try:
        await db.commit()
    except IntegrityError:
        # 部分唯一索引 uq_deck_job_active 兜底：同一 Deck 最多一个活跃 job
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="当前复习页已有进行中的构建任务，请等待完成或先取消"
        )
    await db.refresh(job)
    await db.refresh(deck)

    spawn(run_deck_build_job(job.id, replan=request.replan))
    return DeckBuildResponse(job_id=job.id)


@router.post("/decks/{deck_id}/cancel", response_model=DeckJobOut, status_code=200)
async def cancel_deck_build(
    deck_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """只设置 cancel_requested；由后台任务在检查点落为 canceled。"""
    deck = await get_owned_deck(deck_id, user, db)
    job = await _get_active_job(db, deck.id)
    if job is None:
        raise HTTPException(status_code=409, detail="当前没有进行中的构建任务")
    job.cancel_requested = True
    await db.commit()
    await db.refresh(job)
    return job


# ===== 任务与事件 =====
@router.get("/deck-jobs/{job_id}", response_model=DeckJobOut, status_code=200)
async def get_deck_job(
    job_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _get_owned_job(job_id, user, db)


@router.get(
    "/deck-jobs/{job_id}/events", response_model=list[DeckEventOut], status_code=200
)
async def get_deck_job_events(
    job_id: int,
    after_id: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """按 after_id 游标增量返回事件；单次最多 500 条，前端继续轮询即可。"""
    await _get_owned_job(job_id, user, db)
    rows = await db.execute(
        select(DeckBuildEvent)
        .where(DeckBuildEvent.job_id == job_id, DeckBuildEvent.id > after_id)
        .order_by(DeckBuildEvent.id)
        .limit(EVENT_PAGE_LIMIT)
    )
    return list(rows.scalars().all())


# ===== 页面 =====
@router.get("/decks/{deck_id}/pages/{page_id}", response_model=DeckPageOut, status_code=200)
async def get_deck_page(
    deck_id: int,
    page_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    deck = await get_owned_deck(deck_id, user, db)
    return await _get_owned_page(deck, page_id, db)


@router.get(
    "/decks/{deck_id}/pages/{page_id}/bundle", response_model=PageBundleOut, status_code=200
)
async def get_deck_page_bundle(
    deck_id: int,
    page_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """返回已就绪页面的 bundle JSON；页面未 ready 或无 bundle 时 404。"""
    deck = await get_owned_deck(deck_id, user, db)
    page = await _get_owned_page(deck, page_id, db)
    if page.status != "ready" or not page.bundle_key:
        raise HTTPException(status_code=404, detail="页面尚未生成完成")
    try:
        payload = await bundle_store.load_bundle(page.bundle_key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="页面尚未生成完成") from exc
    except bundle_store.BundleStoreError as exc:
        logger.warning("页面 %s 的 bundle 数据损坏：%s", page.id, exc)
        raise HTTPException(
            status_code=503, detail="页面数据损坏，请稍后重新生成该页面"
        ) from exc
    except Exception as exc:  # noqa: BLE001 —— 存储异常统一转 503 中文
        logger.exception("读取页面 %s 的 bundle 失败", page.id)
        raise HTTPException(status_code=503, detail="读取页面数据失败，请稍后重试") from exc
    try:
        return PageBundleOut.model_validate(payload)
    except ValidationError as exc:
        logger.exception("页面 %s 的 bundle 不符合页面契约", page.id)
        raise HTTPException(
            status_code=503, detail="页面数据不符合页面契约，请重新生成页面"
        ) from exc


@router.get("/decks/{deck_id}/pages/{page_id}/thumbnail", status_code=200)
async def get_deck_page_thumbnail(
    deck_id: int,
    page_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """返回页面缩略图（PNG/JPEG）；无缩略图或对象丢失时 404。"""
    deck = await get_owned_deck(deck_id, user, db)
    page = await _get_owned_page(deck, page_id, db)
    if not page.thumbnail_key:
        raise HTTPException(status_code=404, detail="页面缩略图尚未生成")
    try:
        data = await storage.read(page.thumbnail_key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="页面缩略图尚未生成") from exc
    except Exception as exc:  # noqa: BLE001 —— 存储异常统一转 503 中文
        logger.exception("读取页面 %s 的缩略图失败", page.id)
        raise HTTPException(status_code=503, detail="读取页面缩略图失败，请稍后重试") from exc
    media_type = bundle_store.detect_image_content_type(data)
    if media_type == "application/octet-stream":
        logger.warning("页面 %s 的缩略图内容不是 PNG/JPEG", page.id)
        raise HTTPException(status_code=404, detail="页面缩略图不存在或已损坏")
    return Response(
        content=data,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.post(
    "/decks/{deck_id}/pages/{page_id}/rebuild",
    response_model=DeckBuildResponse,
    status_code=200,
)
async def rebuild_deck_page(
    deck_id: int,
    page_id: int,
    body: PageRebuildRequest | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """单页重建：不重规划；旧版本在新版本成功前保持可读（页面保持 ready）。"""
    deck = await get_owned_deck(deck_id, user, db)
    page = await _get_owned_page(deck, page_id, db)
    _require_page_services()

    active_job = await _get_active_job(db, deck.id)
    if active_job is not None:
        raise HTTPException(
            status_code=409, detail="当前复习页已有进行中的构建任务，请等待完成或先取消"
        )

    job = DeckBuildJob(
        deck_id=deck.id,
        workspace_id=deck.workspace_id,
        status="pending",
        stage="任务已创建，等待重建页面…",
        progress=0,
        total_pages=1,
        ready_pages=0,
        failed_pages=0,
        target_page_id=page.id,
        feedback=(body.feedback if body is not None else None),
    )
    db.add(job)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="当前复习页已有进行中的构建任务，请等待完成或先取消"
        )
    await db.refresh(job)

    spawn(run_deck_build_job(job.id, replan=False))
    return DeckBuildResponse(job_id=job.id)


# ===== 阅读进度 =====
@router.patch("/decks/{deck_id}/progress", response_model=DeckProgressOut, status_code=200)
async def update_deck_progress(
    deck_id: int,
    body: DeckProgressUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    deck = await get_owned_deck(deck_id, user, db)
    if body.last_page_id is not None:
        await _get_owned_page(deck, body.last_page_id, db)
        deck.last_page_id = body.last_page_id
    if body.completed_page_ids is not None:
        requested = set(body.completed_page_ids)
        if requested:
            rows = await db.execute(
                select(DeckPage.id).where(
                    DeckPage.deck_id == deck.id, DeckPage.id.in_(requested)
                )
            )
            valid = set(rows.scalars().all())
            if valid != requested:
                raise HTTPException(
                    status_code=400, detail="completed_page_ids 包含不属于该复习页的页面"
                )
        # 进度只增不减：合并而不是覆盖，避免多标签页互相回退
        deck.completed_page_ids = sorted(set(deck.completed_page_ids or []) | requested)
    await db.commit()
    await db.refresh(deck)
    return DeckProgressOut(
        last_page_id=deck.last_page_id,
        completed_page_ids=list(deck.completed_page_ids or []),
    )


# ===== 页面 AI 助手（P6）=====
def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.get(
    "/decks/{deck_id}/pages/{page_id}/messages",
    response_model=list[PageMessageOut],
    status_code=200,
)
async def list_page_messages(
    deck_id: int,
    page_id: int,
    limit: int = Query(default=100, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    deck = await get_owned_deck(deck_id, user, db)
    await _get_owned_page(deck, page_id, db)
    rows = await db.execute(
        select(PageChatMessage)
        .where(
            PageChatMessage.user_id == user.id,
            PageChatMessage.deck_id == deck.id,
            PageChatMessage.page_id == page_id,
        )
        .order_by(PageChatMessage.created_at.desc(), PageChatMessage.id.desc())
        .limit(limit)
    )
    return list(reversed(rows.scalars().all()))


@router.post("/decks/{deck_id}/pages/{page_id}/messages", status_code=200)
async def create_page_message(
    deck_id: int,
    page_id: int,
    request: Request,
    body: PageMessageCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """页面问答：保存消息并返回 SSE（delta/done/error）。

    断线会取消 LLM 流并把 assistant 消息标记 failed；user 消息保留。
    """
    deck = await get_owned_deck(deck_id, user, db)
    page = await _get_owned_page(deck, page_id, db)
    if not settings.llm_configured:
        raise HTTPException(
            status_code=503,
            detail="未配置 LLM 服务（缺少 LLM_API_KEY），页面助手暂不可用，请稍后重试",
        )
    if page.status != "ready" or not isinstance(page.manifest, dict) or not page.manifest:
        raise HTTPException(status_code=400, detail="页面尚未构建完成，暂时无法提问")

    allowed, retry_after = await page_chat.page_chat_limiter.hit(user.id)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="提问过于频繁，请稍后再试（每分钟最多 20 次）",
            headers={"Retry-After": str(retry_after)},
        )

    question = body.content.strip()
    quote = (body.quote or "").strip()
    block_text = (body.block_text or "").strip()
    context = await page_chat.collect_context(
        db=db,
        deck=deck,
        page=page,
        user_id=user.id,
        quote=quote,
        block_text=block_text,
    )
    built = page_chat.assemble_prompt(context, question)

    user_message = PageChatMessage(
        user_id=user.id,
        deck_id=deck.id,
        page_id=page.id,
        role="user",
        status="done",
        content=question,
        quote=quote or None,
        context_refs=[],
    )
    assistant_message = PageChatMessage(
        user_id=user.id,
        deck_id=deck.id,
        page_id=page.id,
        role="assistant",
        status="streaming",
        content="",
        quote=None,
        context_refs=[],
    )
    db.add_all([user_message, assistant_message])
    await db.commit()
    await db.refresh(assistant_message)
    assistant_id = assistant_message.id
    refs = built.refs

    async def event_stream():
        chunks: list[str] = []
        started = time.monotonic()
        try:
            async for delta in page_chat.stream_answer(built.messages):
                if await request.is_disconnected():
                    raise asyncio.CancelledError
                chunks.append(delta)
                yield _sse("delta", {"text": delta})
            content = "".join(chunks).strip()
            if not content:
                content = "当前页面与资料未覆盖该问题。"
            await page_chat.finalize_message(assistant_id, content, refs, "done")
            logger.info(
                "page_chat status=done deck_id=%s page_id=%s user_id=%s chars=%s "
                "sources=%s duration_ms=%s",
                deck.id,
                page.id,
                user.id,
                len(content),
                len(refs),
                int((time.monotonic() - started) * 1000),
            )
            yield _sse("done", {"message_id": assistant_id, "refs": refs})
        except asyncio.CancelledError:
            await page_chat.finalize_message(
                assistant_id, "".join(chunks), refs, "failed"
            )
            raise
        except page_chat.LLMNotConfiguredError as exc:
            await page_chat.finalize_message(
                assistant_id, "".join(chunks), refs, "failed"
            )
            yield _sse("error", {"detail": str(exc)})
        except Exception:  # noqa: BLE001 —— 流内异常必须以 SSE error 收尾
            logger.exception("页面助手回答失败：deck=%s page=%s", deck.id, page.id)
            await page_chat.finalize_message(
                assistant_id, "".join(chunks), refs, "failed"
            )
            yield _sse("error", {"detail": "页面助手回答失败，请稍后重试"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
