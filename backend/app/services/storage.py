"""统一对象存储接口：OSS（alibabacloud-oss-v2，V4 签名）配置齐全时走云端，
否则回退到本地 backend/data（容器内 /app/data），并记录一次警告日志。

SDK 是同步的，所有 IO 均通过 asyncio.to_thread 包裹，避免阻塞事件循环。
"""
import asyncio
import io
import logging
import time
from pathlib import Path
from typing import BinaryIO

from fastapi import HTTPException

from ..config import settings

logger = logging.getLogger(__name__)

_client = None
_warned_fallback = False


def _get_client():
    """惰性创建 OSS V2 客户端（cfg.region 自动派生 endpoint）。"""
    global _client
    if _client is None:
        import alibabacloud_oss_v2 as oss

        cfg = oss.config.Config(
            region=settings.oss_region,
            credentials_provider=oss.credentials.StaticCredentialsProvider(
                settings.alibaba_cloud_access_key_id,
                settings.alibaba_cloud_access_key_secret,
            ),
        )
        if settings.oss_endpoint:
            cfg.endpoint = settings.oss_endpoint
        _client = oss.Client(cfg)
    return _client


def is_oss_enabled() -> bool:
    return settings.oss_configured


def _warn_local_fallback() -> None:
    global _warned_fallback
    if not _warned_fallback:
        logger.warning("未配置 OSS（缺少 region/bucket/AK），存储回退到本地目录 %s", settings.local_storage_dir)
        _warned_fallback = True


def build_key(user_id: int, workspace_id: int, filename: str) -> str:
    """资料对象 key：mockfinal/{user_id}/{workspace_id}/{ts}-{filename}"""
    safe_name = Path(filename).name or "file"
    ts = int(time.time() * 1000)
    return f"mockfinal/{user_id}/{workspace_id}/{ts}-{safe_name}"


def build_artifact_key(user_id: int, workspace_id: int, job_id: int, kind: str) -> str:
    """工件 key：mockfinal/{user_id}/{workspace_id}/artifacts/{job_id}/review.md|exam.md"""
    return f"mockfinal/{user_id}/{workspace_id}/artifacts/{job_id}/{kind}.md"


def _local_path(key: str) -> Path:
    path = settings.local_storage_dir / key
    # 防目录穿越：解析后必须仍在存储根目录内，否则 400（#23）
    try:
        path.resolve().relative_to(settings.local_storage_dir.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="非法的存储路径") from exc
    return path


# ===== 同步实现（内部使用） =====

def _save_sync(key: str, data: bytes | BinaryIO, content_type: str = "application/octet-stream") -> None:
    if isinstance(data, bytes):
        stream: BinaryIO = io.BytesIO(data)
    else:
        stream = data
    if is_oss_enabled():
        import alibabacloud_oss_v2 as oss

        client = _get_client()
        client.put_object(
            oss.PutObjectRequest(
                bucket=settings.oss_bucket,
                key=key,
                content_type=content_type,
                body=stream,
            )
        )
    else:
        _warn_local_fallback()
        path = _local_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as f:
            while chunk := stream.read(1024 * 1024):
                f.write(chunk)


def _read_sync(key: str) -> bytes:
    if is_oss_enabled():
        import alibabacloud_oss_v2 as oss

        client = _get_client()
        result = client.get_object(oss.GetObjectRequest(bucket=settings.oss_bucket, key=key))
        return result.body.read()
    _warn_local_fallback()
    return _local_path(key).read_bytes()


def _open_stream_sync(key: str) -> BinaryIO:
    return io.BytesIO(_read_sync(key))


def _delete_sync(key: str) -> None:
    if is_oss_enabled():
        import alibabacloud_oss_v2 as oss

        client = _get_client()
        try:
            client.delete_object(oss.DeleteObjectRequest(bucket=settings.oss_bucket, key=key))
        except Exception:  # noqa: BLE001 —— OSS 删除不存在对象等错误不应阻断级联清理
            logger.warning("删除 OSS 对象失败（已忽略）：%s", key, exc_info=True)
    else:
        _warn_local_fallback()
        path = _local_path(key)
        path.unlink(missing_ok=True)


def _head_sync(key: str) -> tuple[int, str]:
    """返回 (size, content_type)；对象不存在时抛 FileNotFoundError。"""
    if is_oss_enabled():
        import alibabacloud_oss_v2 as oss

        client = _get_client()
        try:
            result = client.head_object(oss.HeadObjectRequest(bucket=settings.oss_bucket, key=key))
        except Exception as exc:  # noqa: BLE001
            status = getattr(getattr(exc, "response", None), "status_code", None) or getattr(exc, "status_code", None)
            if status == 404:
                raise FileNotFoundError(key) from exc
            raise
        return int(result.content_length or 0), result.content_type or "application/octet-stream"
    _warn_local_fallback()
    path = _local_path(key)
    if not path.is_file():
        raise FileNotFoundError(key)
    stat = path.stat()
    import mimetypes

    guessed = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return stat.st_size, guessed


# ===== 异步对外接口 =====

async def save(key: str, data: bytes | BinaryIO, content_type: str = "application/octet-stream") -> None:
    await asyncio.to_thread(_save_sync, key, data, content_type)


async def read(key: str) -> bytes:
    return await asyncio.to_thread(_read_sync, key)


async def open_stream(key: str) -> BinaryIO:
    return await asyncio.to_thread(_open_stream_sync, key)


async def delete(key: str) -> None:
    await asyncio.to_thread(_delete_sync, key)


async def head(key: str) -> tuple[int, str]:
    return await asyncio.to_thread(_head_sync, key)
