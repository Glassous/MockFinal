import { config } from './config.ts'
import { HttpError } from './errors.ts'
import { findRow, insertRow, updateWhere } from './db.ts'

interface LimiterRow {
  key: string
  failures: number | string | null
  window_start: string | null
}

function limiterKey(username: string, ip: string): string {
  return `${username}@${ip}`
}

function windowExpired(row: LimiterRow, now: number): boolean {
  const started = row.window_start ? Date.parse(row.window_start) : Number.NaN
  return !Number.isFinite(started) || now - started >= config.verifyWindowSeconds * 1000
}

async function currentFailures(key: string): Promise<LimiterRow | null> {
  return findRow<LimiterRow>('auth_limiter', [['key', key]], 'key,failures,window_start')
}

export async function assertVerifyAllowed(username: string, ip: string): Promise<void> {
  const key = limiterKey(username, ip)
  const row = await currentFailures(key)
  if (!row) return
  const failures = Number(row.failures ?? 0)
  if (windowExpired(row, Date.now())) return
  if (failures >= config.verifyMaxFailures) {
    throw new HttpError(429, '验证失败次数过多，请 15 分钟后再试')
  }
}

export async function recordVerifyFailure(username: string, ip: string): Promise<void> {
  const key = limiterKey(username, ip)
  const now = Date.now()
  const row = await currentFailures(key)
  if (!row) {
    await insertRow('auth_limiter', {
      key,
      failures: 1,
      window_start: new Date(now).toISOString(),
    })
    return
  }
  const failures = windowExpired(row, now) ? 1 : Number(row.failures ?? 0) + 1
  await updateWhere('auth_limiter', {
    failures,
    window_start: windowExpired(row, now) ? new Date(now).toISOString() : row.window_start,
  }, [['key', key]])
}

export async function clearVerifyFailures(username: string, ip: string): Promise<void> {
  const key = limiterKey(username, ip)
  const row = await currentFailures(key)
  if (!row) return
  await updateWhere('auth_limiter', { failures: 0 }, [['key', key]])
}
