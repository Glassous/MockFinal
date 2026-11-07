// fetch 封装：统一鉴权、错误处理、401 跳转

const TOKEN_KEY = 'mockfinal_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/** 后端统一错误体 { detail: string } */
export class ApiError extends Error {
  status: number
  detail: string
  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

type UnauthorizedHandler = () => void
let unauthorizedHandler: UnauthorizedHandler | null = null

/** 由 auth store / router 注入，401 时清 token 并跳转登录 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  unauthorizedHandler = handler
}

/** 清 token 并触发全局未授权回调（跳转登录）；供 fetch 封装与 XHR 上传共用 */
export function handleUnauthorized(): void {
  clearToken()
  unauthorizedHandler?.()
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** 是否携带 Authorization 头，默认 true（auth/health 接口传 false） */
  auth?: boolean
  headers?: Record<string, string>
  signal?: AbortSignal
}

export async function parseErrorResponse(res: Response): Promise<ApiError> {
  let detail = `请求失败（HTTP ${res.status}）`
  try {
    const data = await res.json()
    if (typeof data?.detail === 'string') {
      detail = data.detail
    } else if (Array.isArray(data?.detail)) {
      // FastAPI 422：detail 为校验错误数组，提取首条 msg 作为可读提示
      const first = data.detail[0]
      detail =
        first && typeof first.msg === 'string' ? first.msg : '请求参数校验失败，请检查输入'
    } else if (typeof data === 'string') {
      detail = data
    }
  } catch {
    /* 响应体非 JSON，使用默认文案 */
  }
  return new ApiError(res.status, detail)
}

/** 通用 JSON 请求，返回解析后的数据；204 返回 undefined */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, headers = {}, signal } = options

  const finalHeaders: Record<string, string> = { ...headers }
  if (auth) {
    const token = getToken()
    if (token) finalHeaders['Authorization'] = `Bearer ${token}`
  }

  let payload: BodyInit | undefined
  if (body !== undefined) {
    if (body instanceof FormData) {
      payload = body // 浏览器自动设置 multipart 边界
    } else {
      finalHeaders['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
  }

  const res = await fetch(`/api${path}`, { method, headers: finalHeaders, body: payload, signal })

  if (res.status === 401) handleUnauthorized()
  if (!res.ok) throw await parseErrorResponse(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** 带鉴权地获取二进制（Blob），用于资料下载 */
export async function requestBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`/api${path}`, { headers, signal })
  if (res.status === 401) handleUnauthorized()
  if (!res.ok) throw await parseErrorResponse(res)
  return await res.blob()
}

/** 触发浏览器下载一个 Blob */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
