"""工作区路由：CRUD、上传凭证（OSS STS / local 回退）、资料登记与上传。"""
import asyncio
import logging
import tempfile
from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
# fastapi 0.162 起 fastapi.UploadFile 是 starlette 同名类的子类，而 request.form() 返回的是
# starlette 父类实例，isinstance 必须对比父类才能命中
from starlette.datastructures import UploadFile

from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..models import (
    Artifact,
    DeckPage,
    GenerationJob,
    Material,
    ReviewDeck,
    User,
    Workspace,
)
from ..schemas import (
    MaterialOut,
    MaterialRegisterOSS,
    UploadCredentialsLocal,
    UploadCredentialsOSS,
    WorkspaceCreate,
    WorkspaceOut,
    WorkspaceUpdate,
)
from ..services import storage
from ..services.sectioner import section_material_task
from ..services.sts import assume_upload_role
from ..tasks import spawn

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


async def get_owned_workspace(workspace_id: int, user: User, db: AsyncSession) -> Workspace:
    """归属校验：他人资源一律 404。"""
    workspace = await db.get(Workspace, workspace_id)
    if workspace is None or workspace.user_id != user.id:
        raise HTTPException(status_code=404, detail="工作区不存在")
    return workspace


def _validate_upload(filename: str, size: int) -> str:
    """校验并返回安全文件名；扩展名限 pdf/docx/pptx/md/txt，大小 ≤50MB。"""
    # 反斜杠在 POSIX 下不是分隔符，必须先归一化，避免 Windows 风格穿越名落盘
    raw = (filename or "").strip().replace("\\", "/")
    name = PurePosixPath(raw).name
    if (
        not name
        or name != raw
        or name in {".", ".."}
        or len(raw) > 200
        or any(ord(char) < 32 for char in raw)
    ):
        raise HTTPException(status_code=400, detail="文件名无效")
    ext = PurePosixPath(name).suffix.lower()
    if ext not in settings.allowed_extensions:
        raise HTTPException(status_code=400, detail="仅支持 pdf/docx/pptx/md/txt 格式的文件")
    if size <= 0:
        raise HTTPException(status_code=400, detail="文件内容为空")
    if size > settings.max_upload_size:
        raise HTTPException(status_code=400, detail="文件大小超过 50MB 限制")
    return name


