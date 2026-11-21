import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DENSITY_PAGE_RANGES, PlannerError, planPages, type PlannerChapter } from '../lib/planner.ts'

function chapters(count: number): PlannerChapter[] {
  const result: PlannerChapter[] = []
  const perChapter = Math.ceil(count / 3)
  let created = 0
  for (let chapterIndex = 0; chapterIndex < 3; chapterIndex += 1) {
    const points = []
    for (let index = 0; index < perChapter && created < count; index += 1) {
      points.push({
        title: `知识点 ${created + 1}`,
        importance: created % 3 === 0 ? 'core' : 'normal',
        interaction_idea: created % 4 === 0 ? '区间收缩动画' : '',
        misconceptions: created % 5 === 0 ? ['易错 A', '易错 B'] : [],
      })
      created += 1
    }
    result.push({ title: `第 ${chapterIndex + 1} 章`, knowledge_points: points })
  }
  return result
}

test('标准密度按知识点数扩展并落在 10–14 页', () => {
  const plans = planPages(chapters(10), 'standard')
  assert.ok(plans.length >= DENSITY_PAGE_RANGES.standard[0])
  assert.ok(plans.length <= DENSITY_PAGE_RANGES.standard[1])
  assert.deepEqual(plans.map((plan) => plan.ordinal), plans.map((_, index) => index))
  assert.ok(plans.some((plan) => plan.role === 'summary'))
})

test('每个知识点至少出现在一页中', () => {
  const plans = planPages(chapters(8), 'concise')
  const covered = new Set(plans.flatMap((plan) => plan.kp_indices))
  for (let index = 0; index < 8; index += 1) assert.ok(covered.has(index))
})

test('深度密度页数更多且不超过 16', () => {
  const concise = planPages(chapters(9), 'concise').length
  const deep = planPages(chapters(9), 'deep').length
  assert.ok(deep > concise)
  assert.ok(deep <= 16)
})

test('未知密度抛中文错误', () => {
  assert.throws(() => planPages(chapters(6), 'huge'), (error) => {
    assert.ok(error instanceof PlannerError)
    assert.match(error.message, /不支持的密度/)
    return true
  })
})

test('没有知识点时拒绝规划', () => {
  assert.throws(() => planPages([{ title: '空章', knowledge_points: [] }], 'standard'), PlannerError)
})
