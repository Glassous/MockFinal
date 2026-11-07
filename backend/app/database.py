"""数据库：AsyncEngine + async_sessionmaker（psycopg3），全应用共享同一连接池。"""
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .config import settings

engine: AsyncEngine = create_async_engine(settings.database_url, echo=False, future=True)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI 请求级 session 依赖。后台任务不得使用它，需自建 session。"""
    async with SessionLocal() as session:
        yield session
