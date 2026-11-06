"""资料索引流水线：下载到临时文件 → 解析 → 分块 → embedding 入库（pgvector）。

- LangChain 1.x 新 API：PGEngine + PGVectorStore（旧 PGVector 类已废弃，禁止使用）
- PGEngine.from_engine 复用 FastAPI 的 AsyncEngine，共享同一连接池
- 分块：chunk 1000 / overlap 200
- 向量 metadata：workspace_id / material_id / source / page
"""
import asyncio
import logging
import tempfile
from pathlib import Path

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sqlalchemy import text, update

from ..config import settings
from ..database import SessionLocal, engine
from ..models import Material
from . import storage
from .parser import parse_file

logger = logging.getLogger(__name__)

VECTOR_TABLE = "material_chunks"

_embeddings = None
_pg_engine = None
_vectorstore = None
_table_ready = False
# 模块级锁：向量表建表 / vectorstore 初始化的并发安全（#26）
_init_lock = asyncio.Lock()


class EmbeddingNotConfiguredError(RuntimeError):
    pass


def _get_embeddings():
    global _embeddings
    if not settings.embed_configured:
        raise EmbeddingNotConfiguredError("未配置 Embedding 服务，无法进行资料索引与检索")
    if _embeddings is None:
        from langchain_openai import OpenAIEmbeddings

        _embeddings = OpenAIEmbeddings(
            model=settings.embed_model,
            openai_api_key=settings.embed_api_key,
            openai_api_base=settings.embed_base_url or None,
            # 很多 OpenAI 兼容网关不支持 token 数组输入，关闭 tiktoken 上下文检查
            check_embedding_ctx_length=False,
        )
    return _embeddings


def _get_pg_engine():
    """PGEngine 复用全局 AsyncEngine（避免两套连接池）。"""
    global _pg_engine
    if _pg_engine is None:
        from langchain_postgres import PGEngine

        _pg_engine = PGEngine.from_engine(engine)
    return _pg_engine


async def _ensure_vector_table_unlocked() -> None:
    """建向量表（不加锁，供持锁路径内部调用）。重复启动靠 DuplicateTable/DuplicateObject 兜底。"""
    global _table_ready
    from psycopg.errors import DuplicateObject, DuplicateTable

    pg_engine = _get_pg_engine()
    try:
        # langchain-postgres 0.0.19：ainit_vectorstore_table 无 if_not_exists 参数（#1）
        await pg_engine.ainit_vectorstore_table(
            table_name=VECTOR_TABLE,
            vector_size=settings.embed_dim,
        )
        _table_ready = True
    except (DuplicateTable, DuplicateObject):
        # 并发/重复启动时表已存在
        _table_ready = True


async def ensure_vector_table() -> None:
    """幂等建向量表；模块级 asyncio.Lock 防并发重复建表（#26）。"""
    global _table_ready
    if _table_ready:
        return
    async with _init_lock:
        if _table_ready:
            return
        await _ensure_vector_table_unlocked()


async def get_vectorstore():
    """获取 PGVectorStore（惰性单例 + 模块级锁，未配置 Embedding 时抛中文错误）。"""
    global _vectorstore
    embeddings = _get_embeddings()
    if _vectorstore is not None:
        return _vectorstore
    async with _init_lock:
        if _vectorstore is not None:
            return _vectorstore
        from langchain_postgres import PGVectorStore
        from langchain_postgres.v2.indexes import DistanceStrategy

        if not _table_ready:
            await _ensure_vector_table_unlocked()
        # langchain-postgres 0.0.19：create 用 embedding_service=、无 vector_size，
        # distance_strategy 用 v2 枚举（v1 字符串/枚举缺 .operator）（#1）
        _vectorstore = await PGVectorStore.create(
            engine=_get_pg_engine(),
            embedding_service=embeddings,
            table_name=VECTOR_TABLE,
            distance_strategy=DistanceStrategy.COSINE_DISTANCE,
        )
    return _vectorstore


def _splitter() -> RecursiveCharacterTextSplitter:
    return RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        length_function=len,
        separators=["\n\n", "\n", "。", "；", ".", ";", " ", ""],
    )


def _enrich_metadata(docs: list[Document], workspace_id: int, material_id: int) -> list[Document]:
    for doc in docs:
        doc.metadata.update({"workspace_id": workspace_id, "material_id": material_id})
    return docs


