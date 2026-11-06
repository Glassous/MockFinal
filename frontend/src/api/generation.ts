import { request } from './client'
import type { GenerateResponse, Job } from '@/types'

/** 触发生成任务（复习大纲 + 模拟试卷），返回 job_id */
export function generate(workspaceId: number): Promise<GenerateResponse> {
  return request<GenerateResponse>(`/workspaces/${workspaceId}/generate`, { method: 'POST' })
}

/** 查询任务状态（前端 2s 轮询） */
export function getJob(id: number): Promise<Job> {
  return request<Job>(`/jobs/${id}`)
}
