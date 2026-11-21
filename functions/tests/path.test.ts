import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizePath } from '../lib/path.ts'

test('识别逻辑函数前缀', () => {
  assert.equal(normalizePath('/functions/v1/app/api/health'), '/health')
  assert.equal(normalizePath('/functions/v1/app/health'), '/health')
  assert.equal(normalizePath('/app/api/health'), '/health')
})

test('识别平台物理函数名前缀', () => {
  const physical = `/functions/v1/app-d${'a'.repeat(32)}/api/workspaces/1`
  assert.equal(normalizePath(physical), '/workspaces/1')
})

test('平台剥离 /functions/v1 后仍可识别', () => {
  assert.equal(normalizePath('/app/api/auth/me'), '/auth/me')
})

test('兼容未被剥离的 /api 前缀', () => {
  assert.equal(normalizePath('/api/health'), '/health')
  assert.equal(normalizePath('/api'), '/')
})

test('无关路径返回 null', () => {
  assert.equal(normalizePath('/'), null)
  assert.equal(normalizePath('/storage/v1/object'), null)
  assert.equal(normalizePath('/internal/metrics'), null)
})

test('末尾斜杠被归一化', () => {
  assert.equal(normalizePath('/functions/v1/app/api/health/'), '/health')
})
