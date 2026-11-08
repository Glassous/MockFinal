import assert from 'node:assert/strict'
import { test } from 'node:test'

import { HttpError, validationError } from '../lib/errors.ts'
import { errorToResponse, json, noContent, readJson } from '../lib/http.ts'

test('json 与 noContent 的基础响应', async () => {
  const response = json({ ok: true }, 201)
  assert.equal(response.status, 201)
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.deepEqual(await response.json(), { ok: true })

  const empty = noContent()
  assert.equal(empty.status, 204)
  assert.equal(await empty.text(), '')
})

test('HttpError 统一为 { detail: string }', async () => {
  const response = errorToResponse(new HttpError(404, '工作区不存在'), 'req-1')
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { detail: '工作区不存在' })
})

test('422 保持 FastAPI 数组形状', async () => {
  const response = errorToResponse(validationError({ username: 'Field required' }), 'req-2')
  assert.equal(response.status, 422)
  const body = (await response.json()) as { detail: Array<{ loc: string[]; msg: string }> }
  assert.equal(body.detail[0].msg, 'Field required')
  assert.deepEqual(body.detail[0].loc, ['body', 'username'])
})

test('未知异常返回 500 通用文案', async () => {
  const response = errorToResponse(new Error('boom'), 'req-3')
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { detail: '服务器内部错误，请稍后重试' })
  assert.equal(response.headers.get('x-request-id'), 'req-3')
})

test('readJson 拒绝非对象与非法 JSON', async () => {
  const make = (body: string) =>
    new Request('http://localhost/api', { method: 'POST', body, headers: { 'content-type': 'application/json' } })
  await assert.rejects(() => readJson(make('[1,2]')), /请求体必须是合法 JSON/)
  await assert.rejects(() => readJson(make('not json')), /请求体必须是合法 JSON/)
  assert.deepEqual(await readJson(make('{"a":1}')), { a: 1 })
})
