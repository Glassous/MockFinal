import type {
  Deck,
  DeckDensity,
  DeckEvent,
  DeckJob,
  DeckJobStatus,
  DeckPageStatus,
  DeckPageSummary,
  DeckPreset,
  DeckStatus,
  DeckStyle,
  OutlineChapter,
  OutlineKnowledgePoint,
  PagePlanEntry,
} from '@/types'

export const DECK_PRESETS: { value: DeckPreset; label: string; hint: string }[] = [
  { value: 'editorial', label: '讲义', hint: '安静、纸感、适合长读' },
  { value: 'blueprint', label: '图解', hint: '网格、坐标、分步推演' },
  { value: 'drill', label: '冲刺', hint: '高密度考点与速查' },
  { value: 'story', label: '叙事', hint: '场景、类比、时间线' },
]

export const DECK_DENSITIES: { value: DeckDensity; label: string; range: string }[] = [
  { value: 'concise', label: '精简', range: '6–9 页' },
  { value: 'standard', label: '标准', range: '10–14 页' },
  { value: 'deep', label: '深入', range: '14–16 页' },
]

export const DECK_CONTENT_OPTIONS = [
  '概念定义',
  '公式推导',
  '例题',
  '易错点',
  '记忆口诀',
  '对比表',
  '练习',
]

export const DECK_STATUS_LABELS: Record<DeckStatus, string> = {
  draft: '未构建',
  planning: '规划中',
  building: '构建中',
  ready: '已就绪',
  partial: '部分就绪',
  failed: '构建失败',
  canceled: '已取消',
}

export const PAGE_STATUS_LABELS: Record<DeckPageStatus, string> = {
  planned: '待构建',
  building: '构建中',
  validating: '校验中',
  ready: '已就绪',
  failed: '失败',
  canceled: '已取消',
}

export const JOB_STATUS_LABELS: Record<DeckJobStatus, string> = {
  pending: '排队中',
  planning: '规划中',
  building: '构建中',
  validating: '校验中',
  done: '已完成',
  partial: '部分完成',
  failed: '失败',
  canceled: '已取消',
}

const ACTIVE_JOB_STATUSES: DeckJobStatus[] = [
  'pending',
  'planning',
  'building',
  'validating',
]

export function isActiveJobStatus(status: string | null | undefined): boolean {
  return !!status && (ACTIVE_JOB_STATUSES as string[]).includes(status)
}

export function isActiveJob(job: DeckJob | null | undefined): boolean {
  return !!job && isActiveJobStatus(job.status)
}

export function defaultDeckStyle(): DeckStyle {
  return { preset: 'editorial', content: [], density: 'standard', custom_prompt: '' }
}

export function normalizeDeckStyle(style: Partial<DeckStyle> | null | undefined): DeckStyle {
  const base = defaultDeckStyle()
  if (!style) return base
  return {
    preset: style.preset ?? base.preset,
    content: Array.isArray(style.content) ? style.content : base.content,
    density: style.density ?? base.density,
    custom_prompt: style.custom_prompt ?? base.custom_prompt,
  }
}

export function presetLabel(preset: DeckPreset): string {
  return DECK_PRESETS.find((item) => item.value === preset)?.label ?? preset
}

export function densityLabel(density: DeckDensity): string {
  return DECK_DENSITIES.find((item) => item.value === density)?.label ?? density
}

export function estimatePageRange(density: DeckDensity): string {
  return DECK_DENSITIES.find((item) => item.value === density)?.range ?? '10–14 页'
}

export function deckUpdatedSummary(deck: Deck): string {
  const total = deck.total_pages
  if (!total) return '尚未生成页面'
  return `${deck.ready_pages} / ${total} 页就绪`
}

export function deckProgressPercent(deck: Deck): number {
  if (!deck.total_pages) return 0
  return Math.round((deck.ready_pages / deck.total_pages) * 100)
}

export function pageDisplayTitle(page: DeckPageSummary): string {
  return page.manifest_title?.trim() || page.title
}

export function sortedPages(deck: Deck): DeckPageSummary[] {
  return [...deck.pages].sort((a, b) => a.ordinal - b.ordinal || a.id - b.id)
}

export function nextPageId(deck: Deck, currentId: number): number | null {
  const pages = sortedPages(deck)
  const index = pages.findIndex((page) => page.id === currentId)
  if (index < 0) return null
  return pages[index + 1]?.id ?? null
}

export function prevPageId(deck: Deck, currentId: number): number | null {
  const pages = sortedPages(deck)
  const index = pages.findIndex((page) => page.id === currentId)
  if (index <= 0) return null
  return pages[index - 1]?.id ?? null
}

export function readablePages(deck: Deck): DeckPageSummary[] {
  return sortedPages(deck).filter((page) => page.status === 'ready' && page.has_bundle)
}

export function continuePageId(deck: Deck): number | null {
  if (deck.continue_page_id) return deck.continue_page_id
  return readablePages(deck)[0]?.id ?? sortedPages(deck)[0]?.id ?? null
}

export type RoadmapNodeStatus = DeckPageStatus | 'unstarted'

