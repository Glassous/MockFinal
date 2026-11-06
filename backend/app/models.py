"""SQLAlchemy 2.0 声明式数据模型。"""
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    security_question: Mapped[str] = mapped_column(String(255), nullable=False)
    # 答案 strip + lower 之后再 bcrypt
    security_answer_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    # token 版本号（#21）：改密时 +1，使旧 access token 立即失效；create_all 不会给已存在表补列，
    # 由 lifespan 用 ALTER TABLE ... ADD COLUMN IF NOT EXISTS 幂等补列
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    workspaces: Mapped[list["Workspace"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="workspaces")
    materials: Mapped[list["Material"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")
    jobs: Mapped[list["GenerationJob"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")
    artifacts: Mapped[list["Artifact"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")


class Material(Base):
    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    # OSS key 或本地相对路径，统一形如 mockfinal/{user_id}/{workspace_id}/{ts}-{filename}
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), default="application/octet-stream", nullable=False)
    # uploaded / indexing / indexed / failed
    status: Mapped[str] = mapped_column(String(16), default="uploaded", nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    workspace: Mapped[Workspace] = relationship(back_populates="materials")


class GenerationJob(Base):
    __tablename__ = "generation_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # pending / running / done / failed
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    stage: Mapped[str | None] = mapped_column(String(255), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    workspace: Mapped[Workspace] = relationship(back_populates="jobs")
    artifacts: Mapped[list["Artifact"]] = relationship(back_populates="job", cascade="all, delete-orphan")


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True, nullable=False
    )
    job_id: Mapped[int] = mapped_column(
        ForeignKey("generation_jobs.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # review / exam
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    workspace: Mapped[Workspace] = relationship(back_populates="artifacts")
    job: Mapped[GenerationJob] = relationship(back_populates="artifacts")
