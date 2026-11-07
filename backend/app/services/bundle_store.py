"""页面 bundle / 缩略图存储（P4）。

key 约定（不暴露直链，下载接口必须校验归属）：
- bundle：`mockfinal/{user_id}/{workspace_id}/decks/{deck_id}/pages/{page_id}/v{version}/bundle.json`
- 缩略图：`.../v{version}/thumbnail.png`

职责边界：
- `save_bundle` 只做契约校验（JSON 可序列化、顶层字段齐全、字节数 ≤ deck_max_bundle_bytes）
  后写入统一存储；不做业务状态判断；
- `save_thumbnail` 只接受 `data:image/png;base64` 或 `data:image/jpeg;base64`，≤512KB；
- 所有删除都是 best-effort，失败只记日志；
- 本模块不持有 DB session，也不依赖 ORM 对象。
"""
import base64
import binascii
import json
import logging

from ..config import settings
from . import storage

logger = logging.getLogger(__name__)

BUNDLE_FILENAME = "bundle.json"
THUMBNAIL_FILENAME = "thumbnail.png"
BUNDLE_TOP_LEVEL_FIELDS = ("schema_version", "runtime_version", "manifest", "html", "css", "js")
MAX_THUMBNAIL_BYTES = 512 * 1024
ALLOWED_IMAGE_PREFIXES = {
    "data:image/png;base64,": "image/png",
    "data:image/jpeg;base64,": "image/jpeg",
}


class BundleStoreError(ValueError):
    """bundle/缩略图不符合契约（中文文案，可直接展示）。"""


def build_bundle_key(
    user_id: int, workspace_id: int, deck_id: int, page_id: int, version: int
) -> str:
    """页面 bundle 对象 key；版本变化即新对象，旧版本不覆盖。"""
    return (
        f"mockfinal/{user_id}/{workspace_id}/decks/{deck_id}/pages/"
        f"{page_id}/v{int(version)}/{BUNDLE_FILENAME}"
    )


def build_thumbnail_key(
    user_id: int, workspace_id: int, deck_id: int, page_id: int, version: int
) -> str:
    """页面缩略图对象 key（与 bundle 同版本目录）。"""
    return (
        f"mockfinal/{user_id}/{workspace_id}/decks/{deck_id}/pages/"
        f"{page_id}/v{int(version)}/{THUMBNAIL_FILENAME}"
    )


