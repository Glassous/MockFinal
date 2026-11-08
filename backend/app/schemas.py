"""Pydantic 请求/响应模型（字段名与前端契约逐字对齐，不得擅改）。"""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ORM = ConfigDict(from_attributes=True)

# Deck 风格预设：中文名与代码一一对应，接口统一使用代码
DECK_STYLE_PRESETS = ("editorial", "blueprint", "drill", "story")
DECK_STYLE_PRESET_ALIASES = {
    "讲义": "editorial",
    "图解": "blueprint",
    "冲刺": "drill",
    "叙事": "story",
}
DECK_DENSITIES = ("concise", "standard", "deep")


# ===== auth =====
class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=6, max_length=72)
    security_question: str = Field(min_length=1, max_length=255)
    security_answer: str = Field(min_length=1, max_length=128)


class LoginRequest(BaseModel):
    username: str
    password: str


class VerifyAnswerRequest(BaseModel):
    username: str
    answer: str


class ResetPasswordRequest(BaseModel):
    reset_token: str
    new_password: str = Field(min_length=6, max_length=72)


class UserOut(BaseModel):
    model_config = ORM
    id: int
    username: str


class AuthResponse(BaseModel):
    token: str
    user: UserOut


class SecurityQuestionOut(BaseModel):
    question: str


class ResetTokenOut(BaseModel):
    reset_token: str


# ===== workspaces =====
class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = ""


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None


class WorkspaceOut(BaseModel):
    model_config = ORM
    id: int
    name: str
    description: str
    created_at: datetime


class UploadCredentialsOSS(BaseModel):
    mode: str = "oss"
    accessKeyId: str
    accessKeySecret: str
    securityToken: str
    expiration: str
    region: str  # "oss-" + OSS_REGION
    bucket: str
    key_prefix: str  # mockfinal/{user_id}/{workspace_id}/


class UploadCredentialsLocal(BaseModel):
    mode: str = "local"


# ===== materials =====
class MaterialRegisterOSS(BaseModel):
    """OSS 直传完成后的登记请求。"""
    filename: str
    storage_key: str
    size: int
    content_type: str


class MaterialOut(BaseModel):
    model_config = ORM
    id: int
    workspace_id: int
    filename: str
    storage_key: str
    size: int
    content_type: str
    status: str
    error: str | None
    chunk_count: int
    created_at: datetime


# ===== generation =====
class GenerateResponse(BaseModel):
    job_id: int


class JobOut(BaseModel):
    model_config = ORM
    id: int
    status: str
    stage: str | None
    error: str | None


# ===== artifacts =====
class ArtifactOut(BaseModel):
    model_config = ORM
    id: int
    kind: str
    title: str
    created_at: datetime


class ArtifactDetail(ArtifactOut):
    content: str


# ===== decks（P3）=====
class DeckStyle(BaseModel):
    """复习页风格：预设 + 内容偏好 + 密度 + 自定义提示词。

    preset 接受代码（editorial/blueprint/drill/story）或中文名（讲义/图解/冲刺/叙事），
    统一存储为代码；custom_prompt 只作为偏好，不得覆盖页面 constraints。
    """

    preset: Literal["editorial", "blueprint", "drill", "story"] = "editorial"
    content: list[str] = Field(default_factory=list, max_length=20)
    density: Literal["concise", "standard", "deep"] = "standard"
    custom_prompt: str = Field(default="", max_length=500)
    design_system: Literal["1.0", "2.0"] = "1.0"
    page_theme: Literal["editorial", "workbench", "problem"] = "workbench"
    outline_override: dict[str, Any] | None = None

    @field_validator("preset", mode="before")
    @classmethod
    def _normalize_preset(cls, value):
        if isinstance(value, str):
            text = value.strip()
            return DECK_STYLE_PRESET_ALIASES.get(text, text)
        return value

    @field_validator("content")
    @classmethod
    def _normalize_content(cls, values: list[str]) -> list[str]:
        items: list[str] = []
        for item in values:
            text = (item or "").strip()
            if not text:
                continue
            if len(text) > 32:
                raise ValueError("内容偏好单项不能超过 32 个字符")
            if text not in items:
                items.append(text)
        return items

    @field_validator("custom_prompt")
    @classmethod
    def _strip_custom_prompt(cls, value: str) -> str:
        return (value or "").strip()


class DeckCreate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    style: DeckStyle = Field(default_factory=DeckStyle)


class DeckUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    style: DeckStyle | None = None


class KnowledgePointOut(BaseModel):
    model_config = ORM
    id: int
    deck_id: int
    parent_id: int | None
    ordinal: int
    title: str
    summary: str
    importance: str
    difficulty: str
    objectives: list[str] = Field(default_factory=list)
    key_points: list[str] = Field(default_factory=list)
    formulas: list[str] = Field(default_factory=list)
    misconceptions: list[str] = Field(default_factory=list)
    source_refs: list[dict] = Field(default_factory=list)
    interaction_idea: str
    created_at: datetime