@router.get("", response_model=list[WorkspaceOut], status_code=200)
async def list_workspaces(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Workspace).where(Workspace.user_id == user.id).order_by(Workspace.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=WorkspaceOut, status_code=200)
async def create_workspace(
    body: WorkspaceCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    workspace = Workspace(
        user_id=user.id,
        name=body.name.strip(),
        description=(body.description or "").strip(),
    )
    db.add(workspace)
    await db.commit()
    await db.refresh(workspace)
    return workspace


@router.get("/{workspace_id}", response_model=WorkspaceOut, status_code=200)
async def get_workspace(
    workspace_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await get_owned_workspace(workspace_id, user, db)


@router.patch("/{workspace_id}", response_model=WorkspaceOut, status_code=200)
async def update_workspace(
    workspace_id: int,
    body: WorkspaceUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    workspace = await get_owned_workspace(workspace_id, user, db)
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="工作区名称不能为空")
        workspace.name = name
    if body.description is not None:
        workspace.description = body.description.strip()
    await db.commit()
    await db.refresh(workspace)
    return workspace


@router.delete("/{workspace_id}", status_code=204)
async def delete_workspace(
    workspace_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """级联删除：资料分节、存储对象、工件、任务、资料行、工作区行。"""
    workspace = await get_owned_workspace(workspace_id, user, db)
    materials = (
        await db.execute(select(Material).where(Material.workspace_id == workspace_id))
    ).scalars().all()
    artifacts = (
        await db.execute(select(Artifact).where(Artifact.workspace_id == workspace_id))
    ).scalars().all()
    deck_ids = select(ReviewDeck.id).where(ReviewDeck.workspace_id == workspace_id)
    deck_pages = (
        await db.execute(select(DeckPage).where(DeckPage.deck_id.in_(deck_ids)))
    ).scalars().all()

    # 先清数据库行（同一事务，material_sections 由 FK cascade 清理），再 best-effort 清存储对象
    await db.execute(delete(Artifact).where(Artifact.workspace_id == workspace_id))
    await db.execute(delete(Material).where(Material.workspace_id == workspace_id))
    await db.execute(delete(GenerationJob).where(GenerationJob.workspace_id == workspace_id))
    await db.delete(workspace)
    await db.commit()

    # 外部资源清理 best-effort：DB 行已删，存储对象清理失败不应让整个删除 500（#11）
    for material in materials:
        try:
            await storage.delete(material.storage_key)
        except Exception:  # noqa: BLE001
            logger.warning("删除资料 %s 存储对象失败（已忽略）", material.id, exc_info=True)
    for artifact in artifacts:
        try:
            await storage.delete(artifact.storage_key)
        except Exception:  # noqa: BLE001
            logger.warning("删除工件 %s 存储对象失败（已忽略）", artifact.id, exc_info=True)
    for page in deck_pages:
        for key in (page.bundle_key, page.thumbnail_key):
            if not key:
                continue
            try:
                await storage.delete(key)
            except Exception:  # noqa: BLE001
                logger.warning("删除页面 %s 存储对象失败（已忽略）", page.id, exc_info=True)
    return None


@router.post("/{workspace_id}/upload-credentials", status_code=200)
async def get_upload_credentials(
    workspace_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """OSS 已配置：STS 临时三元组（长期 AK 绝不下发）；未配置：{mode:"local"}。"""
    await get_owned_workspace(workspace_id, user, db)
    if not settings.sts_configured:
        if settings.oss_configured:
            logger.warning("OSS 已配置但缺少 STS_ROLE_ARN，前端直传降级为 local 模式")
        return UploadCredentialsLocal()
    try:
        cred = await assume_upload_role(user.id, workspace_id)
    except Exception:  # noqa: BLE001 —— STS 失败降级为 local 直传，不阻断上传（#10）
        logger.exception("STS AssumeRole 失败，降级为 local 上传模式")
        return UploadCredentialsLocal()
    return UploadCredentialsOSS(
        accessKeyId=cred.access_key_id,
        accessKeySecret=cred.access_key_secret,
        securityToken=cred.security_token,
        expiration=cred.expiration,
        region=f"oss-{settings.oss_region}",
        bucket=settings.oss_bucket,
        key_prefix=f"mockfinal/{user.id}/{workspace_id}/",
    )


async def _schedule_sectioning(material: Material) -> MaterialOut:
    out = MaterialOut.model_validate(material)
    # fire-and-forget：spawn 持强引用，避免任务被 GC 提前回收（#6）
    spawn(section_material_task(material.id))
    return out


@router.post("/{workspace_id}/materials", response_model=MaterialOut, status_code=200)
async def create_material(
    workspace_id: int,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """资料登记/上传：

    - OSS 模式：JSON {filename, storage_key, size, content_type}，
      校验 key 前缀与 head_object（存在性 + 大小一致）；
    - local 模式：multipart/form-data，字段名 "file"，服务端落本地存储。
    """
    workspace = await get_owned_workspace(workspace_id, user, db)
    content_type_header = (request.headers.get("content-type") or "").lower()

    if content_type_header.startswith("multipart/form-data"):
        return await _create_material_local(request, workspace, user, db)
    return await _create_material_oss(request, workspace, user, db)


async def _create_material_oss(
    request: Request,
    workspace: Workspace,
    user: User,
    db: AsyncSession,
) -> MaterialOut:
    """OSS 直传后登记：校验 key 前缀、扩展名、大小，并 head_object 确认对象真实存在。"""
    if not settings.oss_configured:
        raise HTTPException(
            status_code=400,
            detail="服务端未配置 OSS，请以 multipart/form-data（字段名 file）直接上传",
        )
    try:
        raw = await request.json()
        body = MaterialRegisterOSS.model_validate(raw)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"请求体格式错误：{exc.errorCount()} 个字段不合法") from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="请求体必须是合法 JSON") from exc

    filename = _validate_upload(body.filename, body.size)

    expected_prefix = f"mockfinal/{user.id}/{workspace.id}/"
    key = body.storage_key
    if not key.startswith(expected_prefix) or ".." in PurePosixPath(key).parts:
        raise HTTPException(status_code=400, detail=f"storage_key 必须以 {expected_prefix} 开头")

    try:
        actual_size, actual_type = await storage.head(key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail="OSS 上未找到该文件，请确认直传已成功") from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("head_object 失败：workspace_id=%s", workspace.id)
        raise HTTPException(status_code=502, detail="校验 OSS 文件失败，请稍后重试") from exc
    if actual_size != body.size:
        raise HTTPException(status_code=400, detail="文件大小与 OSS 实际对象不一致，请重新上传")

    material = Material(
        workspace_id=workspace.id,
        filename=filename,
        storage_key=key,
        size=actual_size,
        content_type=body.content_type or actual_type,
        status="uploaded",
    )
    db.add(material)
    await db.commit()
    await db.refresh(material)
    return await _schedule_sectioning(material)


async def _create_material_local(
    request: Request,
    workspace: Workspace,
    user: User,
    db: AsyncSession,
) -> MaterialOut:
    """local 模式：multipart 字段名 "file"，流式写入 SpooledTemporaryFile 后落本地回退存储（#8）。"""
    form = await request.form()
    upload = form.get("file")
    if not isinstance(upload, UploadFile):
        raise HTTPException(status_code=400, detail="缺少上传文件字段 file")
    filename = _validate_upload(upload.filename or "", 1)  # 大小在流式写入时校验

    key = storage.build_key(user.id, workspace.id, filename)
    content_type = upload.content_type or "application/octet-stream"
    # ≤10MB 驻留内存，超出自动落盘；边读边计数，超 50MB 立即中断（#8）
    spool = tempfile.SpooledTemporaryFile(max_size=10 * 1024 * 1024)
    size = 0
    try:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > settings.max_upload_size:
                raise HTTPException(status_code=400, detail="文件大小超过 50MB 限制")
            await asyncio.to_thread(spool.write, chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="文件内容为空")
        spool.seek(0)
        await storage.save(key, spool, content_type=content_type)
    finally:
        await upload.close()
        spool.close()

    material = Material(
        workspace_id=workspace.id,
        filename=filename,
        storage_key=key,
        size=size,
        content_type=content_type,
        status="uploaded",
    )
    db.add(material)
    await db.commit()
    await db.refresh(material)
    return await _schedule_sectioning(material)
