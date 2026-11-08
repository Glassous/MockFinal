import { config } from './config.ts'
import { findRow, num, str, type Row } from './db.ts'
import { HttpError } from './errors.ts'
import { bearerToken } from './http.ts'
import { verifyToken } from './jwt.ts'

export interface CurrentUser extends Row {
  id: number
  username: string
  token_version: number
}

const USER_COLUMNS = 'id,username,password_hash,security_question,security_answer_hash,token_version,created_at'

export async function requireUser(request: Request): Promise<CurrentUser> {
  const token = bearerToken(request)
  if (!token) throw new HttpError(401, '未提供认证凭证')
  const claims = await verifyToken(token, 'access', config.jwtSecret)
  if (!claims) throw new HttpError(401, '登录状态无效或已过期，请重新登录')
  const row = await findRow('users', [['id', claims.userId]], USER_COLUMNS)
  if (!row) throw new HttpError(401, '用户不存在')
  if (num(row.token_version) !== claims.tokenVersion) {
    throw new HttpError(401, '登录状态已失效，请重新登录')
  }
  return row as CurrentUser
}

export function publicUser(row: Row): { id: number; username: string } {
  return { id: num(row.id), username: str(row.username) }
}
