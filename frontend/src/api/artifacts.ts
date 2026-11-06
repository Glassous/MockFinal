import { request } from './client'
import type { Artifact, ArtifactMeta } from '@/types'

/** 某工作区下的工件列表（复习 review / 试卷 exam） */
export function listArtifacts(workspaceId: number): Promise<ArtifactMeta[]> {
  return request<ArtifactMeta[]>(`/workspaces/${workspaceId}/artifacts`)
}

/** 获取工件全文（含 Markdown content） */
export function getArtifact(id: number): Promise<Artifact> {
  return request<Artifact>(`/artifacts/${id}`)
}

export function deleteArtifact(id: number): Promise<void> {
  return request<void>(`/artifacts/${id}`, { method: 'DELETE' })
}
