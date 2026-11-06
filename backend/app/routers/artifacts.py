"""工件路由：复习大纲 / 模拟试卷的列表、详情（含 Markdown 全文）、删除。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import get_current_user
from ..models import Artifact, User, Workspace
from ..schemas import ArtifactDetail, ArtifactOut
from ..services import storage

router = APIRouter(prefix="/api", tags=["artifacts"])


async def get_owned_artifact(artifact_id: int, user: User, db: AsyncSession) -> Artifact:
    """归属校验（经工作区上溯到用户）：他人资源一律 404。"""
    artifact = await db.get(Artifact, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="生成结果不存在")
    workspace = await db.get(Workspace, artifact.workspace_id)
    if workspace is None or workspace.user_id != user.id:
        raise HTTPException(status_code=404, detail="生成结果不存在")
    return artifact


@router.get("/workspaces/{workspace_id}/artifacts", response_model=list[ArtifactOut], status_code=200)
async def list_artifacts(
    workspace_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from .workspaces import get_owned_workspace

    await get_owned_workspace(workspace_id, user, db)
    result = await db.execute(
        select(Artifact)
        .where(Artifact.workspace_id == workspace_id)
        .order_by(Artifact.created_at.desc(), Artifact.id.desc())
    )
    return result.scalars().all()


@router.get("/artifacts/{artifact_id}", response_model=ArtifactDetail, status_code=200)
async def get_artifact(
    artifact_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    artifact = await get_owned_artifact(artifact_id, user, db)
    try:
        data = await storage.read(artifact.storage_key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="生成结果文件不存在或已被删除") from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"读取生成结果失败：{exc}") from exc
    content = data.decode("utf-8", errors="replace")
    return ArtifactDetail(
        id=artifact.id,
        kind=artifact.kind,
        title=artifact.title,
        content=content,
        created_at=artifact.created_at,
    )


@router.delete("/artifacts/{artifact_id}", status_code=204)
async def delete_artifact(
    artifact_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    artifact = await get_owned_artifact(artifact_id, user, db)
    await db.delete(artifact)
    await db.commit()
    await storage.delete(artifact.storage_key)
    return None