def validate_bundle(bundle: object, *, max_bytes: int | None = None) -> bytes:
    """校验 bundle 并返回序列化字节；任何不合契约的输入都抛 BundleStoreError。"""
    if not isinstance(bundle, dict):
        raise BundleStoreError("页面 bundle 必须是 JSON 对象")
    missing = [field for field in BUNDLE_TOP_LEVEL_FIELDS if field not in bundle]
    if missing:
        raise BundleStoreError(f"页面 bundle 缺少必需字段：{'、'.join(missing)}")
    if not isinstance(bundle.get("manifest"), dict):
        raise BundleStoreError("页面 bundle 的 manifest 必须是 JSON 对象")
    for field in ("schema_version", "runtime_version"):
        if not isinstance(bundle.get(field), str) or not bundle[field].strip():
            raise BundleStoreError(f"页面 bundle 的 {field} 必须是非空字符串")
    for field in ("html", "css", "js"):
        if not isinstance(bundle.get(field), str):
            raise BundleStoreError(f"页面 bundle 的 {field} 必须是字符串")
    try:
        # allow_nan=False + 不提供 default：拒绝 NaN / 非 JSON 类型，避免写入脏数据
        data = json.dumps(bundle, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode(
            "utf-8"
        )
    except (TypeError, ValueError) as exc:
        raise BundleStoreError("页面 bundle 含无法序列化为 JSON 的内容，已拒绝保存") from exc
    limit = settings.deck_max_bundle_bytes if max_bytes is None else int(max_bytes)
    if len(data) > limit:
        raise BundleStoreError(
            f"页面 bundle 体积 {len(data)} 字节，超过单页上限 {limit} 字节，请精简页面内容"
        )
    return data


async def save_bundle(
    *,
    user_id: int,
    workspace_id: int,
    deck_id: int,
    page_id: int,
    version: int,
    bundle: dict,
    max_bytes: int | None = None,
) -> str:
    """校验并保存 bundle，返回对象 key。"""
    data = validate_bundle(bundle, max_bytes=max_bytes)
    key = build_bundle_key(user_id, workspace_id, deck_id, page_id, version)
    await storage.save(key, data, content_type="application/json")
    logger.info("已保存页面 bundle：page_id=%s version=%s bytes=%d", page_id, version, len(data))
    return key


async def load_bundle(bundle_key: str) -> dict:
    """读取并解析 bundle；对象不存在抛 FileNotFoundError，内容损坏抛 BundleStoreError。"""
    data = await storage.read(bundle_key)
    try:
        payload = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BundleStoreError("页面 bundle 数据损坏，无法解析，请重新生成页面") from exc
    if not isinstance(payload, dict):
        raise BundleStoreError("页面 bundle 数据损坏，无法解析，请重新生成页面")
    return payload


def decode_data_uri(data_uri: str) -> tuple[bytes, str]:
    """解析 png/jpeg data URI，返回 (bytes, content_type)；≤512KB。"""
    if not isinstance(data_uri, str):
        raise BundleStoreError("缩略图必须是 data URI 字符串")
    for prefix, content_type in ALLOWED_IMAGE_PREFIXES.items():
        if data_uri.startswith(prefix):
            encoded = data_uri[len(prefix):]
            break
    else:
        raise BundleStoreError("缩略图只接受 data:image/png;base64 或 data:image/jpeg;base64")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise BundleStoreError("缩略图 base64 数据不合法") from exc
    if not data:
        raise BundleStoreError("缩略图内容为空")
    if len(data) > MAX_THUMBNAIL_BYTES:
        raise BundleStoreError(
            f"缩略图 {len(data)} 字节，超过 {MAX_THUMBNAIL_BYTES} 字节上限"
        )
    return data, content_type


def detect_image_content_type(data: bytes) -> str:
    """按魔数识别 png/jpeg；未知类型返回 application/octet-stream。"""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return "application/octet-stream"


async def save_thumbnail(
    *,
    user_id: int,
    workspace_id: int,
    deck_id: int,
    page_id: int,
    version: int,
    image: str | bytes,
) -> str:
    """保存缩略图（data URI 或原始字节），返回对象 key。"""
    if isinstance(image, str):
        data, _ = decode_data_uri(image)
    elif isinstance(image, bytes):
        if not image:
            raise BundleStoreError("缩略图内容为空")
        if len(image) > MAX_THUMBNAIL_BYTES:
            raise BundleStoreError(
                f"缩略图 {len(image)} 字节，超过 {MAX_THUMBNAIL_BYTES} 字节上限"
            )
        data = image
    else:
        raise BundleStoreError("缩略图必须是 data URI 字符串或字节")
    content_type = detect_image_content_type(data)
    if content_type == "application/octet-stream":
        raise BundleStoreError("缩略图必须是 PNG 或 JPEG")
    key = build_thumbnail_key(user_id, workspace_id, deck_id, page_id, version)
    await storage.save(key, data, content_type=content_type)
    return key


async def delete_page_objects(bundle_key: str | None, thumbnail_key: str | None) -> None:
    """删除页面存储对象（best-effort）；任何失败只记日志，不影响 DB 清理。"""
    for key in (bundle_key, thumbnail_key):
        if not key:
            continue
        try:
            await storage.delete(key)
        except Exception:  # noqa: BLE001 —— 外部清理失败不得阻断删除/重建主流程
            logger.warning("删除页面存储对象失败（已忽略）：%s", key, exc_info=True)
