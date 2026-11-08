import { HttpError } from './lib/errors.ts'
import { errorToResponse, json, noContent, requestId } from './lib/http.ts'
import { normalizePath } from './lib/path.ts'
import { artifactRoutes } from './routes/artifacts.ts'
import { authRoutes } from './routes/auth.ts'
import { deckRoutes } from './routes/decks.ts'
import { generationRoutes } from './routes/generation.ts'
import { healthRoutes } from './routes/health.ts'
import { materialRoutes } from './routes/materials.ts'
import { probeRoutes } from './routes/probe.ts'
import { workspaceRoutes } from './routes/workspaces.ts'

export interface RouteContext {
  request: Request
  url: URL
  params: Record<string, string>
}

export interface Route {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** `/workspaces/:id/materials` 形式；`:name` 匹配单个路径段。 */
  path: string
  handler: (context: RouteContext) => Promise<Response> | Response
}

const ROUTES: Route[] = [
  ...healthRoutes,
  ...authRoutes,
  ...workspaceRoutes,
  ...materialRoutes,
  ...generationRoutes,
  ...artifactRoutes,
  ...deckRoutes,
  ...probeRoutes,
]

interface CompiledRoute {
  route: Route
  segments: string[]
}

const COMPILED: CompiledRoute[] = ROUTES.map((route) => ({
  route,
  segments: route.path.split('/').filter(Boolean),
}))

function matchSegments(segments: string[], parts: string[]): Record<string, string> | null {
  if (segments.length !== parts.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const part = parts[index]
    if (segment.startsWith(':')) {
      if (!part) return null
      params[segment.slice(1)] = decodeURIComponent(part)
    } else if (segment !== part) {
      return null
    }
  }
  return params
}

export async function handleRequest(request: Request): Promise<Response> {
  const id = requestId(request)
  try {
    const url = new URL(request.url)
    const path = normalizePath(url.pathname)
    if (path === null) return json({ detail: 'Not Found' }, 404)

    if (request.method === 'OPTIONS') {
      return noContent({
        'access-control-allow-origin': url.origin,
        'access-control-allow-headers': 'authorization,content-type',
        'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
        'access-control-max-age': '600',
      })
    }

    const parts = path.split('/').filter(Boolean)
    let methodMismatch = false
    for (const compiled of COMPILED) {
      const params = matchSegments(compiled.segments, parts)
      if (params === null) continue
      if (compiled.route.method !== request.method) {
        methodMismatch = true
        continue
      }
      return await compiled.route.handler({ request, url, params })
    }
    if (methodMismatch) throw new HttpError(405, 'Method Not Allowed')
    return json({ detail: 'Not Found' }, 404)
  } catch (error) {
    return errorToResponse(error, id)
  }
}
