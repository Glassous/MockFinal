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
}

export interface PageStyle {
  preset?: string;
  content?: string[];
  custom_prompt?: string;
  density?: string;
}

export interface PageConstraints {
  viewport?: string[];
  no_scroll?: boolean;
  no_network?: boolean;
  max_bundle_bytes?: number;
  runtime_version?: string;
  language?: string;
}

export interface PageBrief {
  page_id: string;
  deck_title?: string;
  knowledge_point: KnowledgePoint;
  source_excerpts?: SourceExcerpt[];
  style?: PageStyle;
  interaction_idea?: string;
  constraints?: PageConstraints;
  previous_page?: unknown;
  next_page?: unknown;
}

export interface CreateBuildRequest {
  build_id: string;
  page_brief: PageBrief;
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
  buildDir: string;
  harnessDir: string;
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
