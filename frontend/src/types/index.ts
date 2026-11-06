// 全局共享类型定义（与后端 API 契约逐字对齐）

export interface User {
  id: number
  username: string
}

export interface AuthResponse {
  token: string
  user: User
}

export interface SecurityQuestionResponse {
  question: string
}

export interface VerifyAnswerResponse {
  reset_token: string
}

export interface Workspace {
  id: number
  name: string
  description: string | null
  created_at: string
}

export interface WorkspaceCreate {
  name: string
  description?: string
}

export interface WorkspaceUpdate {
  name?: string
  description?: string
}

export type MaterialStatus = 'uploaded' | 'indexing' | 'indexed' | 'failed'

export interface Material {
  id: number
  workspace_id: number
  filename: string
  storage_key: string
  size: number
  content_type: string
  status: MaterialStatus
  error: string | null
  chunk_count: number
  created_at: string
}

/** OSS 模式下登记资料的 JSON 负载 */
export interface MaterialCreate {
  filename: string
  storage_key: string
  size: number
  content_type: string
}

export interface OssCredentials {
  mode: 'oss'
  accessKeyId: string
  accessKeySecret: string
  securityToken: string
  expiration: string
  region: string
  bucket: string
  key_prefix: string
}

export interface LocalCredentials {
  mode: 'local'
}

export type UploadCredentials = OssCredentials | LocalCredentials

export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

export interface Job {
  id: number
  status: JobStatus
  stage: string | null
  error: string | null
}

export interface GenerateResponse {
  job_id: number
}

export type ArtifactKind = 'review' | 'exam'

export interface ArtifactMeta {
  id: number
  kind: ArtifactKind
  title: string
  created_at: string
}

export interface Artifact extends ArtifactMeta {
  content: string
}
