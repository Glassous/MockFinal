import assert from 'node:assert/strict'
import { test } from 'node:test'

import { newId, newIdBlock, newUuid } from '../lib/ids.ts'

test('newId 生成安全整数且单调递增', () => {
  const first = newId()
  const second = newId()
  assert.ok(Number.isSafeInteger(first))
  assert.ok(first > 0)
  assert.notEqual(first, second)
  assert.ok(second > first)
})

test('newIdBlock 返回连续且唯一的 ID', () => {
  const ids = newIdBlock(10)
  assert.equal(ids.length, 10)
  assert.equal(new Set(ids).size, 10)
  for (let index = 1; index < ids.length; index += 1) {
    assert.equal(ids[index], ids[index - 1] + 1)
  }
  assert.ok(ids.every((id) => Number.isSafeInteger(id)))
})

test('同一毫秒内批量与单条混合也不重复', () => {
  const block = newIdBlock(100)
  const singles = Array.from({ length: 100 }, () => newId())
  const all = new Set([...block, ...singles])
  assert.equal(all.size, 200)
})

test('newUuid 返回 UUID 文本', () => {
  assert.match(newUuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
})
