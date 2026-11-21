import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseJsonArray, parseJsonObject } from '../lib/json.ts'

test('直接解析对象', () => {
  const result = parseJsonObject('{"chapters":[{"title":"极限"}]}')
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.value, { chapters: [{ title: '极限' }] })
})

test('剥离 markdown 围栏与前后解释', () => {
  const text = '好的，结果如下：\n```json\n{"ok": true, "n": 2}\n```\n希望有帮助。'
  const result = parseJsonObject(text)
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.value, { ok: true, n: 2 })
})

test('顶层必须是对象', () => {
  const result = parseJsonObject('[1,2,3]')
  assert.equal(result.ok, false)
})

test('空输入与非法 JSON 返回原因', () => {
  const empty = parseJsonObject('   ')
  assert.equal(empty.ok, false)
  if (!empty.ok) assert.match(empty.reason, /为空/)

  const broken = parseJsonObject('{"a": }')
  assert.equal(broken.ok, false)
  if (!broken.ok) assert.ok(broken.reason.length > 0)
})

test('数组解析支持围栏', () => {
  const result = parseJsonArray('```json\n[{"id":1},{"id":2}]\n```')
  assert.equal(result.ok, true)
  if (result.ok) assert.equal((result.value as unknown[]).length, 2)
})

test('只取第一个完整对象，忽略尾部说明', () => {
  const result = parseJsonObject('{"ok":true} 补充说明里还有 { 和 }')
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.value, { ok: true })
})

test('字符串内的花括号不会干扰闭合判断', () => {
  const result = parseJsonObject('{"tex":"\\\\frac{1}{2}","n":2}')
  assert.equal(result.ok, true)
  if (result.ok) assert.equal((result.value as { n: number }).n, 2)
})

test('截断的 JSON 会被补全救援', () => {
  const truncated = '{"title":"极限","blocks":[{"type":"prose","text":"第一段"},{"type":"prose","text":"被截断'
  const result = parseJsonObject(truncated)
  assert.equal(result.ok, true)
  if (result.ok) {
    const blocks = (result.value as { blocks: unknown[] }).blocks
    assert.equal(blocks.length, 2)
  }
})

test('截断在键值之间时回退到上一个完整条目', () => {
  const truncated = '{"title":"极限","blocks":[{"type":"prose","text":"第一段"},{"type":'
  const result = parseJsonObject(truncated)
  assert.equal(result.ok, true)
  if (result.ok) {
    const blocks = (result.value as { blocks: unknown[] }).blocks
    assert.equal(blocks.length, 1)
  }
})
