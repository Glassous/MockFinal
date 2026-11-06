"""生成路由：触发生成任务 / 查询任务状态。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..models import GenerationJob, Material, User, Workspace
from ..schemas import GenerateResponse, JobOut
from ..services.generator import run_generation_job
from ..tasks import spawn
from .workspaces import get_owned_workspace

router = APIRouter(prefix="/api", tags=["generation"])


@router.post("/workspaces/{workspace_id}/generate", response_model=GenerateResponse, status_code=200)
async def generate(
    workspace_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    workspace: Workspace = await get_owned_workspace(workspace_id, user, db)

    if not settings.llm_configured:
        raise HTTPException(
            status_code=400,
            detail="未配置 LLM 服务（缺少 LLM_API_KEY），无法生成复习资料，请先在后端 .env 中配置",
        )

    indexed = await db.execute(
        select(Material.id)
        .where(Material.workspace_id == workspace_id, Material.status == "indexed")
        .limit(1)
    )
    if indexed.first() is None:
        raise HTTPException(status_code=400, detail="当前工作区没有已索引完成的资料，请先上传资料并等待索引完成")

    running = await db.execute(
        select(GenerationJob)
        .where(
            GenerationJob.workspace_id == workspace_id,
            GenerationJob.status.in_(["pending", "running"]),
        )
        .limit(1)
    )
    if running.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="当前工作区已有正在进行的生成任务，请等待其完成")

    job = GenerationJob(workspace_id=workspace_id, status="pending", stage="任务已创建，等待执行…")
    db.add(job)
    try:
        await db.commit()
    except IntegrityError:
        # 部分唯一索引 uq_job_active 兜底：并发下同一工作区只能有一个活跃任务（#13）
        await db.rollback()
        raise HTTPException(status_code=409, detail="当前工作区已有正在进行的生成任务，请等待其完成")
    await db.refresh(job)

    spawn(run_generation_job(job.id))
    return GenerateResponse(job_id=job.id)


@router.get("/jobs/{job_id}", response_model=JobOut, status_code=200)
async def get_job(
    job_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job = await db.get(GenerationJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    workspace = await db.get(Workspace, job.workspace_id)
    if workspace is None or workspace.user_id != user.id:
        raise HTTPException(status_code=404, detail="任务不存在")
    return job
