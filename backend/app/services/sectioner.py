"""资料解析分节流水线：下载 → 解析 → 按章节分节 → material_sections 落库。

去 Embedding 后，资料不再进入向量库：
- 解析器输出带 heading / page metadata 的 Document；
- 本模块把每个 Document 细分为 800–1500 字符的节（目标 1200，100 字符重叠），
  不跨页/跨幻灯片合并；
- 新表 material_sections 是生成链路与页面 brief 的唯一资料引用来源；
- 旧资料（status=indexed 但无分节）通过 backfill_missing_sections 懒回填，无需重新上传。
"""
import asyncio
import logging
import tempfile
from pathlib import Path

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sqlalchemy import delete, select, update

from ..database import SessionLocal
from ..models import Material, MaterialSection
from . import storage
from .parser import parse_file

logger = logging.getLogger(__name__)

SECTION_CHUNK_SIZE = 1200
SECTION_CHUNK_OVERLAP = 100
SECTION_SEPARATORS = ["\n\n", "\n", "。", "；", ".", ";", " ", ""]


def _splitter() -> RecursiveCharacterTextSplitter:
    return RecursiveCharacterTextSplitter(
        chunk_size=SECTION_CHUNK_SIZE,
        chunk_overlap=SECTION_CHUNK_OVERLAP,
        length_function=len,
        separators=SECTION_SEPARATORS,
    )


def docs_to_section_payloads(docs: list[Document]) -> list[dict]:
    """把解析出的 Document 列表转成待落库的分节数据（纯函数，便于测试）。

    - 每个 Document 独立分节，保证不跨页合并；
    - 超长 Document 用 RecursiveCharacterTextSplitter 细分，继承 heading/page；
    - 空内容跳过，ordinal 连续。
    """
    splitter = _splitter()
    payloads: list[dict] = []

    for doc in docs:
        text = (doc.page_content or "").strip()
        if not text:
            continue
        metadata = doc.metadata or {}
        heading = str(metadata.get("heading") or "").strip()[:255]
        heading_level = int(metadata.get("heading_level") or 0)
        page = metadata.get("page")
        pieces = [text] if len(text) <= SECTION_CHUNK_SIZE else splitter.split_text(text)
        parts = len(pieces)
        for index, piece in enumerate(pieces, start=1):
            piece = piece.strip()
            if not piece:
                continue
            payloads.append(
                {
                    "heading": heading,
                    "content": piece,
                    "char_count": len(piece),
                    "page": page,
                    "meta": {
                        "source": metadata.get("source", ""),
                        "heading_level": heading_level,
                        "part": index,
                        "parts": parts,
                    },
                }
            )

    for ordinal, payload in enumerate(payloads):
        payload["ordinal"] = ordinal
    return payloads


def _friendly_error(exc: Exception, filename: str) -> str:
    """把异常转成中文可读文案。"""
    if isinstance(exc, ValueError):
        return str(exc)
    if isinstance(exc, FileNotFoundError):
        return f"文件不存在或已被删除：{filename}"
    name = type(exc).__name__
    detail = str(exc)[:200]
    return f"解析失败（{name}）：{detail}" if detail else f"解析失败（{name}）"


async def update_material_status(
    material_id: int, status: str, error: str | None = None, chunk_count: int | None = None
) -> None:
    """独立短 session 更新资料状态（供后台任务使用）。"""
    values: dict = {"status": status, "error": error}
    if chunk_count is not None:
        values["chunk_count"] = chunk_count
    async with SessionLocal() as db:
        await db.execute(update(Material).where(Material.id == material_id).values(**values))
        await db.commit()


async def _replace_sections(
    material_id: int,
    workspace_id: int,
    payloads: list[dict],
    *,
    mark_indexed: bool,
) -> None:
    async with SessionLocal() as db:
        await db.execute(delete(MaterialSection).where(MaterialSection.material_id == material_id))
        db.add_all(
            [
                MaterialSection(
                    material_id=material_id,
                    workspace_id=workspace_id,
                    ordinal=payload["ordinal"],
                    heading=payload["heading"],
                    content=payload["content"],
                    char_count=payload["char_count"],
                    page=payload["page"],
                    meta=payload["meta"],
                )
                for payload in payloads
            ]
        )
        values: dict = {"chunk_count": len(payloads)}
        if mark_indexed:
            values.update(status="indexed", error=None)
        await db.execute(update(Material).where(Material.id == material_id).values(**values))
        await db.commit()


