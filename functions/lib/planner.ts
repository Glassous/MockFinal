/** Deck 页面计划：由大纲按重要度 × 密度展开为 6–16 页。纯函数，无数据库依赖。 */

export const DENSITY_PAGE_RANGES: Record<string, [number, number]> = {
  concise: [6, 9],
  standard: [10, 14],
  deep: [14, 16],
}

export const MAX_PAGES_PER_KP = 3

export const TEACHING_ROLES = [
  'concept',
  'mechanism',
  'worked_example',
  'practice',
  'compare',
  'summary',
] as const

export type TeachingRole = (typeof TEACHING_ROLES)[number]

export const ROLE_SEQUENCES: Record<TeachingRole, TeachingRole[]> = {
  mechanism: ['mechanism', 'worked_example', 'practice'],
  concept: ['concept', 'worked_example', 'practice'],
  worked_example: ['worked_example', 'practice', 'worked_example'],
  practice: ['practice', 'worked_example', 'practice'],
  compare: ['compare', 'practice', 'worked_example'],
  summary: ['summary', 'concept', 'practice'],
}

export const ROLE_TO_KIND: Record<TeachingRole, string> = {
  concept: 'concept',
  mechanism: 'interactive',
  worked_example: 'interactive',
  practice: 'interactive',
  compare: 'concept',
  summary: 'summary',
}

export const ROLE_MINUTES: Record<TeachingRole, number> = {
  concept: 8,
  mechanism: 10,
  worked_example: 12,
  practice: 8,
  compare: 7,
  summary: 6,
}

export const ROLE_TITLE_SUFFIX: Record<TeachingRole, string> = {
  worked_example: '（例题）',
  practice: '（练习）',
  compare: '（对比）',
  summary: '（小结）',
  mechanism: '（机制）',
  concept: '（概念）',
}

export interface PlannerKnowledgePoint {
  title: string
  summary?: string
  importance?: string
  interaction_idea?: string
  misconceptions?: string[]
  teaching_role_hint?: string
}

export interface PlannerChapter {
  title: string
  knowledge_points: PlannerKnowledgePoint[]
}

export interface PagePlan {
  primary_kp_index: number
  kp_indices: number[]
  title: string
  kind: string
  role: TeachingRole
  ordinal: number
}

export class PlannerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlannerError'
  }
}

function importance(kp: PlannerKnowledgePoint): string {
  const value = String(kp.importance ?? 'normal')
  return value === 'core' || value === 'normal' || value === 'minor' ? value : 'normal'
}

function baseRole(kp: PlannerKnowledgePoint): TeachingRole {
  const hint = String(kp.teaching_role_hint ?? '').trim() as TeachingRole
  if (TEACHING_ROLES.includes(hint)) return hint
  const level = importance(kp)
  const idea = String(kp.interaction_idea ?? '').trim()
  const misconceptions = (kp.misconceptions ?? []).filter(Boolean)
  if (level === 'core') return idea ? 'mechanism' : 'concept'
  if (level === 'minor') return 'summary'
  return !idea && misconceptions.length >= 2 ? 'compare' : 'concept'
}

/** 与旧 Python 版 plan_pages 保持同一规则：目标页数按密度计算并夹在 6–16。 */
export function planPages(chapters: PlannerChapter[], density: string): PagePlan[] {
  const densityKey = String(density ?? 'standard').trim()
  const range = DENSITY_PAGE_RANGES[densityKey]
  if (!range) throw new PlannerError(`不支持的密度：${densityKey}，可选 concise / standard / deep`)
  const [lower, upper] = range

  const flat: Array<{ chapterIndex: number; kp: PlannerKnowledgePoint }> = []
  chapters.forEach((chapter, chapterIndex) => {
    for (const kp of chapter.knowledge_points ?? []) flat.push({ chapterIndex, kp })
  })
  const totalKp = flat.length
  if (totalKp === 0) throw new PlannerError('大纲没有知识点，无法生成页面计划')

  let desired = totalKp
  if (densityKey === 'standard') desired = Math.round(totalKp * 1.25)
  if (densityKey === 'deep') desired = Math.round(totalKp * 1.5)

  let target = Math.min(Math.max(desired, lower), upper)
  target = Math.min(target, totalKp * MAX_PAGES_PER_KP)
  target = Math.max(target, Math.min(lower, totalKp * MAX_PAGES_PER_KP))

  const counts = new Array<number>(totalKp).fill(1)
  if (target >= totalKp) {
    const weight = { core: 0, normal: 1, minor: 2 } as Record<string, number>
    const order = Array.from({ length: totalKp }, (_, index) => index).sort(
      (left, right) => weight[importance(flat[left].kp)] - weight[importance(flat[right].kp)],
    )
    let remaining = target - totalKp
    let cursor = 0
    while (remaining > 0 && cursor < order.length * MAX_PAGES_PER_KP) {
      const index = order[cursor % order.length]
      if (counts[index] < MAX_PAGES_PER_KP) {
        counts[index] += 1
        remaining -= 1
      }
      cursor += 1
    }
    target = counts.reduce((sum, value) => sum + value, 0)
  }

  const plans: PagePlan[] = []
  let ordinal = 0
  for (let kpIndex = 0; kpIndex < Math.min(target, totalKp); kpIndex += 1) {
    const kp = flat[kpIndex].kp
    const title = String(kp.title ?? '').trim() || `知识点 ${kpIndex + 1}`
    const role = baseRole(kp)
    const sequence = ROLE_SEQUENCES[role]
    for (let extra = 0; extra < counts[kpIndex]; extra += 1) {
      const pageRole = sequence[Math.min(extra, sequence.length - 1)]
      plans.push({
        primary_kp_index: kpIndex,
        kp_indices: [kpIndex],
        title: extra === 0 ? title : `${title}${ROLE_TITLE_SUFFIX[pageRole]}`,
        kind: ROLE_TO_KIND[pageRole],
        role: pageRole,
        ordinal,
      })
      ordinal += 1
    }
  }

  if (totalKp > plans.length) {
    for (let offset = 0; offset < totalKp - plans.length; offset += 1) {
      plans[offset % plans.length].kp_indices.push(plans.length + offset)
    }
  }

  const chapterPositions = new Map<number, number[]>()
  plans.forEach((plan, position) => {
    const key = flat[plan.primary_kp_index].chapterIndex
    const list = chapterPositions.get(key) ?? []
    list.push(position)
    chapterPositions.set(key, list)
  })
  for (const positions of chapterPositions.values()) {
    if (positions.length < 2) continue
    const last = plans[positions[positions.length - 1]]
    if (last.role !== 'worked_example' && last.role !== 'practice') {
      last.role = 'summary'
      last.kind = ROLE_TO_KIND.summary
      if (!last.title.endsWith(ROLE_TITLE_SUFFIX.summary)) {
        last.title = `${last.title.split('（')[0]}${ROLE_TITLE_SUFFIX.summary}`
      }
    }
  }

  if (plans.length > 0 && !plans.some((plan) => plan.role === 'summary')) {
    const last = plans[plans.length - 1]
    if (last.role !== 'worked_example' && last.role !== 'practice') {
      last.role = 'summary'
      last.kind = ROLE_TO_KIND.summary
      last.title = `${last.title.split('（')[0]}${ROLE_TITLE_SUFFIX.summary}`
    }
  }

  plans.forEach((plan, index) => {
    plan.ordinal = index
  })
  return plans
}
