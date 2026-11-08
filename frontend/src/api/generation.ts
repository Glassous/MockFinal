import { request } from './client'
import type { GenerateResponse, Job } from '@/types'

/** 触发生成任务（复习大纲 + 模拟试卷），返回 job_id */
export function generate(workspaceId: number): Promise<GenerateResponse> {
  return request<GenerateResponse>(`/workspaces/${workspaceId}/generate`, { method: 'POST' })
}

/** 查询任务状态（断线恢复 / 多标签页兜底） */
export function getJob(id: number): Promise<Job> {
  return request<Job>(`/jobs/${id}`)
}

/**
 * 推进一个生成工作单元。
 * 每次请求只做一件事（一次 LLM 调用或一次落盘），由前端循环驱动；
 * 返回最新 Job 快照，终态为 done / failed。
 */
export function advanceJob(id: number): Promise<Job> {
  return request<Job>(`/jobs/${id}/advance`, { method: 'POST' })
}