async def index_material_task(material_id: int) -> None:
    """后台索引任务（下载/解析/embedding 期间不占用 DB session，状态更新走独立短 session）。

    状态流转：uploaded → indexing → indexed / failed（error 为中文可读文案）。
    整体 try/except 兜底：任何异常都落库为 failed 并记日志，绝不外溢到事件循环（#6/#9）。
    """
    filename = ""
    try:
        # 短 session：读取所需字段后立即释放
        async with SessionLocal() as db:
            material = await db.get(Material, material_id)
            if material is None:
                logger.warning("索引任务：资料 %s 不存在（可能已被删除）", material_id)
                return
            workspace_id = material.workspace_id
            storage_key = material.storage_key
            filename = material.filename

        await update_material_status(material_id, "indexing", error=None)

        # 无 session：下载 → 解析 → 分块 → embedding
        tmp_dir = Path(tempfile.mkdtemp(prefix="mockfinal-"))
        tmp_path = tmp_dir / filename
        chunks: list[Document] = []
        try:
            data = await storage.read(storage_key)
            await asyncio.to_thread(tmp_path.write_bytes, data)

            docs = await asyncio.to_thread(parse_file, tmp_path, filename)
            if not docs or all(not d.page_content.strip() for d in docs):
                raise ValueError(f"《{filename}》未能提取到有效文本内容")

            chunks = _splitter().split_documents(_enrich_metadata(docs, workspace_id, material_id))
            if not chunks:
                raise ValueError(f"《{filename}》分块结果为空，无法索引")

            vs = await get_vectorstore()
            await vs.aadd_documents(chunks)
        finally:
            tmp_path.unlink(missing_ok=True)
            try:
                tmp_dir.rmdir()
            except OSError:
                pass

        # 短 session：置 indexed
        await update_material_status(material_id, "indexed", error=None, chunk_count=len(chunks))
        logger.info("资料 %s 索引完成：%s（%d 块）", material_id, filename, len(chunks))
    except Exception as exc:  # noqa: BLE001 —— 任一步失败均落库为 failed
        logger.exception("资料 %s 索引失败", material_id)
        try:
            await update_material_status(material_id, "failed", error=_friendly_error(exc, filename))
        except Exception:  # noqa: BLE001 —— 兜底更新失败也不能让异常外溢
            logger.exception("资料 %s 置 failed 状态时再次失败", material_id)


def _friendly_error(exc: Exception, filename: str) -> str:
    """把异常转成中文可读文案。"""
    if isinstance(exc, EmbeddingNotConfiguredError):
        return str(exc)
    if isinstance(exc, ValueError):
        return str(exc)
    if isinstance(exc, FileNotFoundError):
        return f"文件不存在或已被删除：{filename}"
    name = type(exc).__name__
    detail = str(exc)[:200]
    return f"索引失败（{name}）：{detail}" if detail else f"索引失败（{name}）"


async def delete_material_vectors(material_id: int) -> None:
    """删除某资料的全部向量块（best-effort：未配置 Embedding / 表不存在时跳过）。"""
    try:
        vs = await get_vectorstore()
        await vs.adelete(filter={"material_id": material_id})
    except EmbeddingNotConfiguredError:
        logger.info("未配置 Embedding 服务，跳过资料 %s 的向量清理", material_id)
    except Exception:  # noqa: BLE001
        logger.warning("清理资料 %s 的向量失败（已忽略）", material_id, exc_info=True)


async def retrieve_workspace_chunks(
    workspace_id: int, limit: int = 6, query: str = "期末复习重点 核心概念 公式 考点"
) -> dict[int, list[Document]]:
    """按 workspace_id 从向量表检索 chunks，按 material_id 分组（query 可自定义，#15）。"""
    vs = await get_vectorstore()
    docs = await vs.asimilarity_search(
        query,
        k=limit,
        filter={"workspace_id": workspace_id},
    )
    grouped: dict[int, list[Document]] = {}
    for doc in docs:
        mid = doc.metadata.get("material_id")
        if mid is None:
            continue
        grouped.setdefault(int(mid), []).append(doc)
    return grouped


async def fetch_chunks_from_db(workspace_id: int) -> dict[int, list[dict]]:
    """直接 SQL 读取向量表内容（生成流水线的取块方式，按 material_id 分组）。

    返回 {material_id: [{"content": str, "metadata": dict}, ...]}
    """
    sql = text(
        f"SELECT content, langchain_metadata FROM {VECTOR_TABLE} "  # noqa: S608 —— 表名为内部常量
        "WHERE langchain_metadata->>'workspace_id' = :wid ORDER BY langchain_id"
    )
    async with engine.connect() as conn:
        rows = (await conn.execute(sql, {"wid": str(workspace_id)})).all()
    grouped: dict[int, list[dict]] = {}
    for content, meta in rows:
        meta = meta or {}
        try:
            mid = int(meta.get("material_id", 0))
        except (TypeError, ValueError):
            continue
        grouped.setdefault(mid, []).append({"content": content, "metadata": meta})
    return grouped


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
