import { env } from '../lib/config.ts'
import { HttpError } from '../lib/errors.ts'
import { json, queryInt } from '../lib/http.ts'
import type { Route } from '../router.ts'

/**
 * Phase 0 平台能力探测入口，仅在配置 PROBE_TOKEN 时可用。
 * 探测完成后删除本路由与 PROBE_TOKEN Secret。
 */
function assertProbe(request: Request): void {
  const token = env('PROBE_TOKEN')
  if (!token || request.headers.get('x-probe-token') !== token) {
    throw new HttpError(404, 'Not Found')
  }
}

const MAX_PROBE_SLEEP_MS = 120_000
const MAX_PROBE_BYTES = 24 * 1024 * 1024

async function timing(request: Request, url: URL): Promise<Response> {
  assertProbe(request)
  const wait = queryInt(url, 'ms', 0, 0, MAX_PROBE_SLEEP_MS)
  const started = Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  return json({ ok: true, requested_ms: wait, elapsed_ms: Date.now() - started })
}

async function responseSize(request: Request, url: URL): Promise<Response> {
  assertProbe(request)
  const size = queryInt(url, 'n', 0, 0, MAX_PROBE_BYTES)
  return new Response('x'.repeat(size), {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

async function requestSize(request: Request): Promise<Response> {
  assertProbe(request)
  const started = Date.now()
  const body = new Uint8Array(await request.arrayBuffer())
  const digest = await crypto.subtle.digest('SHA-256', body)
  const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return json({
    ok: true,
    bytes: body.byteLength,
    content_length: request.headers.get('content-length'),
    sha256: hash,
    elapsed_ms: Date.now() - started,
  })
}

export const probeRoutes: Route[] = [
  { method: 'GET', path: '/health/probe', handler: ({ request, url }) => timing(request, url) },
  { method: 'GET', path: '/health/probe/bytes', handler: ({ request, url }) => responseSize(request, url) },
  { method: 'POST', path: '/health/probe/echo', handler: ({ request }) => requestSize(request) },
]
