import assert from 'node:assert/strict'
import { test } from 'node:test'

import { signToken, verifyToken } from '../lib/jwt.ts'

const SECRET = 'test-secret-value'

test('access token 往返解析出用户与版本', async () => {
  const token = await signToken(42, 3, 'access', 5, SECRET)
  const claims = await verifyToken(token, 'access', SECRET)
  assert.deepEqual(claims, { userId: 42, tokenVersion: 3 })
})

test('purpose 不匹配时拒绝', async () => {
  const token = await signToken(42, 0, 'reset', 5, SECRET)
  assert.equal(await verifyToken(token, 'access', SECRET), null)
})

test('错误密钥或篡改载荷时拒绝', async () => {
  const token = await signToken(42, 0, 'access', 5, SECRET)
  assert.equal(await verifyToken(token, 'access', 'another-secret'), null)
  const [header, , signature] = token.split('.')
  const forgedPayload = Buffer.from(JSON.stringify({ sub: '99', tv: 0, purpose: 'access', exp: 9999999999 }))
    .toString('base64url')
  assert.equal(await verifyToken(`${header}.${forgedPayload}.${signature}`, 'access', SECRET), null)
})

test('过期 token 拒绝', async () => {
  const past = -1
  const token = await signToken(7, 0, 'access', past, SECRET)
  assert.equal(await verifyToken(token, 'access', SECRET), null)
})

test('格式非法的 token 拒绝', async () => {
  assert.equal(await verifyToken('not-a-token', 'access', SECRET), null)
  assert.equal(await verifyToken('a.b.c', 'access', SECRET), null)
})
