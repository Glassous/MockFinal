"""SQLAlchemy 2.0 声明式数据模型。"""
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
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
    decks: Mapped[list["ReviewDeck"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")


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
    # uploaded / indexing / indexed / failed（枚举保留以兼容旧契约，语义为解析分节）
    status: Mapped[str] = mapped_column(String(16), default="uploaded", nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 契约字段复用：值为「分节数」，不再是向量分块数
    chunk_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    workspace: Mapped[Workspace] = relationship(back_populates="materials")
    sections: Mapped[list["MaterialSection"]] = relationship(
        back_populates="material", cascade="all, delete-orphan"
    )


class MaterialSection(Base):
    """资料分节：去 Embedding 后的最小检索/引用单元。

    页面 brief 与旧版生成都通过 section_id 显式引用本表；重建资料时整批替换，
    保证 (material_id, ordinal) 幂等。
    """

    __tablename__ = "material_sections"
    __table_args__ = (
        UniqueConstraint("material_id", "ordinal", name="uq_material_section_ordinal"),
        Index("ix_material_sections_workspace_id", "workspace_id"),
        Index("ix_material_sections_material_id", "material_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    material_id: Mapped[int] = mapped_column(
        ForeignKey("materials.id", ondelete="CASCADE"), nullable=False
    )
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    heading: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    char_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 解析器信息：source / heading_level / part / parts 等
    meta: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    material: Mapped[Material] = relationship(back_populates="sections")


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


# ===== PageRef · Deck 领域（P3）=====
# 均为 create_all 自动创建的新表；既有表结构不变。


class ReviewDeck(Base):
    """复习页 Deck：一次「大纲 + 页面计划」的归属单元。

    status：draft / planning / building / partial / ready / failed / canceled。
    style 保存预设、内容偏好、自定义提示词与密度；outline 保存章节/知识点/页面计划快照，
    供前端在构建完成前也能展示规划结果。
    """

    __tablename__ = "review_decks"
    __table_args__ = (Index("ix_review_decks_workspace_id", "workspace_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="draft", nullable=False)
    style: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    outline: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    # 工作区 material_sections 的 id+content 稳定哈希；与当前值不同即提示「资料已变更」
    source_signature: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_page_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completed_page_ids: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    workspace: Mapped[Workspace] = relationship(back_populates="decks")
    # passive_deletes：删除 Deck 时交给数据库 FK ON DELETE CASCADE，
    # 避免 ORM 逐行删除（知识点自引用级联会触发 confirm_deleted_rows 告警）
    knowledge_points: Mapped[list["KnowledgePoint"]] = relationship(
        back_populates="deck", cascade="all, delete-orphan", passive_deletes=True
    )
    pages: Mapped[list["DeckPage"]] = relationship(
        back_populates="deck", cascade="all, delete-orphan", passive_deletes=True
    )
    jobs: Mapped[list["DeckBuildJob"]] = relationship(
        back_populates="deck", cascade="all, delete-orphan", passive_deletes=True
    )
    chat_messages: Mapped[list["PageChatMessage"]] = relationship(
        back_populates="deck", cascade="all, delete-orphan", passive_deletes=True
    )


class KnowledgePoint(Base):
    """大纲知识点。parent_id 自引用：章节行 parent_id 为空，知识点行挂在章节下。

    source_refs 形如 [{material_id, section_id, heading, quote, unverified}]；
    页面 brief 通过 section_id 回查 material_sections，不把正文复制进本表。
    """

    __tablename__ = "knowledge_points"
    __table_args__ = (Index("ix_knowledge_points_deck_id", "deck_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    deck_id: Mapped[int] = mapped_column(
        ForeignKey("review_decks.id", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("knowledge_points.id", ondelete="CASCADE"), nullable=True
    )
    ordinal: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # core / normal / minor
    importance: Mapped[str] = mapped_column(String(8), default="normal", nullable=False)
    # easy / medium / hard
    difficulty: Mapped[str] = mapped_column(String(8), default="medium", nullable=False)
    objectives: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    key_points: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    formulas: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    misconceptions: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    source_refs: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    interaction_idea: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    deck: Mapped[ReviewDeck] = relationship(back_populates="knowledge_points")


class DeckPage(Base):
    """页面计划与实际构建结果。

    P3 只写 planned 页面；P4 由 Builder 构建并通过主 API 最终校验后写 ready、
    `current_version`/`bundle_key`/`manifest`/`validation`，单页重建成功后切换版本。
    """

    __tablename__ = "deck_pages"
    __table_args__ = (Index("ix_deck_pages_deck_id", "deck_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    deck_id: Mapped[int] = mapped_column(
        ForeignKey("review_decks.id", ondelete="CASCADE"), nullable=False
    )
    knowledge_point_ids: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    primary_knowledge_point_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ordinal: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    # concept / interactive / summary / practice
    kind: Mapped[str] = mapped_column(String(16), default="concept", nullable=False)
    # planned / building / validating / ready / failed / canceled
    status: Mapped[str] = mapped_column(String(16), default="planned", nullable=False)
    current_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    bundle_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    thumbnail_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    manifest: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    validation: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    build_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    builder_build_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    deck: Mapped[ReviewDeck] = relationship(back_populates="pages")

    @property
    def has_bundle(self) -> bool:
        """是否已有可读取的 bundle（前端摘要展示用，不触发存储读取）。"""
        return bool(self.bundle_key)


class DeckBuildJob(Base):
    """Deck 规划/构建任务。

    同一 Deck 同时最多一个活跃 job：应用层 409 + 数据库部分唯一索引
    uq_deck_job_active 兜底（索引在 lifespan 启动自愈之后创建）。
    """

    __tablename__ = "deck_build_jobs"
    __table_args__ = (
        Index("ix_deck_build_jobs_deck_id", "deck_id"),
        Index("ix_deck_build_jobs_workspace_id", "workspace_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    deck_id: Mapped[int] = mapped_column(
        ForeignKey("review_decks.id", ondelete="CASCADE"), nullable=False
    )
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    # pending / planning / building / validating / done / partial / failed / canceled
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    stage: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 0–100；只按真实阶段/页级结果推进，规划完成不代表页面 ready
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_pages: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    ready_pages: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed_pages: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # P4 单页重建：非空时该 job 只处理这一页；为空表示首次构建/整册重建
    # （create_all 不会给已存在表补列，由 lifespan 幂等 ALTER TABLE 补列）
    target_page_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 单页重建的用户反馈（≤2000 字），首次尝试时传给 Builder；重试时追加问题摘要
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    deck: Mapped[ReviewDeck] = relationship(back_populates="jobs")
    events: Mapped[list["DeckBuildEvent"]] = relationship(
        back_populates="job", cascade="all, delete-orphan", passive_deletes=True
    )


class DeckBuildEvent(Base):
    """构建事件流：前端按 after_id 游标增量轮询。

    id 使用 BigInteger 作为全局单调游标；索引 (job_id, id)；随 job 级联删除。
    单条 payload 序列化后 ≤4KB，每 job 最多 200 条（应用层限制）。
    """

    __tablename__ = "deck_build_events"
    __table_args__ = (Index("ix_deck_build_events_job_id_id", "job_id", "id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("deck_build_jobs.id", ondelete="CASCADE"), nullable=False
    )
    page_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # stage / text / tool / page_ready / validation / error / retry
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    job: Mapped[DeckBuildJob] = relationship(back_populates="events")


class PageChatMessage(Base):
    """页面 AI 助手对话（P6 使用；P3 只建表，不提供真实问答）。"""

    __tablename__ = "page_chat_messages"
    __table_args__ = (
        Index("ix_page_chat_messages_deck_id", "deck_id"),
        Index("ix_page_chat_messages_page_id", "page_id"),
        Index("ix_page_chat_messages_user_id", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    deck_id: Mapped[int] = mapped_column(
        ForeignKey("review_decks.id", ondelete="CASCADE"), nullable=False
    )
    page_id: Mapped[int] = mapped_column(
        ForeignKey("deck_pages.id", ondelete="CASCADE"), nullable=False
    )
    # user / assistant
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    # done / streaming / failed（用户消息恒为 done）
    status: Mapped[str] = mapped_column(String(16), default="done", nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    quote: Mapped[str | None] = mapped_column(Text, nullable=True)
    context_refs: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    deck: Mapped[ReviewDeck] = relationship(back_populates="chat_messages")
