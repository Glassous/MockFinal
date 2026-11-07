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

// 枚举保留以兼容后端契约；indexing/indexed 语义为「解析中 / 已就绪」
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
  /** 分节数（字段名保留旧契约） */
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

// ===== 复习页（Deck）=====
export type DeckPreset = 'editorial' | 'blueprint' | 'drill' | 'story'
export type DeckDensity = 'concise' | 'standard' | 'deep'
export type DeckStatus =
  | 'draft'
  | 'planning'
  | 'building'
  | 'ready'
  | 'partial'
  | 'failed'
  | 'canceled'
export type DeckPageStatus =
  | 'planned'
  | 'building'
  | 'validating'
  | 'ready'
  | 'failed'
  | 'canceled'
export type DeckJobStatus =
  | 'pending'
  | 'planning'
  | 'building'
  | 'validating'
  | 'done'
  | 'partial'
  | 'failed'
  | 'canceled'

export interface DeckStyle {
  preset: DeckPreset
  content: string[]
  density: DeckDensity
  custom_prompt: string
}

export interface DeckCreate {
  title?: string
  style?: Partial<DeckStyle>
}

export interface DeckUpdate {
  title?: string
  style?: Partial<DeckStyle>
}

export interface OutlineKnowledgePoint {
  title: string
  summary?: string
  importance?: 'core' | 'normal' | 'minor'
  difficulty?: 'easy' | 'medium' | 'hard'
  objectives?: string[]
  key_points?: string[]
  formulas?: string[]
  misconceptions?: string[]
  section_ids?: number[]
  interaction_idea?: string
  page_count?: number
  source_refs?: Record<string, unknown>[]
  source_unverified?: boolean
}

export interface OutlineChapter {
  title: string
  knowledge_points: OutlineKnowledgePoint[]
}

export interface PagePlanEntry {
  ordinal: number
  title: string
  kind: string
  kp_indices: number[]
  primary_kp_index: number
}

export interface DeckOutline {
  chapters?: OutlineChapter[]
  page_plan?: PagePlanEntry[]
  density?: DeckDensity
  generated_at?: string
  source_signature?: string
  unverified_knowledge_points?: number
}

export interface DeckPageSummary {
  id: number
  ordinal: number
  title: string
  kind: string
  status: DeckPageStatus
  current_version: number
  primary_knowledge_point_id: number | null
  knowledge_point_ids: number[]
  has_bundle: boolean
  manifest_title: string | null
  validation_status: string | null
  validation_issue_count: number
}

export interface Deck {
  id: number
  workspace_id: number
  title: string
  status: DeckStatus
  style: Partial<DeckStyle>
  outline: DeckOutline
  source_signature: string | null
  last_page_id: number | null
  completed_page_ids: number[]
  created_at: string
  updated_at: string
  pages: DeckPageSummary[]
  total_pages: number
  ready_pages: number
  failed_pages: number
  planned_pages: number
  continue_page_id: number | null
  active_job_id: number | null
  last_job_id: number | null
  source_changed: boolean
}

export interface DeckPage {
  id: number
  deck_id: number
  knowledge_point_ids: number[]
  primary_knowledge_point_id: number | null
  ordinal: number
  title: string
  kind: string
  status: DeckPageStatus
  current_version: number
  bundle_key: string | null
  thumbnail_key: string | null
  manifest: Record<string, unknown>
  validation: Record<string, unknown>
  build_attempts: number
  builder_build_id: string | null
  created_at: string
  updated_at: string
}

export interface DeckJob {
  id: number
  deck_id: number
  workspace_id: number
  status: DeckJobStatus
  stage: string | null
  progress: number
  total_pages: number
  ready_pages: number
  failed_pages: number
  error: string | null
  cancel_requested: boolean
  target_page_id: number | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface DeckEvent {
  id: number
  job_id: number
  page_id: number | null
  type: string
  payload: Record<string, unknown>
  created_at: string
}

export interface DeckBuildResponse {
  job_id: number
}

export interface DeckProgress {
  last_page_id: number | null
  completed_page_ids: number[]
}

export interface PageManifest {
  schema_version?: string
  page_id?: string
  title?: string
  subtitle?: string
  knowledge_point_ids?: string[]
  importance?: string
  estimated_minutes?: number
  layout?: string
  interactions?: {
    id: string
    type: string
    label?: string
    smoke?: Record<string, unknown>
  }[]
  source_refs?: {
    material_id?: number
    section_id?: number
    heading?: string
    quote?: string
    unverified?: boolean
  }[]
  assistant?: {
    summary?: string
    key_facts?: string[]
    suggested_questions?: string[]
  }
  a11y?: Record<string, unknown>
  [key: string]: unknown
}

export interface PageBundle {
  schema_version: string
  runtime_version: string
  manifest: PageManifest
  html: string
  css: string
  js: string
}

export interface PageChatMessage {
  id: number
  deck_id: number
  page_id: number
  role: 'user' | 'assistant'
  status: string
  content: string
  quote: string | null
  context_refs: Record<string, unknown>[]
  created_at: string
}

export interface PageSelection {
  text: string
  blockText: string
  rect: { x: number; y: number; width: number; height: number } | null
}
