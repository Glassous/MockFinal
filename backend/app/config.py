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
    # 页面助手单次回答 token 上限（成本控制；生成管线不受影响）
    page_chat_max_tokens: int = 900

    # PageRef Deck 规划（P3）：页数区间与资料预算
    deck_min_pages: int = 6
    deck_max_pages: int = 16
    # 送入大纲规划 prompt 的资料总字符预算（超出按资料顺序截断，并记录事件）
    deck_max_material_chars: int = 200000
    # 单页 bundle 字节上限（P4 保存与交付时校验）
    deck_max_bundle_bytes: int = 2097152

    # ===== PageRef P4：页面构建（Builder）与最终校验（Validator）内部服务 =====
    # Builder 内部地址（如 http://page-builder:9100）；为空时构建/重建接口返回 503
    page_builder_url: str | None = None
    # Builder 共享密钥（HMAC-SHA256 签名），只在后端与 Builder 容器之间使用
    page_builder_token: str | None = None
    # 单次 Builder 请求超时（秒）；单页构建还会叠加总超时保护
    page_builder_timeout_seconds: int = 480
    # 页面并发构建数（MVP 默认 2）；仅进程内并发控制
    page_builder_concurrency: int = 2
    # Validator 内部地址（如 http://page-validator:9200）
    page_validator_url: str | None = None
    # Validator Bearer token
    page_validator_token: str | None = None
    # 单次最终校验超时（秒）
    page_validator_timeout_seconds: int = 120
    # 单页最多尝试次数（含首次）；最终校验失败时带问题摘要重试
    deck_page_max_attempts: int = 2
    # 整个构建任务总超时（秒）；超时取消 Builder 并把未完成页面落失败
    deck_job_timeout_seconds: int = 1800

    # ===== P9 教学契约（默认关闭，黄金集门禁通过后开启） =====
    deck_teaching_enabled: bool = False
    # 教学评分门禁阈值（P11 校准后作为 Builder 重试条件）
    deck_teaching_min_score: int = 70
    # 单层可见正文建议值（warning 口径，非硬门禁）
    deck_visible_layer_chars: int = 450
    # 单页总正文硬上限（超出必须拆页）
    deck_total_page_chars: int = 700
    # 页内总块数上限（含隐藏层）
    deck_max_page_blocks: int = 8

    # ===== P11 Deck lane 会话（默认关闭，A/B 通过后开启） =====
    deck_session_reuse_enabled: bool = False
    # lane 数量上限；实际取 min(lane_count, page_builder_concurrency)
    deck_lane_count: int = 2

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
    def page_builder_configured(self) -> bool:
        """Builder 地址与共享密钥齐全才算可用；缺失时构建接口 fail-closed。"""
        return bool(self.page_builder_url and self.page_builder_token)

    @property
    def page_validator_configured(self) -> bool:
        """Validator 地址与 token 齐全才算可用；缺失时不允许放行页面。"""
        return bool(self.page_validator_url and self.page_validator_token)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
