import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hashAnswer, hashSecret, normalizeAnswer, verifyAnswer, verifySecret } from '../lib/auth.ts'

test('密码哈希可验证且不包含明文', async () => {
  const stored = await hashSecret('secret-password')
  assert.match(stored, /^pbkdf2\$600000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
  assert.ok(!stored.includes('secret-password'))
  assert.equal(await verifySecret('secret-password', stored), true)
  assert.equal(await verifySecret('wrong-password', stored), false)
})

test('相同密码每次盐不同', async () => {
  const first = await hashSecret('same-password')
  const second = await hashSecret('same-password')
  assert.notEqual(first, second)
})

test('安全问题答案忽略大小写与首尾空格', async () => {
  assert.equal(normalizeAnswer('  Blue Whale '), 'blue whale')
  const stored = await hashAnswer('  Blue Whale ')
  assert.equal(await verifyAnswer('blue whale', stored), true)
  assert.equal(await verifyAnswer('BLUE WHALE', stored), true)
  assert.equal(await verifyAnswer('red whale', stored), false)
})

test('损坏的哈希格式返回 false', async () => {
  assert.equal(await verifySecret('x', 'bcrypt$whatever'), false)
  assert.equal(await verifySecret('x', 'pbkdf2$notanumber$abc$def'), false)
})
