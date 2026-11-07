"""FastAPI 应用入口。

启动 lifespan：
1. JWT_SECRET 默认占位值醒目告警（#17）；
2. create_all 建业务表（幂等，含 material_sections 与 P3 Deck 表）；
3. users.token_version 幂等补列（#21）+ deck_build_jobs.target_page_id/feedback 补列（P4）
   + 启动自愈遗留任务/资料（#4）；
4. 启动自愈遗留 Deck 规划/构建任务（P3/P4）+ 部分唯一索引 uq_job_active（#13）与
   uq_deck_job_active；
5. 数据库暂不可达时仅告警，不阻断启动（优雅降级）。

去 Embedding 后不再初始化向量表；旧库中的 material_chunks 保留但不再读写。
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import case, func, select, text, update

from .config import DEFAULT_JWT_SECRET, settings
from .database import engine
from .models import (
    Base,
    DeckBuildJob,
    DeckPage,
    GenerationJob,
    Material,
    PageChatMessage,
    ReviewDeck,
    utcnow,
)
from .routers import artifacts, auth, decks, generation, materials, workspaces
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
    if settings.llm_api_key and not settings.llm_base_url:
        logger.warning(
            "LLM_BASE_URL 为空：LLM_API_KEY 将发往 OpenAI 默认地址 https://api.openai.com；"
            "若使用其他网关，请显式配置 LLM_BASE_URL"
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
            # 2a-2. P4 单页重建列：target_page_id / feedback（新库 create_all 已包含）
            await conn.execute(
                text("ALTER TABLE deck_build_jobs ADD COLUMN IF NOT EXISTS target_page_id INTEGER")
            )
            await conn.execute(
                text("ALTER TABLE deck_build_jobs ADD COLUMN IF NOT EXISTS feedback TEXT")
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
                .values(status="failed", error="服务重启导致解析中断，请重新上传")
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
            # 2d. Deck 启动自愈（P3/P4）：遗留任务置 failed，页面保留旧 bundle，Deck 按可用性收敛
            await conn.execute(
                update(DeckBuildJob)
                .where(DeckBuildJob.status.in_(["pending", "planning", "building", "validating"]))
                .values(
                    status="failed",
                    stage="服务重启，规划/构建任务已中断",
                    error="服务重启导致规划/构建任务中断，请重新发起",
                    finished_at=utcnow(),
                )
            )
            # 重建中的页面若已有旧版本 bundle，保持可读（P4 旧版本保留语义）
            await conn.execute(
                update(DeckPage)
                .where(
                    DeckPage.status.in_(["building", "validating"]),
                    DeckPage.bundle_key.is_not(None),
                )
                .values(status="ready")
            )
            await conn.execute(
                update(DeckPage)
                .where(
                    DeckPage.status.in_(["building", "validating"]),
                    DeckPage.bundle_key.is_(None),
                )
                .values(status="failed")
            )
            # 按自愈后的页面可用性收敛 Deck 状态：全部可用→ready，部分可用→partial
            page_total = (
                select(func.count(DeckPage.id))
                .where(DeckPage.deck_id == ReviewDeck.id)
                .scalar_subquery()
            )
            page_ready = (
                select(func.count(DeckPage.id))
                .where(
                    DeckPage.deck_id == ReviewDeck.id,
                    DeckPage.status == "ready",
                    DeckPage.bundle_key.is_not(None),
                )
                .scalar_subquery()
            )
            await conn.execute(
                update(ReviewDeck)
                .where(ReviewDeck.status.in_(["planning", "building"]))
                .values(
                    status=case(
                        (page_total == 0, "failed"),
                        (page_ready == page_total, "ready"),
                        (page_ready > 0, "partial"),
                        else_="failed",
                    )
                )
            )
            # 2d-2. 页面助手流式回答随进程中断：标记 failed，用户消息保留
            await conn.execute(
                update(PageChatMessage)
                .where(PageChatMessage.status == "streaming")
                .values(status="failed")
            )
            # 2e. 同一 Deck 同时最多一个活跃 job（应用层 409 + DB 兜底）
            #     同样必须在自愈之后创建；幂等 CREATE UNIQUE INDEX IF NOT EXISTS
            await conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_deck_job_active "
                    "ON deck_build_jobs (deck_id) "
                    "WHERE status IN ('pending','planning','building','validating')"
                )
            )
        logger.info("启动自愈与唯一索引/补列初始化完成")
    except Exception:  # noqa: BLE001
        logger.exception("启动自愈/约束初始化失败（数据库不可达？），服务仍将启动")

    yield

    await engine.dispose()


app = FastAPI(
    title="MockFinal API",
    description="MockFinal 期末复习助手后端：工作区 / 资料解析分节 / AI 生成复习大纲与模拟卷",
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
app.include_router(decks.router)


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
