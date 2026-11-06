import { request } from './client'
import type { Workspace, WorkspaceCreate, WorkspaceUpdate } from '@/types'

export function listWorkspaces(): Promise<Workspace[]> {
  return request<Workspace[]>('/workspaces')
}

export function createWorkspace(payload: WorkspaceCreate): Promise<Workspace> {
  return request<Workspace>('/workspaces', { method: 'POST', body: payload })
}

export function getWorkspace(id: number): Promise<Workspace> {
  return request<Workspace>(`/workspaces/${id}`)
}

export function updateWorkspace(id: number, payload: WorkspaceUpdate): Promise<Workspace> {
  return request<Workspace>(`/workspaces/${id}`, { method: 'PATCH', body: payload })
}

export function deleteWorkspace(id: number): Promise<void> {
  return request<void>(`/workspaces/${id}`, { method: 'DELETE' })
}
