import { json } from '../lib/http.ts'
import { selectRows } from '../lib/db.ts'
import type { Route } from '../router.ts'

async function health(): Promise<Response> {
  try {
    await selectRows('users', 'id', [], { limit: 1 })
    return json({ status: 'ok', database: 'ok' })
  } catch {
    return json({ status: 'ok', database: 'unreachable' })
  }
}

export const healthRoutes: Route[] = [
  { method: 'GET', path: '/health', handler: () => health() },
]
