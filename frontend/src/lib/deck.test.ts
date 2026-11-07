import { describe, expect, it } from 'vitest'
import type { Deck, DeckEvent, DeckPageSummary } from '@/types'
import {
  buildRoadmap,
  buildStageIndex,
  continuePageId,
  eventText,
  jobProgressText,
  mergeEvents,
  nextPageId,
  prevPageId,
  readablePages,
} from './deck'

function page(
  id: number,
  ordinal: number,
  status: DeckPageSummary['status'],
  primary: number,
): DeckPageSummary {
  return {
    id,
    ordinal,
    title: `页面 ${ordinal + 1}`,
    kind: 'concept',
    status,
    current_version: 1,
    primary_knowledge_point_id: primary,
    knowledge_point_ids: [primary],
    has_bundle: status === 'ready',
    manifest_title: null,
    validation_status: null,
    validation_issue_count: 0,
  }
}

function deck(partial: Partial<Deck> = {}): Deck {
  return {
    id: 1,
    workspace_id: 1,
    title: '测试复习页',
    status: 'partial',
    style: {},
    outline: {
      chapters: [
        {
          title: '第一章',
          knowledge_points: [
            { title: '知识点 A', importance: 'core' },
            { title: '知识点 B' },
          ],
        },
        {
          title: '第二章',
          knowledge_points: [{ title: '知识点 C', importance: 'minor' }],
        },
      ],
      page_plan: [
        { ordinal: 0, title: 'A', kind: 'concept', kp_indices: [0], primary_kp_index: 0 },
        { ordinal: 1, title: 'B', kind: 'concept', kp_indices: [1], primary_kp_index: 1 },
        { ordinal: 2, title: 'C', kind: 'concept', kp_indices: [2], primary_kp_index: 2 },
      ],
    },
    source_signature: null,
    last_page_id: null,
    completed_page_ids: [],
    created_at: '2026-11-07T00:00:00Z',
    updated_at: '2026-11-07T00:00:00Z',
    pages: [page(11, 0, 'ready', 101), page(12, 1, 'failed', 102), page(13, 2, 'ready', 103)],
    total_pages: 3,
    ready_pages: 2,
    failed_pages: 1,
    planned_pages: 0,
    continue_page_id: 13,
    active_job_id: null,
    last_job_id: null,
    source_changed: false,
    ...partial,
  }
}

describe('buildRoadmap', () => {
  it('按章节与页面计划对齐状态', () => {
    const chapters = buildRoadmap(deck())
    expect(chapters).toHaveLength(2)
    expect(chapters[0].nodes.map((node) => node.status)).toEqual(['ready', 'failed'])
    expect(chapters[1].nodes[0].status).toBe('ready')
    expect(chapters[0].nodes[0].page?.id).toBe(11)
    expect(chapters[0].nodes[0].importance).toBe('core')
  })

  it('没有页面计划时按顺序对齐页面', () => {
    const value = deck({ outline: { chapters: [{ title: '章', knowledge_points: [{ title: 'A' }, { title: 'B' }] }] } })
    const chapters = buildRoadmap(value)
    expect(chapters[0].nodes.map((node) => node.page?.id)).toEqual([11, 12])
  })

  it('没有大纲时返回空路线图', () => {
    expect(buildRoadmap(deck({ outline: {} }))).toEqual([])
  })
})

describe('页面导航', () => {
  it('跳过取消页面之外保持顺序', () => {
    const value = deck()
    expect(nextPageId(value, 11)).toBe(12)
    expect(nextPageId(value, 13)).toBeNull()
    expect(prevPageId(value, 13)).toBe(12)
    expect(prevPageId(value, 11)).toBeNull()
  })

  it('可读页面只包含 ready 且有 bundle 的页面', () => {
    expect(readablePages(deck()).map((item) => item.id)).toEqual([11, 13])
  })

  it('继续阅读优先使用后端 continue_page_id', () => {
    expect(continuePageId(deck())).toBe(13)
    expect(continuePageId(deck({ continue_page_id: null }))).toBe(11)
  })
})

describe('构建状态', () => {
  it('映射六阶段时间线', () => {
    expect(buildStageIndex(null)).toBe(0)
    expect(
      buildStageIndex({
        id: 1,
        deck_id: 1,
        workspace_id: 1,
        status: 'planning',
        stage: null,
        progress: 5,
        total_pages: 0,
        ready_pages: 0,
        failed_pages: 0,
        error: null,
        cancel_requested: false,
        target_page_id: null,
        created_at: '',
        started_at: null,
        finished_at: null,
      }),
    ).toBe(1)
  })

  it('进度文案显示真实页数', () => {
    const job = {
      id: 1,
      deck_id: 1,
      workspace_id: 1,
      status: 'building' as const,
      stage: '构建中',
      progress: 50,
      total_pages: 4,
      ready_pages: 2,
      failed_pages: 1,
      error: null,
      cancel_requested: false,
      target_page_id: null,
      created_at: '',
      started_at: null,
      finished_at: null,
    }
    expect(jobProgressText(job)).toBe('2 / 4 页就绪 · 1 页失败')
  })
})

describe('事件', () => {
  const event = (id: number, payload: Record<string, unknown> = {}): DeckEvent => ({
    id,
    job_id: 1,
    page_id: null,
    type: 'text',
    payload,
    created_at: '2026-11-07T00:00:00Z',
  })

  it('只读取白名单文本字段', () => {
    expect(eventText(event(1, { text: '正在构建', prompt: 'secret' }))).toBe('正在构建')
    expect(eventText(event(2, { message: '失败原因' }))).toBe('失败原因')
    expect(eventText(event(3, { prompt: 'secret' }))).toBe('')
  })

  it('合并事件按 id 去重且保持顺序', () => {
    const merged = mergeEvents([event(1), event(2)], [event(2), event(3)])
    expect(merged.map((item) => item.id)).toEqual([1, 2, 3])
  })
})