import { hashAnswer, hashSecret, verifyAnswer, verifySecret } from '../lib/auth.ts'
import { config } from '../lib/config.ts'
import { publicUser, requireUser } from '../lib/current-user.ts'
import { findRow, insertRow, isUniqueViolation, num, str, updateWhere } from '../lib/db.ts'
import { HttpError } from '../lib/errors.ts'
import { clientIp, field, json, noContent, readJson } from '../lib/http.ts'
import { newId } from '../lib/ids.ts'
import { signToken, verifyToken } from '../lib/jwt.ts'
import {
  assertVerifyAllowed,
  clearVerifyFailures,
  recordVerifyFailure,
} from '../lib/ratelimit.ts'
import { userOut } from '../lib/serializers.ts'
import type { Route } from '../router.ts'

async function register(request: Request): Promise<Response> {
  const body = await readJson(request)
  const rawUsername = field(body, 'username', { trim: false, min: 3, max: 32 })
  const username = rawUsername.trim()
  if (!username) throw new HttpError(400, '用户名不能为空')
  const password = field(body, 'password', { trim: false, min: 6, max: 72 })
  const securityQuestion = field(body, 'security_question', { min: 1, max: 255 })
  const securityAnswer = field(body, 'security_answer', { min: 1, max: 128 })

  const existing = await findRow('users', [['username', username]], 'id')
  if (existing) throw new HttpError(409, '用户名已被注册')

  const [passwordHash, answerHash] = await Promise.all([hashSecret(password), hashAnswer(securityAnswer)])
  const id = newId()
  try {
    await insertRow('users', {
      id,
      username,
      password_hash: passwordHash,
      security_question: securityQuestion,
      security_answer_hash: answerHash,
      token_version: 0,
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, '用户名已被注册')
    throw error
  }
  const token = await signToken(id, 0, 'access', config.accessTokenMinutes, config.jwtSecret)
  return json({ token, user: { id, username } })
}

async function login(request: Request): Promise<Response> {
  const body = await readJson(request)
  const username = field(body, 'username', { trim: false }).trim()
  const password = field(body, 'password', { trim: false })
  const user = await findRow('users', [['username', username]], 'id,username,password_hash,token_version')
  const passwordOk = user ? await verifySecret(password, str(user.password_hash)) : false
  if (!user || !passwordOk) throw new HttpError(401, '用户名或密码错误')
  const token = await signToken(num(user.id), num(user.token_version), 'access', config.accessTokenMinutes, config.jwtSecret)
  return json({ token, user: publicUser(user) })
}

async function securityQuestion(request: Request, url: URL): Promise<Response> {
  const username = (url.searchParams.get('username') ?? '').trim()
  const user = await findRow('users', [['username', username]], 'security_question')
  if (!user) throw new HttpError(404, '用户不存在')
  return json({ question: str(user.security_question) })
}

async function verifyAnswerRoute(request: Request): Promise<Response> {
  const body = await readJson(request)
  const username = field(body, 'username', { trim: false }).trim()
  const answer = field(body, 'answer', { trim: false })
  const ip = clientIp(request)
  await assertVerifyAllowed(username, ip)

  const user = await findRow('users', [['username', username]], 'id,security_answer_hash,token_version')
  if (!user) {
    await recordVerifyFailure(username, ip)
    throw new HttpError(404, '用户不存在')
  }
  const ok = await verifyAnswer(answer, str(user.security_answer_hash))
  if (!ok) {
    await recordVerifyFailure(username, ip)
    throw new HttpError(400, '安全问题答案错误')
  }
  await clearVerifyFailures(username, ip)
  const resetToken = await signToken(
    num(user.id),
    num(user.token_version),
    'reset',
    config.resetTokenMinutes,
    config.jwtSecret,
  )
  return json({ reset_token: resetToken })
}

async function resetPassword(request: Request): Promise<Response> {
  const body = await readJson(request)
  const resetToken = field(body, 'reset_token', { trim: false })
  const newPassword = field(body, 'new_password', { trim: false, min: 6, max: 72 })
  const claims = await verifyToken(resetToken, 'reset', config.jwtSecret)
  if (!claims) throw new HttpError(400, '重置凭证无效或已过期，请重新验证安全问题')
  const user = await findRow('users', [['id', claims.userId]], 'id,token_version')
  if (!user) throw new HttpError(400, '用户不存在')
  const currentVersion = num(user.token_version)
  if (currentVersion !== claims.tokenVersion) {
    throw new HttpError(400, '重置凭证已失效，请重新验证安全问题')
  }
  const passwordHash = await hashSecret(newPassword)
  await updateWhere('users', { password_hash: passwordHash, token_version: currentVersion + 1 }, [
    ['id', claims.userId],
  ])
  return noContent()
}

async function me(request: Request): Promise<Response> {
  const user = await requireUser(request)
  return json(userOut(user))
}

export const authRoutes: Route[] = [
  { method: 'POST', path: '/auth/register', handler: ({ request }) => register(request) },
  { method: 'POST', path: '/auth/login', handler: ({ request }) => login(request) },
  {
    method: 'GET',
    path: '/auth/security-question',
    handler: ({ request, url }) => securityQuestion(request, url),
  },
  { method: 'POST', path: '/auth/verify-answer', handler: ({ request }) => verifyAnswerRoute(request) },
  { method: 'POST', path: '/auth/reset-password', handler: ({ request }) => resetPassword(request) },
  { method: 'GET', path: '/auth/me', handler: ({ request }) => me(request) },
]
