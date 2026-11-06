"""FastAPI 应用入口。

启动 lifespan：
1. JWT_SECRET 默认占位值醒目告警（#17）；
2. create_all 建业务表（幂等）；
3. users.token_version 幂等补列（#21）+ 启动自愈遗留任务/资料（#4）+ 部分唯一索引 uq_job_active（#13）；
4. PGEngine.ainit_vectorstore_table 建向量表 material_chunks（幂等，捕获 DuplicateTable/DuplicateObject）；
5. 未配置 Embedding / 数据库暂不可达时仅告警，不阻断启动（优雅降级）。
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text, update

from .config import DEFAULT_JWT_SECRET, settings
from .database import engine
from .models import Base, GenerationJob, Material, utcnow
from .routers import artifacts, auth, generation, materials, workspaces
from .schemas import HealthOut

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 0. JWT 默认占位密钥醒目告警（#17）：开发场景不 raise，保持可启动
    if settings.jwt_secret == DEFAULT_JWT_SECRET:
        logger.critical(
            "==================== 安全警告 ====================\n"
            "JWT_SECRET 仍为默认占位值，任何人都可伪造登录令牌！\n"
            "生产环境请务必在 backend/.env 中设置强随机 JWT_SECRET。\n"
            "=================================================="
        )

    # 1. 业务表（幂等）
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("业务表初始化完成（create_all 幂等）")
    except Exception:  # noqa: BLE001
        logger.exception("业务表初始化失败（数据库不可达？），服务仍将启动")

    # 2. 幂等补列 + 启动自愈 + 部分唯一索引（#21/#4/#13）
    try:
        async with engine.begin() as conn:
            # 2a. users.token_version 补列（create_all 不会给已存在表加列）（#21）
            await conn.execute(
                text("ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0")
            )
            # 2b. 启动自愈：上次进程遗留的 pending/running 任务、indexing 资料置 failed（#4）
            await conn.execute(
                update(GenerationJob)
                .where(GenerationJob.status.in_(["pending", "running"]))
                .values(
                    status="failed",
                    error="服务重启导致任务中断，请重新生成",
                    finished_at=utcnow(),
                )
            )
            await conn.execute(
                update(Material)
                .where(Material.status == "indexing")
                .values(status="failed", error="服务重启导致索引中断，请重新上传")
            )
            # 2c. 部分唯一索引：同一工作区同时只能有一个 pending/running 任务（#13）
            #     必须在自愈之后创建，否则遗留的多个活跃行会导致建索引失败
            await conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_job_active "
                    "ON generation_jobs (workspace_id) "
                    "WHERE status IN ('pending','running')"
                )
            )
        logger.info("启动自愈与唯一索引/补列初始化完成")
    except Exception:  # noqa: BLE001
        logger.exception("启动自愈/约束初始化失败（数据库不可达？），服务仍将启动")

    # 3. 向量表（幂等；未配置 Embedding 时跳过，索引/检索时再给出中文提示）
    if settings.embed_configured:
        from .services.indexer import VECTOR_TABLE, ensure_vector_table

        try:
            await ensure_vector_table()
            logger.info("向量表 %s 就绪（vector_size=%d）", VECTOR_TABLE, settings.embed_dim)
        except Exception:  # noqa: BLE001
            logger.warning("向量表初始化失败，将在首次索引时重试", exc_info=True)
    else:
        logger.warning("未配置 EMBED_API_KEY，向量功能不可用：资料索引将标记为 failed，生成接口返回 400")

    yield

    await engine.dispose()


app = FastAPI(
    title="MockFinal API",
    description="MockFinal 期末复习助手后端：工作区 / 资料 / RAG 索引 / AI 生成复习大纲与模拟卷",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(workspaces.router)
app.include_router(materials.router)
app.include_router(generation.router)
app.include_router(artifacts.router)


@app.get("/api/health", response_model=HealthOut, status_code=200)
async def health():
    """健康检查（无需鉴权），附带数据库连通信息。"""
    db_status = "unknown"
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception:  # noqa: BLE001
        db_status = "unreachable"
    return HealthOut(status="ok", database=db_status)
