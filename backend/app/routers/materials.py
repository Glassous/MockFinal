"""资料路由（按 material id 操作）：列表 / 删除 / 下载。"""
import mimetypes
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_current_user
from ..models import Material, User, Workspace
from ..schemas import MaterialOut
from ..services import storage

router = APIRouter(prefix="/api", tags=["materials"])


async def get_owned_material(material_id: int, user: User, db: AsyncSession) -> Material:
    """归属校验（经工作区上溯到用户）：他人资源一律 404。"""
    material = await db.get(Material, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="资料不存在")
    workspace = await db.get(Workspace, material.workspace_id)
    if workspace is None or workspace.user_id != user.id:
        raise HTTPException(status_code=404, detail="资料不存在")
    return material


@router.get("/workspaces/{workspace_id}/materials", response_model=list[MaterialOut], status_code=200)
async def list_materials(
    workspace_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from .workspaces import get_owned_workspace

    await get_owned_workspace(workspace_id, user, db)
    result = await db.execute(
        select(Material).where(Material.workspace_id == workspace_id).order_by(Material.created_at)
    )
    return result.scalars().all()


@router.delete("/materials/{material_id}", status_code=204)
async def delete_material(
    material_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除资料：分节（FK cascade）+ 存储对象 + 数据库行。"""
    material = await get_owned_material(material_id, user, db)
    await db.delete(material)
    await db.commit()
    await storage.delete(material.storage_key)
    return None


@router.get("/materials/{material_id}/download", status_code=200)
async def download_material(
    material_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    material = await get_owned_material(material_id, user, db)
    try:
        stream = await storage.open_stream(material.storage_key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="文件对象不存在或已被删除") from exc
    media_type = (
        material.content_type
        or mimetypes.guess_type(material.filename)[0]
        or "application/octet-stream"
    )
    disposition = f"attachment; filename*=UTF-8''{quote(material.filename)}"
    return StreamingResponse(stream, media_type=media_type, headers={"Content-Disposition": disposition})