async def section_material_task(material_id: int, *, update_status: bool = True) -> bool:
    """后台解析分节任务（下载/解析期间不占用 DB session）。

    状态流转（update_status=True 时）：uploaded → indexing → indexed / failed。
    旧资料回填（update_status=False）保持 indexed 状态不变；失败只记日志，由生成链路提示。
    返回是否成功。
    """
    filename = ""
    try:
        async with SessionLocal() as db:
            material = await db.get(Material, material_id)
            if material is None:
                logger.warning("解析任务：资料 %s 不存在（可能已被删除）", material_id)
                return False
            workspace_id = material.workspace_id
            storage_key = material.storage_key
            filename = material.filename

        if update_status:
            await update_material_status(material_id, "indexing", error=None)

        tmp_dir = Path(tempfile.mkdtemp(prefix="mockfinal-"))
        tmp_path = tmp_dir / filename
        payloads: list[dict] = []
        try:
            data = await storage.read(storage_key)
            await asyncio.to_thread(tmp_path.write_bytes, data)

            docs = await asyncio.to_thread(parse_file, tmp_path, filename)
            payloads = docs_to_section_payloads(docs)
            if not payloads:
                raise ValueError(f"《{filename}》分节结果为空，无法建立资料索引")
        finally:
            tmp_path.unlink(missing_ok=True)
            try:
                tmp_dir.rmdir()
            except OSError:
                pass

        await _replace_sections(
            material_id,
            workspace_id,
            payloads,
            mark_indexed=update_status,
        )
        logger.info("资料 %s 解析完成：%s（%d 节）", material_id, filename, len(payloads))
        return True
    except Exception as exc:  # noqa: BLE001 —— 任一步失败均落库为 failed
        logger.exception("资料 %s 解析失败", material_id)
        if update_status:
            try:
                await update_material_status(
                    material_id, "failed", error=_friendly_error(exc, filename)
                )
            except Exception:  # noqa: BLE001 —— 兜底更新失败也不能让异常外溢
                logger.exception("资料 %s 置 failed 状态时再次失败", material_id)
        return False


async def backfill_missing_sections(workspace_id: int) -> list[str]:
    """为「已就绪但无分节」的旧资料补做解析（懒回填，幂等，状态不变）。

    返回回填失败的资料文件名；不抛异常，避免阻断生成。
    """
    async with SessionLocal() as db:
        rows = await db.execute(
            select(Material.id, Material.filename)
            .outerjoin(MaterialSection, MaterialSection.material_id == Material.id)
            .where(
                Material.workspace_id == workspace_id,
                Material.status == "indexed",
                MaterialSection.id.is_(None),
            )
            .order_by(Material.id)
        )
        missing = rows.all()

    failed: list[str] = []
    for material_id, filename in missing:
        logger.info("懒回填资料 %s 的分节：%s", material_id, filename)
        ok = await section_material_task(material_id, update_status=False)
        if not ok:
            failed.append(filename)
    return failed


async def fetch_sections_from_db(workspace_id: int) -> dict[int, list[dict]]:
    """按工作区读取全部资料分节，按 material_id 分组（按 ordinal 排序）。

    返回 {material_id: [{"id", "ordinal", "heading", "content", "page"}, ...]}
    """
    async with SessionLocal() as db:
        rows = await db.execute(
            select(MaterialSection)
            .where(MaterialSection.workspace_id == workspace_id)
            .order_by(MaterialSection.material_id, MaterialSection.ordinal)
        )
        sections = rows.scalars().all()

    grouped: dict[int, list[dict]] = {}
    for section in sections:
        grouped.setdefault(section.material_id, []).append(
            {
                "id": section.id,
                "ordinal": section.ordinal,
                "heading": section.heading,
                "content": section.content,
                "page": section.page,
            }
        )
    return grouped
