import type { PageRole, ScrollMode } from './types.js';

/** 2.0 的密度与结构预算；与 page-kit CSS / Validator 2.0 规则保持同一口径。 */
export const PAGE_LIMITS = {
  minBlocks: 3,
  maxBlocks: 10,
  minChecks: 1,
  maxChecks: 3,
  minExampleSteps: 3,
  maxExampleSteps: 5,
  minFigureStates: 2,
  maxFigureStates: 4,
  maxObjectives: 3,
  maxTitle: 80,
  maxLede: 120,
  maxCalloutTitle: 40,
  maxProseCjk: 1800,
  fitMaxCjk: 900,
  flowMaxViewports: 2.2,
  figureMaxShare: 0.35,
  figureMaxWidthPx: 360,
} as const;

/** 每个角色的最低有效正文量（汉字，含块内标点不计）。 */
export const ROLE_MIN_CJK: Record<PageRole, number> = {
  concept: 300,
  mechanism: 320,
  worked_example: 340,
  practice: 340,
  compare: 320,
  summary: 220,
};

/** fit 页目标单屏，正文上限按角色收紧；flow 页仍用 PAGE_LIMITS.maxProseCjk。 */
export const FIT_MAX_CJK: Record<PageRole, number> = {
  concept: 1800,
  mechanism: 1800,
  worked_example: 1800,
  practice: 520,
  compare: 1800,
  summary: 380,
};

/** fit 页只保留必要块，防止讲解块把检查挤出单屏。 */
export const ROLE_MAX_BLOCKS: Record<PageRole, number> = {
  concept: 10,
  mechanism: 10,
  worked_example: 10,
  practice: 3,
  compare: 3,
  summary: 3,
};

/** fit 角色用检查题承载练习，不需要凑满 3 个讲解块。 */
export const ROLE_MIN_BLOCKS: Record<PageRole, number> = {
  concept: 3,
  mechanism: 3,
  worked_example: 2,
  practice: 1,
  compare: 2,
  summary: 2,
};

export const ROLE_SCROLL: Record<PageRole, ScrollMode> = {
  concept: 'flow',
  mechanism: 'flow',
  worked_example: 'flow',
  practice: 'fit',
  // compare 需要两栏对照 + 结论 + 检查，1280×720 单屏放不下，允许页内滚动
  compare: 'flow',
  summary: 'fit',
};

export const ROLE_CHECK_RANGE: Record<PageRole, [number, number]> = {
  concept: [1, 1],
  mechanism: [1, 1],
  worked_example: [1, 1],
  practice: [2, 4],
  compare: [1, 1],
  summary: [0, 3],
};

export function countCjk(text: string): number {
  const matches = String(text).match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g);
  return matches ? matches.length : 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
