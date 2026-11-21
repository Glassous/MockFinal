/**
 * PageContent 2.0：Pi 只写这份结构化内容，布局/排版/交互由 page-kit 统一渲染。
 * Bundle 仍是 schema 1.1；design_system="2.0" 只改变 manifest 与 shell 注入的 kit。
 */

export const PAGE_KIT_VERSION = '2.0.0';
export const PAGE_THEMES = ['editorial', 'workbench', 'problem'] as const;
export type PageTheme = (typeof PAGE_THEMES)[number];

export const PAGE_ROLES = [
  'concept',
  'mechanism',
  'worked_example',
  'practice',
  'compare',
  'summary',
] as const;
export type PageRole = (typeof PAGE_ROLES)[number];

export type ScrollMode = 'flow' | 'fit';

export const ROLE_LABELS: Record<PageRole, string> = {
  concept: '概念',
  mechanism: '机制',
  worked_example: '例题',
  practice: '练习',
  compare: '对照',
  summary: '小结',
};

export interface SourceRef {
  material_id?: number;
  section_id?: number;
  heading?: string;
  quote: string;
}

export interface ProseBlock {
  type: 'prose';
  id?: string;
  title?: string;
  text: string;
}

export interface FormulaBlock {
  type: 'formula';
  id?: string;
  title?: string;
  tex: string;
  label?: string;
  display?: boolean;
}

export type CalloutKind = 'definition' | 'theorem' | 'key' | 'warn' | 'pitfall' | 'note';

export interface CalloutBlock {
  type: 'callout';
  id?: string;
  kind: CalloutKind;
  title?: string;
  text: string;
}

export interface ExampleStep {
  title: string;
  text: string;
  tex?: string;
}

export interface ExampleBlock {
  type: 'example';
  id?: string;
  label?: string;
  problem: string;
  problemTex?: string;
  steps: ExampleStep[];
  answer: string;
  pitfall?: string;
}

export interface CompareColumn {
  title: string;
  items: string[];
}

export interface CompareBlock {
  type: 'compare';
  id?: string;
  title?: string;
  columns: CompareColumn[];
  verdict?: string;
}

export interface TableBlock {
  type: 'table';
  id?: string;
  title?: string;
  headers: string[];
  rows: string[][];
  caption?: string;
}

export type ContentBlock =
  | ProseBlock
  | FormulaBlock
  | CalloutBlock
  | ExampleBlock
  | CompareBlock
  | TableBlock;

export interface CheckSpec {
  id?: string;
  objective_id?: string;
  question: string;
  questionTex?: string;
  options: string[];
  answer_index: number;
  explanation: string;
}

export interface SummarySpec {
  key_points?: string[];
  misconceptions?: string[];
  next?: string;
}

export interface FigureState {
  label: string;
  note?: string;
  lines?: PlaneLine[];
  paths?: PlanePath[];
  labels?: PlaneLabel[];
  rings?: PlaneRing[];
}

export interface PlanePoint {
  id?: string;
  x: number;
  y: number;
  label?: string;
  kind?: 'point' | 'pole' | 'zero';
  labelDx?: number;
  labelDy?: number;
  labelAnchor?: 'start' | 'middle' | 'end';
}

export interface PlaneCircle {
  id?: string;
  cx: number;
  cy: number;
  r: number;
  label?: string;
  dashed?: boolean;
}

export interface PlaneLine {
  id?: string;
  from: [number, number];
  to: [number, number];
  label?: string;
  dashed?: boolean;
  arrow?: boolean;
}

export interface PlanePath {
  id?: string;
  points: Array<[number, number]>;
  label?: string;
  dashed?: boolean;
  arrow?: boolean;
}

export interface PlaneLabel {
  id?: string;
  x: number;
  y: number;
  text: string;
  tone?: 'ink' | 'muted' | 'faint';
}

export interface PlaneRing {
  id?: string;
  x: number;
  y: number;
  r: number;
  dashed?: boolean;
}

export interface PlaneView {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface ComplexPlaneFigure {
  kind: 'complex-plane';
  caption?: string;
  takeaway?: string;
  view?: PlaneView;
  points?: PlanePoint[];
  circles?: PlaneCircle[];
  lines?: PlaneLine[];
  states: FigureState[];
}

export interface AnnulusFigure {
  kind: 'annulus';
  caption?: string;
  takeaway?: string;
  center?: [number, number];
  innerRadius: number;
  outerRadius: number;
  points?: PlanePoint[];
  states: FigureState[];
}

export type FigureSpec = ComplexPlaneFigure | AnnulusFigure;

export interface PageMeta {
  exam?: string;
  minutes?: number;
  source?: string;
}

export interface PageContent {
  content_version: '2.0';
  role: PageRole;
  title: string;
  eyebrow?: string;
  lede?: string;
  objectives: string[];
  prerequisites?: string[];
  scroll?: ScrollMode;
  blocks: ContentBlock[];
  figure?: FigureSpec | null;
  check?: CheckSpec[];
  summary?: SummarySpec;
  source_refs?: SourceRef[];
  meta?: PageMeta;
}

export interface ContentIssue {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

export interface RenderOptions {
  pageId: string;
  theme: PageTheme;
  knowledgePointIds?: string[];
  importance?: string;
  estimatedMinutes?: number;
  sourceRefs?: Array<Record<string, unknown>>;
  deckTitle?: string;
}

export interface RenderResult {
  html: string;
  css: string;
  js: string;
  manifest: Record<string, unknown>;
  teaching: Record<string, unknown>;
  issues: ContentIssue[];
}

export class PageContentError extends Error {
  readonly issues: ContentIssue[];

  constructor(issues: ContentIssue[]) {
    const first = issues.find((issue) => issue.severity === 'error');
    super(first ? `[${first.code}] ${first.path}: ${first.message}` : '内容不符合 PageContent 2.0');
    this.name = 'PageContentError';
    this.issues = issues;
  }
}