class DeckPageSummary(BaseModel):
    """Deck 详情/列表中的页面摘要（不含 bundle 正文）。

    manifest_title / validation_status 由路由从页面的 manifest 与 validation 摘要中提取，
    前端据此展示卡片标题与校验状态，无需再逐页拉取 bundle。
    """

    model_config = ORM
    id: int
    ordinal: int
    title: str
    kind: str
    status: str
    current_version: int
    primary_knowledge_point_id: int | None
    knowledge_point_ids: list[int] = Field(default_factory=list)
    has_bundle: bool = False
    manifest_title: str | None = None
    validation_status: str | None = None
    validation_issue_count: int = 0
    # P9 教学摘要（旧页面无 teaching 时为 None/0，前端必须降级展示）
    teaching_role: str | None = None
    estimated_minutes: int | None = None
    check_count: int = 0
    teaching_score: int | None = None


class DeckPageOut(BaseModel):
    model_config = ORM
    id: int
    deck_id: int
    knowledge_point_ids: list[int] = Field(default_factory=list)
    primary_knowledge_point_id: int | None
    ordinal: int
    title: str
    kind: str
    status: str
    current_version: int
    bundle_key: str | None
    thumbnail_key: str | None
    manifest: dict = Field(default_factory=dict)
    validation: dict = Field(default_factory=dict)
    build_attempts: int
    builder_build_id: str | None
    created_at: datetime
    updated_at: datetime


class DeckOut(BaseModel):
    model_config = ORM
    id: int
    workspace_id: int
    title: str
    status: str
    style: dict = Field(default_factory=dict)
    outline: dict = Field(default_factory=dict)
    source_signature: str | None
    last_page_id: int | None
    completed_page_ids: list[int] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    # 以下为派生字段，由路由组装
    pages: list[DeckPageSummary] = Field(default_factory=list)
    total_pages: int = 0
    ready_pages: int = 0
    failed_pages: int = 0
    planned_pages: int = 0
    continue_page_id: int | None = None
    active_job_id: int | None = None
    # 最近一次构建任务（含已结束），供前端重新进入时恢复失败原因与结果
    last_job_id: int | None = None
    # 当前资料分节签名与 deck.source_signature 不一致时为 True（提示「资料已变更」）
    source_changed: bool = False


class DeckJobOut(BaseModel):
    model_config = ORM
    id: int
    deck_id: int
    workspace_id: int
    status: str
    stage: str | None
    progress: int
    total_pages: int
    ready_pages: int
    failed_pages: int
    error: str | None
    cancel_requested: bool
    # P4 单页重建时指向目标页；整册/首次构建为空
    target_page_id: int | None = None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class DeckEventOut(BaseModel):
    model_config = ORM
    id: int
    job_id: int
    page_id: int | None
    type: str
    payload: dict = Field(default_factory=dict)
    created_at: datetime


class DeckProgressUpdate(BaseModel):
    last_page_id: int | None = None
    completed_page_ids: list[int] | None = Field(default=None, max_length=500)


class DeckProgressOut(BaseModel):
    last_page_id: int | None
    completed_page_ids: list[int] = Field(default_factory=list)


class DeckBuildRequest(BaseModel):
    """构建模式：rebuild_all（复用大纲整册重建）与 replan（重新规划）互斥。"""

    rebuild_all: bool = False
    replan: bool = False


class DeckBuildResponse(BaseModel):
    job_id: int


class PageRebuildRequest(BaseModel):
    """单页重建请求：feedback 只作为「偏好」传给 Builder，不得覆盖页面 constraints。"""

    feedback: str | None = Field(default=None, max_length=2000)

    @field_validator("feedback")
    @classmethod
    def _strip_feedback(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        return text or None


class PageBundleOut(BaseModel):
    """页面 bundle（P4 使用）。P3 只定义契约，不生成页面。"""

    schema_version: str = Field(min_length=1, max_length=32)
    runtime_version: str = Field(min_length=1, max_length=32)
    manifest: dict
    html: str = Field(max_length=4 * 1024 * 1024)
    css: str = Field(default="", max_length=4 * 1024 * 1024)
    js: str = Field(default="", max_length=4 * 1024 * 1024)


class PageMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    quote: str | None = Field(default=None, max_length=2000)
    block_text: str | None = Field(default=None, max_length=3000)
    context_refs: list[dict] = Field(default_factory=list, max_length=20)


class PageMessageOut(BaseModel):
    model_config = ORM
    id: int
    deck_id: int
    page_id: int
    role: str
    status: str
    content: str
    quote: str | None
    context_refs: list[dict] = Field(default_factory=list)
    created_at: datetime


# ===== health =====
class HealthOut(BaseModel):
    status: str
    database: str = "unknown"
