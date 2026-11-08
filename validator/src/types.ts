/**
 * Validator 契约类型（docs/pageref/PAGE_CONTRACT.md §3、§4、§10.3；docs/pageref/INTERNAL_API.md §4）
 *
 * 请求体来自网络，因此 Bundle/Manifest 只按「声明形状」定义；
 * 真正的字段校验在 static-check.ts 中以 unknown 收窄完成。
 */

export type Severity = 'error' | 'warning';

export type ReportStatus = 'passed' | 'warning' | 'failed';

/** 单条校验问题；message 必须是中文，可定位时附 selector 与 viewport。 */
export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  selector?: string;
  viewport?: string;
}

/** 冒烟步骤（契约 §4.2）。 */
export interface Smoke {
  action: 'click' | 'input' | 'step';
  selector: string;
  expect: string;
  value?: string;
}

/** 交互声明（契约 §4.2）。 */
export interface Interaction {
  id: string;
  type: string;
  label: string;
  smoke: Smoke | null;
}

/** 来源引用（契约 §4.3）。 */
export interface SourceRef {
  material_id: number;
  section_id: number;
  quote: string;
}

/** 页面 AI 助手上下文（契约 §4.1）。 */
export interface AssistantContext {
  summary?: string;
  key_facts?: string[];
  suggested_questions?: string[];
}

/** Manifest（契约 §4）。 */
export interface Manifest {
  schema_version: string;
  page_id: string;
  title: string;
  subtitle?: string;
  knowledge_point_ids: string[];
  importance: string;
  estimated_minutes: number;
  layout: string;
  interactions: Interaction[];
  source_refs: SourceRef[];
  assistant?: AssistantContext;
  design_system?: string;
  renderer?: { kit?: string; version?: string; theme?: string };
  teaching?: Record<string, unknown>;
  a11y: { reduced_motion: true };
}

/** PageBundle（契约 §3.1）。 */
export interface Bundle {
  schema_version: string;
  runtime_version: string;
  manifest: Manifest;
  html: string;
  css: string;
  js: string;
}

/** 验收视口。 */
export interface Viewport {
  width: number;
  height: number;
}

/** 截图；data_uri 为 PNG/JPEG 的 data URI。 */
export interface Screenshot {
  viewport: string;
  data_uri: string;
}

/** 教学结构评分（仅 schema 1.1 页面返回）。 */
export interface TeachingScore {
  score: number;
  criteria: Record<string, number>;
  warnings: string[];
}

/** 校验报告（契约 §10.3 / INTERNAL_API §4.1）。 */
export interface Report {
  status: ReportStatus;
  issues: Issue[];
  screenshots: Screenshot[];
  duration_ms: number;
  teaching?: TeachingScore;
}

/** 静态检查结果：不执行页面代码，只产出 issues。 */
export interface StaticCheckResult {
  issues: Issue[];
  bundle: Bundle | null;
}

/** 默认验收视口：三个桌面视口为硬门禁（契约 §9.2）。 */
export const DEFAULT_VIEWPORTS: readonly Viewport[] = Object.freeze([
  Object.freeze({ width: 1280, height: 720 }),
  Object.freeze({ width: 1440, height: 900 }),
  Object.freeze({ width: 1920, height: 1080 })
]);

/** 运行时版本；当前版本必须与 shared/page-runtime/runtime.js 顶部声明一致。 */
export const RUNTIME_VERSION = '1.1.0';
/** Shell/Validator/前端同时兼容的 runtime 版本（1.0 旧页面继续可读）。 */
export const RUNTIME_VERSIONS: readonly string[] = Object.freeze(['1.0.0', '1.1.0']);

/** Bundle 结构版本（当前）。 */
export const BUNDLE_SCHEMA_VERSION = '1.1';
/** 同时兼容的 bundle schema 版本。 */
export const BUNDLE_SCHEMA_VERSIONS: readonly string[] = Object.freeze(['1.0', '1.1']);

/** Bundle 总字节数上限（2 MiB）。 */
export const MAX_BUNDLE_BYTES = 2097152;

/** 校验请求体上限（6 MiB，INTERNAL_API §1）。 */
export const MAX_REQUEST_BYTES = 6 * 1024 * 1024;

/** 页面就绪超时（契约 §8.4）。 */
export const READY_TIMEOUT_MS = 10_000;

/** 冒烟 expect 等待超时。 */
export const SMOKE_TIMEOUT_MS = 3_000;

/** 单张截图上限 512 KB（INTERNAL_API §4.1）。 */
export const MAX_SCREENSHOT_BYTES = 512 * 1024;

export function viewportLabel(viewport: Viewport): string {
  return `${viewport.width}x${viewport.height}`;
}

/** 根据 issues 计算 status：error 优先，其次 warning。 */
export function statusOf(issues: readonly Issue[]): ReportStatus {
  if (issues.some((issue) => issue.severity === 'error')) return 'failed';
  if (issues.some((issue) => issue.severity === 'warning')) return 'warning';
  return 'passed';
}
