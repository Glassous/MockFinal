"""生成流水线（主代理编排，asyncio 后台任务执行）：

(1) 从 material_sections 按 workspace_id 取全部资料分节，按 material 分组；
(2) 子代理层：每份资料一个摘要任务，Semaphore(4) 限流并行，stage 实时更新；
(3) 成品层：复习代理 + 出卷代理并行，输入为全部摘要；
(4) 两份 Markdown 写存储、artifacts 落库、job=done；任一成品失败 job=failed 记 error。

去 Embedding 后不再做向量 RAG 补充；旧资料若无分节会在后台懒回填。
后台任务使用独立 DB session，不复用请求 session。
"""
import asyncio
import logging

from sqlalchemy import select, update

from .. import prompts
from ..config import settings
from ..database import SessionLocal
from ..models import Artifact, GenerationJob, Material, Workspace
from . import storage
from .sectioner import backfill_missing_sections, fetch_sections_from_db

logger = logging.getLogger(__name__)

_SEMAPHORE_LIMIT = 4
# 每份资料送入摘要子代理的最大字符数（超出则分段 map 摘要再合并，#15）
_MAX_CHARS_PER_MATERIAL = 24000


def _msg_text(content) -> str:
    """归一化 AIMessage.content（#27）：可能是 str，也可能是 content blocks 列表。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                parts.append(str(block.get("text", "")))
            else:
                text_attr = getattr(block, "text", None)
                parts.append(str(text_attr) if text_attr is not None else str(block))
        return "".join(parts)
    return str(content)


def _render_section(section: dict) -> str:
    """把分节渲染成带标题的正文，供摘要子代理使用。"""
    heading = (section.get("heading") or "").strip()
    body = (section.get("content") or "").strip()
    if heading and not body.startswith(heading):
        return f"## {heading}\n{body}"
    return body


def _split_segments(text: str, max_chars: int) -> list[str]:
    """把超长文本按 max_chars 切段（优先在换行处断开，避免割裂语义）（#15）。"""
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]
    segments: list[str] = []
    start, n = 0, len(text)
    while start < n:
        end = min(start + max_chars, n)
        if end < n:
            nl = text.rfind("\n", start, end)
            if nl > start + max_chars // 2:
                end = nl + 1
        segments.append(text[start:end])
        start = end
    return segments


class LLMNotConfiguredError(RuntimeError):
    pass


def _get_llm(temperature: float = 0.3):
    if not settings.llm_configured:
        raise LLMNotConfiguredError("未配置 LLM 服务，无法生成复习资料")
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(
        model=settings.llm_model,
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url or None,
        temperature=temperature,
        request_timeout=settings.llm_request_timeout,
        max_retries=settings.llm_max_retries,
    )


async def _set_stage(job_id: int, stage: str) -> None:
    async with SessionLocal() as db:
        await db.execute(update(GenerationJob).where(GenerationJob.id == job_id).values(stage=stage))
        await db.commit()


async def _finish_failed(job_id: int, error: str) -> None:
    from ..models import utcnow

    async with SessionLocal() as db:
        await db.execute(
            update(GenerationJob)
            .where(GenerationJob.id == job_id)
            .values(status="failed", error=error[:2000], finished_at=utcnow())
        )
        await db.commit()


async def run_generation_job(job_id: int) -> None:
    """后台任务入口（fire-and-forget，任何异常都不得外溢）。"""
    try:
        await _run(job_id)
    except asyncio.CancelledError:
        await _finish_failed(job_id, "生成任务已被取消")
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("生成任务 %s 失败", job_id)
        await _finish_failed(job_id, _friendly_error(exc))


def _friendly_error(exc: Exception) -> str:
    if isinstance(exc, (LLMNotConfiguredError, ValueError)):
        return str(exc)
    name = type(exc).__name__
    detail = str(exc)[:200]
    return f"生成失败（{name}）：{detail}" if detail else f"生成失败（{name}）"