export interface RoadmapNode {
  index: number
  title: string
  summary: string
  importance: 'core' | 'normal' | 'minor'
  difficulty: string
  status: RoadmapNodeStatus
  page: DeckPageSummary | null
  pageCount: number
}

export interface RoadmapChapter {
  title: string
  nodes: RoadmapNode[]
}

function flattenChapters(chapters: OutlineChapter[]): OutlineKnowledgePoint[] {
  return chapters.flatMap((chapter) => chapter.knowledge_points ?? [])
}

/**
 * 把大纲章节与页面计划对齐成路线图。
 * 页面计划里的 kp_indices / primary_kp_index 是展平后的知识点下标；
 * 页面通过 ordinal 与计划对应（后端建页顺序与计划一致）。
 */
export function buildRoadmap(deck: Deck): RoadmapChapter[] {
  const chapters = deck.outline?.chapters ?? []
  if (!chapters.length) return []
  const flat = flattenChapters(chapters)
  const plans = deck.outline?.page_plan ?? []
  const pagesByOrdinal = new Map<number, DeckPageSummary>()
  for (const page of deck.pages) pagesByOrdinal.set(page.ordinal, page)

  const pageByKp = new Map<number, DeckPageSummary>()
  for (const plan of plans) {
    const page = pagesByOrdinal.get(plan.ordinal)
    if (!page) continue
    const indices = plan.kp_indices?.length ? plan.kp_indices : [plan.primary_kp_index]
    for (const index of indices) {
      const existing = pageByKp.get(index)
      if (!existing || plan.primary_kp_index === index) pageByKp.set(index, page)
    }
  }
  // 没有页面计划（例如手工数据）时按顺序把页面与知识点一一对齐
  if (!plans.length) {
    sortedPages(deck).forEach((page, index) => {
      if (flat[index]) pageByKp.set(index, page)
    })
  }

  let cursor = 0
  return chapters.map((chapter) => {
    const nodes: RoadmapNode[] = (chapter.knowledge_points ?? []).map((kp) => {
      const index = cursor
      cursor += 1
      const page = pageByKp.get(index) ?? null
      return {
        index,
        title: kp.title,
        summary: kp.summary ?? '',
        importance: kp.importance ?? 'normal',
        difficulty: kp.difficulty ?? 'medium',
        status: page?.status ?? 'unstarted',
        page,
        pageCount: plans.filter((plan) => plan.primary_kp_index === index).length || 1,
      }
    })
    return { title: chapter.title, nodes }
  })
}

export function pagePlanForKp(
  deck: Deck,
  kpIndex: number,
): PagePlanEntry | undefined {
  return (deck.outline?.page_plan ?? []).find((plan) => plan.primary_kp_index === kpIndex)
}

export const BUILD_STAGES = [
  '整理资料',
  '规划知识点',
  '生成页面 brief',
  '构建页面',
  '校验',
  '完成',
] as const

export function buildStageIndex(job: DeckJob | null | undefined): number {
  if (!job) return 0
  if (job.status === 'done' || job.status === 'partial' || job.status === 'failed' || job.status === 'canceled') {
    return job.status === 'done' ? BUILD_STAGES.length - 1 : 4
  }
  if (job.status === 'pending') return 0
  if (job.status === 'planning') return 1
  if (job.status === 'building') {
    return job.total_pages > 0 ? 3 : 2
  }
  if (job.status === 'validating') return 4
  return 0
}

export function jobProgressText(job: DeckJob): string {
  if (!job.total_pages) {
    return job.stage || JOB_STATUS_LABELS[job.status]
  }
  const base = `${job.ready_pages} / ${job.total_pages} 页就绪`
  if (job.failed_pages > 0) return `${base} · ${job.failed_pages} 页失败`
  return base
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  stage: '阶段',
  text: '说明',
  tool: '动作',
  validation: '校验',
  page_ready: '页面就绪',
  retry: '重试',
  error: '错误',
}

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type
}

/** 从事件 payload 中提取可展示文本；只读取已知白名单字段。 */
export function eventText(event: DeckEvent): string {
  const payload = event.payload ?? {}
  for (const key of ['text', 'message', 'summary', 'title', 'label']) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  if (event.type === 'page_ready') return '页面构建并校验完成'
  if (event.type === 'validation') {
    const status = payload.status
    return status === 'passed' ? '最终校验通过' : '最终校验未通过'
  }
  return ''
}

export function eventPageLabel(event: DeckEvent, deck: Deck): string {
  if (!event.page_id) return ''
  const page = deck.pages.find((item) => item.id === event.page_id)
  return page ? `第 ${page.ordinal + 1} 页` : '页面'
}

/** 合并增量事件并按 id 去重（网络重试可能返回重复区间）。 */
export function mergeEvents(existing: DeckEvent[], incoming: DeckEvent[]): DeckEvent[] {
  if (!incoming.length) return existing
  const seen = new Set(existing.map((event) => event.id))
  const merged = existing.slice()
  for (const event of incoming) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    merged.push(event)
  }
  return merged
}

export function isTerminalDeck(deck: Deck | null | undefined): boolean {
  return !!deck && ['ready', 'partial', 'failed', 'canceled'].includes(deck.status)
}