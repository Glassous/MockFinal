/**
 * 共享类型。字段以 docs/pageref/INTERNAL_API.md 与 PAGE_CONTRACT.md 为准。
 * 这里只描述 Builder 内部与 HTTP 接口需要的结构，不做运行时校验（校验在 bundle.ts）。
 */

export type BuildStatus =
  | "queued"
  | "running"
  | "validating"
  | "succeeded"
  | "failed"
  | "canceled";

export type BuildEventType =
  | "stage"
  | "text"
  | "tool"
  | "check"
  | "page_done"
  | "error"
  | "retry";

export interface BuildEvent {
  seq: number;
  type: BuildEventType;
  payload: Record<string, unknown>;
  at: string;
}

export interface SourceExcerpt {
  section_id: number | string;
  material_id?: number;
  heading?: string;
  text: string;
}

export interface KnowledgePoint {
  title: string;
  summary?: string;
  objectives?: string[];
  key_points?: string[];
  formulas?: string[];
  misconceptions?: string[];
  importance?: string;
}

export interface PageStyle {
  preset?: string;
  content?: string[];
  custom_prompt?: string;
  density?: string;
  design_system?: string;
  page_theme?: string;
}

export interface PageConstraints {
  viewport?: string[];
  no_scroll?: boolean;
  no_network?: boolean;
  max_bundle_bytes?: number;
  runtime_version?: string;
  schema_version?: string;
  language?: string;
  content_schema?: string;
  design_system?: string;
  page_theme?: string;
}

export interface TeachingDensity {
  visible_layer_chars?: number;
  total_page_chars?: number;
  visible_blocks?: number;
  total_blocks?: number;
  primary_interactions?: number;
  checks?: number;
}

export interface TeachingContract {
  objectives?: string[];
  prerequisites?: string[];
  hook?: string;
  check_idea?: string;
  worked_example_idea?: string;
  required?: string[];
  density?: TeachingDensity;
}

export interface DeckContext {
  previous_learning?: string;
  next_hook?: string;
  chapter_index?: number | null;
  chapter_total?: number | null;
  chapter_title?: string;
}

/** Deck lane 会话元数据（P11）；缺省时走逐页模式。 */
export interface BuildSessionMeta {
  key: string;
  lane?: number;
  page_index?: number;
  page_total?: number;
  first?: boolean;
}

export interface PageBrief {
  page_id: string;
  deck_title?: string;
  role?: string;
  knowledge_point: KnowledgePoint;
  knowledge_point_ids?: string[];
  estimated_minutes?: number;
  merged_knowledge_points?: KnowledgePoint[];
  source_excerpts?: SourceExcerpt[];
  style?: PageStyle;
  interaction_idea?: string;
  teaching_contract?: TeachingContract;
  deck_context?: DeckContext;
  constraints?: PageConstraints;
  previous_page?: unknown;
  next_page?: unknown;
}

export interface CreateBuildRequest {
  build_id: string;
  page_brief: PageBrief;
  session?: BuildSessionMeta;
  feedback?: string | null;
  deadline_seconds?: number;
}

export interface ManifestInteraction {
  id?: string;
  type?: string;
  label?: string;
  smoke?: {
    action?: string;
    selector?: string;
    expect?: string;
    value?: string;
  };
}

export interface Manifest {
  schema_version: string;
  page_id: string;
  title: string;
  subtitle?: string;
  knowledge_point_ids: string[];
  importance: string;
  estimated_minutes: number;
  layout: string;
  interactions: ManifestInteraction[];
  source_refs: Array<Record<string, unknown>>;
  design_system?: string;
  teaching?: Record<string, unknown>;
  assistant?: {
    summary?: string;
    key_facts?: string[];
    suggested_questions?: string[];
  };
  a11y: { reduced_motion: boolean };
  [key: string]: unknown;
}

export interface PageBundle {
  schema_version: string;
  runtime_version: string;
  manifest: Manifest;
  html: string;
  css: string;
  js: string;
}

export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  selector?: string;
  viewport?: string;
}

export interface ValidationReport {
  status: "passed" | "warning" | "failed";
  issues: ValidationIssue[];
  screenshots?: unknown[];
  duration_ms?: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface BuildUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  /** 按 PAGE_BUILDER_COST_* 单价估算，币种与模型网关计费币种一致。 */
  cost: number;
  duration_ms: number;
}

export interface BuildSnapshot {
  build_id: string;
  status: BuildStatus;
  stage: string;
  attempts: number;
  error: string | null;
  events_cursor: number;
  usage: BuildUsage;
  validation: ValidationReport | null;
  harness_version: string;
  runtime_version: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  page_id: string;
  session_key?: string;
  lane?: number;
}

/** 单个文件的收集结果，用于事件与报告（不包含文件正文）。 */
export interface CollectedFile {
  name: string;
  bytes: number;
}

/** 静态打包检查发现的问题，可直接转成修复提示。 */
export interface BundleIssue {
  code: string;
  message: string;
  file?: string;
}

/**
 * Guard 扩展与 Builder 之间的进程内契约。
 * 扩展通过 Symbol.for("mockfinal.guard.contexts") 取得按 build cwd 索引的实例，
 * 因此扩展不需要导入 dist，也不会读取宿主配置。
 */
export interface GuardContext {
  /** 当前活动页面的产物目录；write/edit 只允许这里的产物文件。 */
  buildDir: string;
  /** 会话可读根目录（lane 模式为 deck 根）；缺省等于 buildDir。 */
  readRoot?: string;
  harnessDir: string;
  /** content 2.0 模式：只允许写 content.json。 */
  contentMode?: boolean;
  checkPage: (args: {
    note?: string;
    page_id?: string;
  }) => Promise<{ report: ValidationReport; text: string; bundleBytes: number }>;
  reportProgress: (payload: { stage: string; detail?: string }) => void;
  recordFileList: (files: string[]) => void;
  /** 当前已用修复轮次（由扩展递增，Builder 只读取）。 */
  repairRounds: () => number;
  consumeRepairRound: () => number;
}

export const GUARD_CONTEXT_SYMBOL = Symbol.for("mockfinal.guard.contexts");