async def _run(job_id: int) -> None:
    from ..models import utcnow

    async with SessionLocal() as db:
        job = await db.get(GenerationJob, job_id)
        if job is None:
            return
        workspace = await db.get(Workspace, job.workspace_id)
        if workspace is None:
            await _finish_failed(job_id, "工作区不存在")
            return
        user_id = workspace.user_id
        workspace_id = workspace.id
        job.status = "running"
        job.stage = prompts.STAGE_FETCHING
        await db.commit()

    # ===== (1) 取分节并按资料分组（旧资料先懒回填，状态不变）=====
    failed_backfill = await backfill_missing_sections(workspace_id)
    grouped = await fetch_sections_from_db(workspace_id)
    if not grouped:
        detail = "没有可用于生成的已就绪资料，请先上传资料并等待解析完成"
        if failed_backfill:
            detail = f"以下资料尚未完成解析分节，无法生成：{'、'.join(failed_backfill)}"
        await _finish_failed(job_id, detail)
        return

    async with SessionLocal() as db:
        rows = await db.execute(select(Material).where(Material.id.in_(grouped.keys())))
        materials = {m.id: m for m in rows.scalars().all()}

    # ===== (2) 子代理层：并行摘要 =====
    llm = _get_llm(temperature=0.3)
    semaphore = asyncio.Semaphore(_SEMAPHORE_LIMIT)
    total = len(grouped)
    done_count = 0
    count_lock = asyncio.Lock()

    async def _summarize_block(label: str, text_block: str) -> str:
        """单段摘要（走 Semaphore 限流）。"""
        async with semaphore:
            messages = [
                ("system", prompts.SUMMARIZE_SYSTEM),
                (
                    "user",
                    prompts.SUMMARIZE_USER.format(
                        filename=label,
                        content=text_block,
                        boundary=prompts.new_boundary("MATERIAL"),
                    ),
                ),
            ]
            result = await llm.ainvoke(messages)
        return _msg_text(result.content)

    async def summarize_one(material_id: int, sections: list[dict]) -> str:
        nonlocal done_count
        material = materials.get(material_id)
        filename = material.filename if material else f"资料#{material_id}"
        content = "\n\n".join(_render_section(section) for section in sections)
        segments = _split_segments(content, _MAX_CHARS_PER_MATERIAL)
        if len(segments) <= 1:
            summary = await _summarize_block(filename, content)
        else:
            # map：分段摘要（仍走 Semaphore）；reduce：合并成一份（#15，替代静默截断）
            seg_summaries = await asyncio.gather(
                *(
                    _summarize_block(f"{filename}（第{i + 1}/{len(segments)}段）", seg)
                    for i, seg in enumerate(segments)
                )
            )
            async with semaphore:
                messages = [
                    ("system", prompts.SUMMARIZE_SYSTEM),
                    (
                        "user",
                        prompts.MERGE_SUMMARY_USER.format(
                            filename=filename,
                            segments="\n\n---\n\n".join(seg_summaries),
                            boundary=prompts.new_boundary("SEGMENTS"),
                        ),
                    ),
                ]
                result = await llm.ainvoke(messages)
            summary = _msg_text(result.content)
        async with count_lock:
            done_count += 1
            await _set_stage(job_id, prompts.STAGE_SUMMARIZING.format(done=done_count, total=total))
        return f"## 《{filename}》\n\n{summary}"

    await _set_stage(job_id, prompts.STAGE_SUMMARIZING.format(done=0, total=total))
    results = await asyncio.gather(
        *(summarize_one(mid, sections) for mid, sections in grouped.items()),
        return_exceptions=True,
    )
    summaries = [r for r in results if isinstance(r, str)]
    failures = [r for r in results if isinstance(r, BaseException)]
    if not summaries:
        first = failures[0] if failures else None
        await _finish_failed(job_id, _friendly_error(first) if first else "资料摘要全部失败")
        return
    # 部分失败传播（#14）：失败率 > 50% 直接 failed；否则记录提示，done 时写入 job.error
    partial_note: str | None = None
    if failures:
        logger.warning("生成任务 %s：%d/%d 份资料摘要失败", job_id, len(failures), total)
        if len(failures) / total > 0.5:
            await _finish_failed(
                job_id,
                f"{len(failures)}/{total} 份资料摘要失败（超过半数），无法生成可靠结果，请检查资料后重试",
            )
            return
        partial_note = f"{len(failures)}/{total} 份资料摘要失败，结果可能不完整"

    # ===== (3) 成品层：复习代理 + 出卷代理并行 =====
    await _set_stage(job_id, prompts.STAGE_WRITING)
    summaries_text = "\n\n---\n\n".join(summaries)
    writer_llm = _get_llm(temperature=0.5)

    async def write_review() -> str:
        messages = [
            ("system", prompts.REVIEW_SYSTEM),
            (
                "user",
                prompts.REVIEW_USER.format(
                    n=len(summaries),
                    summaries=summaries_text,
                    boundary=prompts.new_boundary("SUMMARIES"),
                ),
            ),
        ]
        return _msg_text((await writer_llm.ainvoke(messages)).content)

    async def write_exam() -> str:
        messages = [
            ("system", prompts.EXAM_SYSTEM),
            (
                "user",
                prompts.EXAM_USER.format(
                    n=len(summaries),
                    summaries=summaries_text,
                    boundary=prompts.new_boundary("SUMMARIES"),
                ),
            ),
        ]
        return _msg_text((await writer_llm.ainvoke(messages)).content)

    review_result, exam_result = await asyncio.gather(
        write_review(), write_exam(), return_exceptions=True
    )
    if isinstance(review_result, BaseException):
        await _finish_failed(job_id, _friendly_error(review_result))
        return
    if isinstance(exam_result, BaseException):
        await _finish_failed(job_id, _friendly_error(exam_result))
        return

    # ===== (4) 落存储 + artifacts 落库 + job=done =====
    await _set_stage(job_id, prompts.STAGE_SAVING)
    contents = {"review": review_result, "exam": exam_result}
    async with SessionLocal() as db:
        for kind, content in contents.items():
            key = storage.build_artifact_key(user_id, workspace_id, job_id, kind)
            await storage.save(key, content.encode("utf-8"), content_type="text/markdown")
            db.add(
                Artifact(
                    workspace_id=workspace_id,
                    job_id=job_id,
                    kind=kind,
                    title=prompts.ARTIFACT_TITLES[kind],
                    storage_key=key,
                )
            )
        job = await db.get(GenerationJob, job_id)
        if job is not None:
            job.status = "done"
            job.stage = prompts.STAGE_DONE
            job.error = partial_note  # 部分资料摘要失败时提示结果可能不完整（#14）
            job.finished_at = utcnow()
        await db.commit()
    logger.info("生成任务 %s 完成", job_id)
