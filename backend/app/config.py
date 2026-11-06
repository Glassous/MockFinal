"""全局配置：全部来自环境变量 / backend/.env（pydantic-settings）。"""
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/ 目录（app/config.py 的上一级）
BACKEND_DIR = Path(__file__).resolve().parent.parent

# JWT 默认占位密钥：生产环境必须覆盖，启动时若仍为此值会 logger.critical 醒目告警（#17）
DEFAULT_JWT_SECRET = "change-me-to-a-long-random-string"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # 数据库（统一 psycopg3 异步驱动）
    database_url: str = "postgresql+psycopg://mockfinal:mockfinal@db:5432/mockfinal"

    # JWT
    jwt_secret: str = DEFAULT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 天
    reset_token_expire_minutes: int = 10  # 找回密码用，契约规定 10 分钟

    # LLM（生成复习大纲 / 模拟卷）
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model: str = "qwen-plus"

    # Embedding（资料向量化）
    embed_base_url: str | None = None
    embed_api_key: str | None = None
    embed_model: str = "text-embedding-v4"
    embed_dim: int = 1024

    # 阿里云 OSS
    oss_region: str | None = None
    oss_endpoint: str | None = None
    oss_bucket: str | None = None
    alibaba_cloud_access_key_id: str | None = None
    alibaba_cloud_access_key_secret: str | None = None

    # STS
    sts_region: str | None = None
    sts_role_arn: str | None = None
    sts_duration_seconds: int = 3600

    # 本地回退存储目录（容器内 /app/data）
    local_storage_dir: Path = BACKEND_DIR / "data"

    # 上传限制
    max_upload_size: int = 50 * 1024 * 1024  # 50MB
    allowed_extensions: tuple[str, ...] = (".pdf", ".docx", ".pptx", ".md", ".txt")

    # LLM 调用参数（契约：request_timeout=180 max_retries=2）
    llm_request_timeout: int = 180
    llm_max_retries: int = 2

    # CORS 允许来源（#24）：env CORS_ORIGINS 逗号分隔，默认本地前端
    cors_origins: list[str] = ["http://localhost:5173"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors_origins(cls, v):
        """支持从环境变量读入逗号分隔字符串（CORS_ORIGINS=a,b,c）。"""
        if isinstance(v, str):
            return [item.strip() for item in v.split(",") if item.strip()]
        return v

    @property
    def oss_configured(self) -> bool:
        """OSS 三要素 + 长期 AK 齐全才启用对象存储，否则本地回退。"""
        return bool(
            self.oss_region
            and self.oss_bucket
            and self.alibaba_cloud_access_key_id
            and self.alibaba_cloud_access_key_secret
        )

    @property
    def sts_configured(self) -> bool:
        return bool(self.oss_configured and self.sts_role_arn)

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_api_key)

    @property
    def embed_configured(self) -> bool:
        return bool(self.embed_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
