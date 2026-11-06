"""Pydantic 请求/响应模型（字段名与前端契约逐字对齐，不得擅改）。"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

ORM = ConfigDict(from_attributes=True)


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


# ===== health =====
class HealthOut(BaseModel):
    status: str
    database: str = "unknown"
