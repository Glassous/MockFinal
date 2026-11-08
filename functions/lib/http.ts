import { HttpError, validationError } from './errors.ts'
import { config } from './config.ts'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } })
}

export function noContent(headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 204, headers })
}

export function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } })
}

export function errorToResponse(error: unknown, requestId: string): Response {
  if (error instanceof HttpError) {
    return json({ detail: error.detail }, error.status, {
      'cache-control': 'no-store',
      ...error.headers,
    })
  }
  console.error('unhandled_error', { requestId, error: error instanceof Error ? error.message : String(error) })
  return json({ detail: '服务器内部错误，请稍后重试' }, 500, {
    'cache-control': 'no-store',
    'x-request-id': requestId,
  })
}

export function requestId(request: Request): string {
  return request.headers.get('x-request-id') ?? crypto.randomUUID()
}

export async function readJson(
  request: Request,
  maxBytes = config.requestJsonLimit,
): Promise<Record<string, unknown>> {
  const declared = Number.parseInt(request.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, '请求体过大')
  }
  const raw = await request.text()
  if (raw.length > maxBytes) throw new HttpError(413, '请求体过大')
  if (!raw.trim()) throw new HttpError(400, '请求体必须是合法 JSON')
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new HttpError(400, '请求体必须是合法 JSON')
  }
}

export async function readJsonArray(
  request: Request,
  maxBytes = config.requestJsonLimit,
): Promise<unknown[]> {
  const raw = await request.text()
  if (raw.length > maxBytes) throw new HttpError(413, '请求体过大')
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) throw new Error('not an array')
    return parsed
  } catch {
    throw new HttpError(400, '请求体必须是合法 JSON 数组')
  }
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}

export function pathId(value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new HttpError(404, '资源不存在')
  return parsed
}

export function queryInt(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(name)
  if (raw === null || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(422, [
      { loc: ['query', name], msg: `Input should be between ${min} and ${max}`, type: 'value_error' },
    ])
  }
  return parsed
}

// ===== 字段校验（对齐 Pydantic 的常用约束与中文文案）=====

export function asObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(422, '请求体格式错误')
  }
  return value as Record<string, unknown>
}

export function field(
  body: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number; trim?: boolean; optional?: boolean; fallback?: string } = {},
): string {
  const raw = body[key]
  if (raw === undefined || raw === null) {
    if (options.optional) return options.fallback ?? ''
    throw validationError({ [key]: 'Field required' })
  }
  if (typeof raw !== 'string') throw validationError({ [key]: 'Input should be a valid string' })
  const value = options.trim === false ? raw : raw.trim()
  if (options.min !== undefined && value.length < options.min) {
    throw validationError({ [key]: `String should have at least ${options.min} characters` })
  }
  const max = options.max
  if (max !== undefined && value.length > max) {
    throw validationError({ [key]: `String should have at most ${max} characters` })
  }
  return value
}

export function optionalField(
  body: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number; trim?: boolean } = {},
): string | null {
  if (body[key] === undefined || body[key] === null) return null
  return field(body, key, options)
}

export function intField(
  body: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number; optional?: boolean } = {},
): number {
  const raw = body[key]
  if (raw === undefined || raw === null) {
    if (options.optional) return 0
    throw validationError({ [key]: 'Field required' })
  }
  const value = typeof raw === 'number' ? raw : Number.NaN
  if (!Number.isInteger(value)) throw validationError({ [key]: 'Input should be a valid integer' })
  if (options.min !== undefined && value < options.min) {
    throw validationError({ [key]: `Input should be greater than or equal to ${options.min}` })
  }
  if (options.max !== undefined && value > options.max) {
    throw validationError({ [key]: `Input should be less than or equal to ${options.max}` })
  }
  return value
}

export function idArrayField(
  body: Record<string, unknown>,
  key: string,
  options: { maxItems?: number; optional?: boolean } = {},
): number[] | null {
  const raw = body[key]
  if (raw === undefined || raw === null) {
    if (options.optional) return null
    throw validationError({ [key]: 'Field required' })
  }
  if (!Array.isArray(raw)) throw validationError({ [key]: 'Input should be a valid list' })
  if (options.maxItems !== undefined && raw.length > options.maxItems) {
    throw validationError({ [key]: `List should have at most ${options.maxItems} items` })
  }
  return raw.map((item) => {
    if (!Number.isSafeInteger(item)) {
      throw validationError({ [key]: 'Input should be a list of integers' })
    }
    return item as number
  })
}
