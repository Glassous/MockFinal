import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { mathTexError, renderMath } from '../lib/page-kit/math.ts'
import { hasErrors, validateContent } from '../lib/page-kit/validate.ts'
import { renderPage } from '../lib/page-kit/render.ts'

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/page-content.json', import.meta.url), 'utf-8'),
) as Record<string, unknown>

test('示例内容通过 2.0 校验', () => {
  const issues = validateContent(fixture)
  assert.equal(hasErrors(issues), false, JSON.stringify(issues))
})

test('renderPage 输出 1.1 bundle 且不含可执行标签', () => {
  const result = renderPage(fixture, {
    pageId: 'page_1',
    theme: 'workbench',
    knowledgePointIds: ['kp_1'],
    estimatedMinutes: 10,
  })
  assert.equal(result.css, '')
  assert.equal(result.js, '')
  assert.ok(result.html.includes('mf-tex'))
  assert.ok(!/<script|<iframe|<object|<embed/i.test(result.html))
  const manifest = result.manifest as Record<string, unknown>
  assert.equal(manifest.schema_version, '1.1')
  assert.equal(manifest.design_system, '2.0')
  assert.equal(manifest.page_id, 'page_1')
  assert.ok((manifest.teaching as Record<string, unknown>).role)
})

test('公式占位保留源码并做 HTML 转义', () => {
  const html = renderMath('a<b & c', false)
  assert.ok(html.includes('data-tex="a&lt;b &amp; c"'))
  assert.ok(html.includes('data-display="0"'))
})

test('公式结构校验拒绝不平衡输入', () => {
  assert.equal(mathTexError('\\frac{1}{2}'), null)
  assert.ok(mathTexError('\\frac{1}{2')?.includes('花括号'))
  assert.ok(mathTexError('\\left( x')?.includes('left'))
  assert.ok(mathTexError('')?.includes('公式为空'))
})
