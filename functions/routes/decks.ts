import { requireUser } from '../lib/current-user.ts'
import type { CurrentUser } from '../lib/current-user.ts'
import {
  deleteWhere,
  findRow,
  insertRow,
  jsonValue,
  num,
  selectRows,
  str,
  updateWhere,
  type Row,
} from '../lib/db.ts'
import { HttpError, validationError } from '../lib/errors.ts'
import {
  asObject,
  idArrayField,
  intField,
  json,
  noContent,
  pathId,
  queryInt,
  readJson,
} from '../lib/http.ts'
import { newId } from '../lib/ids.ts'
import {
  deckEventOut,
  deckJobOut,
  deckOut,
  deckPageOut,
} from '../lib/serializers.ts'
import { workspaceSourceSignature } from '../lib/signature.ts'
import { readBytes, removeObjects } from '../lib/storage.ts'
import type { Route } from '../router.ts'
import { getOwnedWorkspace } from './workspaces.ts'

const DECK_COLUMNS =
  'id,workspace_id,title,status,style,outline,source_signature,last_page_id,completed_page_ids,created_at,updated_at'
const PAGE_COLUMNS =
  'id,deck_id,knowledge_point_ids,primary_knowledge_point_id,ordinal,title,kind,status,current_version,bundle_key,thumbnail_key,manifest,validation,build_attempts,builder_build_id,created_at,updated_at'
const JOB_COLUMNS =
  'id,deck_id,workspace_id,status,stage,progress,total_pages,ready_pages,failed_pages,error,cancel_requested,target_page_id,created_at,started_at,finished_at'

const ACTIVE_STATUSES = new Set(['pending', 'planning', 'building', 'validating'])
const EVENT_PAGE_LIMIT = 500
const BUILD_UNAVAILABLE = '复习页构建服务未部署（Serverless 版本暂不提供）'
const CHAT_UNAVAILABLE = '页面 AI 助手未部署（Serverless 版本暂不提供）'

const PRESET_ALIASES: Record<string, string> = {
  讲义: 'editorial',
  图解: 'blueprint',
  冲刺: 'drill',
  叙事: 'story',
}
const PRESETS = new Set(['editorial', 'blueprint', 'drill', 'story'])
const DENSITIES = new Set(['concise', 'standard', 'deep'])
const DESIGN_SYSTEMS = new Set(['1.0', '2.0'])
const PAGE_THEMES = new Set(['editorial', 'workbench', 'problem'])

interface DeckStyle {
  preset: string
  content: string[]
  density: string
  custom_prompt: string
  design_system: string
  page_theme: string
  outline_override: unknown
}

function defaultStyle(): DeckStyle {
  return {
    preset: 'editorial',
    content: [],
    density: 'standard',
    custom_prompt: '',
    design_system: '1.0',
    page_theme: 'workbench',
    outline_override: null,
  }
}

function parseStyle(raw: unknown, base: DeckStyle): DeckStyle {
  if (raw === undefined || raw === null) return base
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw validationError({ style: 'Input should be a valid dictionary or object' })
  }
  const body = raw as Record<string, unknown>
  const style: DeckStyle = { ...base }

  if (body.preset !== undefined) {
    if (typeof body.preset !== 'string') throw validationError({ preset: 'Input should be a valid string' })
    const alias = PRESET_ALIASES[body.preset.trim()]
    const preset = alias ?? body.preset.trim()
    if (!PRESETS.has(preset)) throw validationError({ preset: 'Input should be a valid literal value' })
    style.preset = preset
  }
  if (body.content !== undefined) {
    if (!Array.isArray(body.content)) throw validationError({ content: 'Input should be a valid list' })
    if (body.content.length > 20) throw validationError({ content: 'List should have at most 20 items' })
    const items: string[] = []
    for (const item of body.content) {
      if (typeof item !== 'string') throw validationError({ content: 'Input should be a valid string' })
      const text = item.trim()
      if (!text) continue
      if (text.length > 32) throw validationError({ content: '内容偏好单项不能超过 32 个字符' })
      if (!items.includes(text)) items.push(text)
    }
    style.content = items
  }
  if (body.density !== undefined) {
    if (typeof body.density !== 'string' || !DENSITIES.has(body.density)) {
      throw validationError({ density: 'Input should be a valid literal value' })
    }
    style.density = body.density
  }
  if (body.custom_prompt !== undefined) {
    if (typeof body.custom_prompt !== 'string') {
      throw validationError({ custom_prompt: 'Input should be a valid string' })
    }
    const text = body.custom_prompt.trim()
    if (text.length > 500) throw validationError({ custom_prompt: 'String should have at most 500 characters' })
    style.custom_prompt = text
  }
  if (body.design_system !== undefined) {
    if (typeof body.design_system !== 'string' || !DESIGN_SYSTEMS.has(body.design_system)) {
      throw validationError({ design_system: 'Input should be a valid literal value' })
    }
    style.design_system = body.design_system
  }
  if (body.page_theme !== undefined) {
    if (typeof body.page_theme !== 'string' || !PAGE_THEMES.has(body.page_theme)) {
      throw validationError({ page_theme: 'Input should be a valid literal value' })
    }
    style.page_theme = body.page_theme
  }
  if (body.outline_override !== undefined) {
    style.outline_override = body.outline_override
  }
  return style
}

async function getOwnedDeck(deckId: number, user: CurrentUser): Promise<Row> {
  const deck = await findRow('review_decks', [['id', deckId]], DECK_COLUMNS)
  if (!deck) throw new HttpError(404, '复习页不存在')
  const workspace = await findRow('workspaces', [['id', num(deck.workspace_id)]], 'id,user_id')
  if (!workspace || num(workspace.user_id) !== user.id) throw new HttpError(404, '复习页不存在')
  return deck
}

async function ownedPage(deck: Row, pageId: number): Promise<Row> {
  const page = await findRow('deck_pages', [['id', pageId]], PAGE_COLUMNS)
  if (!page || num(page.deck_id) !== num(deck.id)) throw new HttpError(404, '页面不存在')
  return page
}

async function ownedDeckJob(jobId: number, user: CurrentUser): Promise<Row> {
  const job = await findRow('deck_build_jobs', [['id', jobId]], JOB_COLUMNS)
  if (!job) throw new HttpError(404, '构建任务不存在')
  const deck = await findRow('review_decks', [['id', num(job.deck_id)]], 'id,workspace_id')
  if (!deck) throw new HttpError(404, '构建任务不存在')
  const workspace = await findRow('workspaces', [['id', num(deck.workspace_id)]], 'id,user_id')
  if (!workspace || num(workspace.user_id) !== user.id) throw new HttpError(404, '构建任务不存在')
  return job
}

async function pagesForDeck(deckId: number): Promise<Row[]> {
  return selectRows<Row>('deck_pages', PAGE_COLUMNS, [['deck_id', deckId]], {
    order: 'ordinal',
  })
}

async function activeJobId(deckId: number): Promise<number | null> {
  const jobs = await selectRows<Row>('deck_build_jobs', 'id,status', [['deck_id', deckId]], {
    order: 'id',
  })
  for (const job of jobs) if (ACTIVE_STATUSES.has(str(job.status))) return num(job.id)
  return null
}

async function latestJobId(deckId: number): Promise<number | null> {
  const jobs = await selectRows<Row>('deck_build_jobs', 'id', [['deck_id', deckId]], {
    order: 'id',
    ascending: false,
    limit: 1,
  })
  return jobs.length > 0 ? num(jobs[0].id) : null
}

async function deckDetail(deck: Row): Promise<Record<string, unknown>> {
  const deckId = num(deck.id)
  const pages = await pagesForDeck(deckId)
  const active = await activeJobId(deckId)
  const latest = await latestJobId(deckId)
  let sourceChanged = false
  if (str(deck.source_signature)) {
    sourceChanged = (await workspaceSourceSignature(num(deck.workspace_id))) !== str(deck.source_signature)
  }
  return deckOut(deck, pages, { sourceChanged, activeJobId: active, lastJobId: latest })
}

async function listDecks(request: Request, workspaceId: number): Promise<Response> {
  const user = await requireUser(request)
  await getOwnedWorkspace(workspaceId, user)
  const decks = await selectRows<Row>('review_decks', DECK_COLUMNS, [
    ['workspace_id', workspaceId],
  ], { order: 'updated_at', ascending: false })

  const pagesByDeck = new Map<number, Row[]>()
  for (const deck of decks) {
    pagesByDeck.set(num(deck.id), await pagesForDeck(num(deck.id)))
  }

  const jobs = await selectRows<Row>('deck_build_jobs', 'id,deck_id,status', [
    ['workspace_id', workspaceId],
  ], { order: 'id' })

  const activeByDeck = new Map<number, number>()
  const latestByDeck = new Map<number, number>()
  for (const job of jobs) {
    const key = num(job.deck_id)
    latestByDeck.set(key, num(job.id))
    if (ACTIVE_STATUSES.has(str(job.status)) && !activeByDeck.has(key)) activeByDeck.set(key, num(job.id))
  }

  let signature: string | null = null
  if (decks.some((deck) => Boolean(deck.source_signature))) {
    signature = await workspaceSourceSignature(workspaceId)
  }

  return json(decks.map((deck) => deckOut(deck, pagesByDeck.get(num(deck.id)) ?? [], {
    sourceChanged: Boolean(deck.source_signature) && signature !== null && str(deck.source_signature) !== signature,
    activeJobId: activeByDeck.get(num(deck.id)) ?? null,
    lastJobId: latestByDeck.get(num(deck.id)) ?? null,
  })))
}

async function createDeck(request: Request, workspaceId: number): Promise<Response> {
  const user = await requireUser(request)
  const workspace = await getOwnedWorkspace(workspaceId, user)
  const body = await readJson(request)
  const rawTitle = body.title
  let title = ''
  if (rawTitle !== undefined && rawTitle !== null) {
    if (typeof rawTitle !== 'string') throw validationError({ title: 'Input should be a valid string' })
    title = rawTitle.trim()
    if (!title) throw new HttpError(400, '复习页标题不能为空')
    if (rawTitle.trim().length > 255) throw validationError({ title: 'String should have at most 255 characters' })
  }
  if (!title) title = `${str(workspace.name)} · 复习页`
  const style = parseStyle(body.style, defaultStyle())

  const id = newId()
  const now = new Date().toISOString()
  const inserted = await insertRow<Row>('review_decks', {
    id,
    workspace_id: workspaceId,
    title: title.slice(0, 255),
    status: 'draft',
    style,
    outline: {},
    source_signature: null,
    last_page_id: null,
    completed_page_ids: [],
    created_at: now,
    updated_at: now,
  }, DECK_COLUMNS)
  if (!inserted) throw new HttpError(503, '创建复习页失败，请稍后重试')
  return json(await deckDetail(inserted))
}

async function getDeck(request: Request, deckId: number): Promise<Response> {
  const user = await requireUser(request)
  const deck = await getOwnedDeck(deckId, user)
  return json(await deckDetail(deck))
}

async function updateDeck(request: Request, deckId: number): Promise<Response> {
  const user = await requireUser(request)
  const deck = await getOwnedDeck(deckId, user)
  const body = await readJson(request)
  const values: Row = { updated_at: new Date().toISOString() }
  if (body.title !== undefined && body.title !== null) {
    if (typeof body.title !== 'string') throw validationError({ title: 'Input should be a valid string' })
    const title = body.title.trim()
    if (!title) throw new HttpError(400, '复习页标题不能为空')
    values.title = title.slice(0, 255)
  }
  if (body.style !== undefined && body.style !== null) {
    values.style = parseStyle(body.style, jsonValue<DeckStyle>(deck.style, defaultStyle()))
  }
  const updated = await updateWhere<Row>('review_decks', values, [['id', deckId]], DECK_COLUMNS)
  return json(await deckDetail(updated.length > 0 ? updated[0] : { ...deck, ...values }))
}

async function deleteDeck(request: Request, deckId: number): Promise<Response> {
  const user = await requireUser(request)
  const deck = await getOwnedDeck(deckId, user)
  const pages = await pagesForDeck(deckId)
  const storageKeys = pages.flatMap((page) =>
    [page.bundle_key, page.thumbnail_key].filter((key): key is string => typeof key === 'string' && key.length > 0),
  )
  const jobs = await selectRows<Row>('deck_build_jobs', 'id', [['deck_id', deckId]])
  for (const job of jobs) await deleteWhere('deck_build_events', [['job_id', num(job.id)]])
  await deleteWhere('page_chat_messages', [['deck_id', deckId]])
  await deleteWhere('knowledge_points', [['deck_id', deckId]])
  await deleteWhere('deck_pages', [['deck_id', deckId]])
  await deleteWhere('deck_build_jobs', [['deck_id', deckId]])
  await deleteWhere('review_decks', [['id', deckId]])
  await removeObjects(storageKeys)
  return noContent()
}

async function buildUnavailable(request: Request, deckId: number): Promise<Response> {
  const user = await requireUser(request)
  await getOwnedDeck(deckId, user)
  throw new HttpError(503, BUILD_UNAVAILABLE)
}

async function cancelUnavailable(request: Request, deckId: number): Promise<Response> {
  const user = await requireUser(request)
  await getOwnedDeck(deckId, user)
  throw new HttpError(503, BUILD_UNAVAILABLE)
}

async function getDeckJob(request: Request, jobId: number): Promise<Response> {
  const user = await requireUser(request)
  return json(deckJobOut(await ownedDeckJob(jobId, user)))
}

async function getDeckEvents(request: Request, jobId: number, url: URL): Promise<Response> {
  const user = await requireUser(request)
  await ownedDeckJob(jobId, user)
  const afterId = queryInt(url, 'after_id', 0, 0, Number.MAX_SAFE_INTEGER)
  const rows = await selectRows<Row>('deck_build_events',
    'id,job_id,page_id,type,payload,created_at',
    [['job_id', jobId]],
    { order: 'id' })
  return json(rows.filter((row) => num(row.id) > afterId).slice(0, EVENT_PAGE_LIMIT).map(deckEventOut))
}

async function getDeckPage(request: Request, deckId: number, pageId: number): Promise<Response> {
  const user = await requireUser(request)
  const deck = await getOwnedDeck(deckId, user)
  return json(deckPageOut(await ownedPage(deck, pageId)))
}

async function getDeckPageBundle(request: Request, deckId: number, pageId: number): Promise<Response> {
  const user = await requireUser(request)
  const deck = await getOwnedDeck(deckId, user)
  const page = await ownedPage(deck, pageId)
  if (str(page.status) !== 'ready' || !str(page.bundle_key)) {
    throw new HttpError(404, '页面尚未生成完成')
  }
  let payload: unknown
  try {
    const bytes = await readBytes(str(page.bundle_key), 4 * 1024 * 1024)
    payload = JSON.parse(new TextDecoder('utf-8').decode(bytes))
  } catch (error) {
    if (error instanceof HttpError) throw new HttpError(404, '页面尚未生成完成')
    throw new HttpError(503, '读取页面数据失败，请稍后重试')
  }
  if (payload === null || typeof payload !== 'object') {
    throw new HttpError(503, '页面数据不符合页面契约，请重新生成页面')
  }
  return json(payload)
}

async function thumbnailUnavailable(request: Request, deckId: number, pageId: number): Promise<Response> {
  const user = await requireUser(request)
  const deck = await getOwnedDeck(deckId, user)
  await ownedPage(deck, pageId)
  throw new HttpError(404, '页面缩略图尚未生成')
}

async function rebuildUnavailable(request: Request, deckId: number, pageId: number): Promise<Response> {
  const user = await requireUser(request)
  const deck = await getOwnedDeck(deckId, user)
  await ownedPage(deck, pageId)
  throw new HttpError(503, BUILD_UNAVAILABLE)
}

async function updateProgress(request: Request, deckId: number): Promise<Response> {
  const user = await requireUser(request)
  const deck = await getOwnedDeck(deckId, user)
  const body = asObject(await readJson(request))
  const values: Row = { updated_at: new Date().toISOString() }

  if (body.last_page_id !== undefined && body.last_page_id !== null) {
    const lastPageId = intField(body, 'last_page_id')
    await ownedPage(deck, lastPageId)
    values.last_page_id = lastPageId
    deck.last_page_id = lastPageId
  }
  if (body.completed_page_ids !== undefined && body.completed_page_ids !== null) {
    const requested = idArrayField(body, 'completed_page_ids', { maxItems: 500 }) ?? []
    if (requested.length > 0) {
      const pages = await pagesForDeck(deckId)
      const valid = new Set(pages.map((page) => num(page.id)))
      if (requested.some((id) => !valid.has(id))) {
        throw new HttpError(400, 'completed_page_ids 包含不属于该复习页的页面')
      }
    }
    const merged = Array.from(new Set([...jsonValue<number[]>(deck.completed_page_ids, []), ...requested])).sort(
      (a, b) => a - b,
    )
    values.completed_page_ids = merged
    deck.completed_page_ids = merged
  }
  await updateWhere('review_decks', values, [['id', deckId]])
  return json({
    last_page_id: typeof values.last_page_id === 'number'
      ? values.last_page_id
      : (typeof deck.last_page_id === 'number' ? deck.last_page_id : null),
    completed_page_ids: jsonValue<number[]>(deck.completed_page_ids, []),
  })
}

async function messagesUnavailable(request: Request, deckId: number, pageId: number): Promise<Response> {
  const user = await requireUser(request)
  const deck = await getOwnedDeck(deckId, user)
  await ownedPage(deck, pageId)
  throw new HttpError(501, CHAT_UNAVAILABLE)
}

export const deckRoutes: Route[] = [
  {
    method: 'GET',
    path: '/workspaces/:id/decks',
    handler: ({ request, params }) => listDecks(request, pathId(params.id)),
  },
  {
    method: 'POST',
    path: '/workspaces/:id/decks',
    handler: ({ request, params }) => createDeck(request, pathId(params.id)),
  },
  { method: 'GET', path: '/decks/:id', handler: ({ request, params }) => getDeck(request, pathId(params.id)) },
  {
    method: 'PATCH',
    path: '/decks/:id',
    handler: ({ request, params }) => updateDeck(request, pathId(params.id)),
  },
  {
    method: 'DELETE',
    path: '/decks/:id',
    handler: ({ request, params }) => deleteDeck(request, pathId(params.id)),
  },
  {
    method: 'POST',
    path: '/decks/:id/build',
    handler: ({ request, params }) => buildUnavailable(request, pathId(params.id)),
  },
  {
    method: 'POST',
    path: '/decks/:id/cancel',
    handler: ({ request, params }) => cancelUnavailable(request, pathId(params.id)),
  },
  {
    method: 'GET',
    path: '/deck-jobs/:id',
    handler: ({ request, params }) => getDeckJob(request, pathId(params.id)),
  },
  {
    method: 'GET',
    path: '/deck-jobs/:id/events',
    handler: ({ request, params, url }) => getDeckEvents(request, pathId(params.id), url),
  },
  {
    method: 'GET',
    path: '/decks/:id/pages/:page',
    handler: ({ request, params }) => getDeckPage(request, pathId(params.id), pathId(params.page)),
  },
  {
    method: 'GET',
    path: '/decks/:id/pages/:page/bundle',
    handler: ({ request, params }) => getDeckPageBundle(request, pathId(params.id), pathId(params.page)),
  },
  {
    method: 'GET',
    path: '/decks/:id/pages/:page/thumbnail',
    handler: ({ request, params }) => thumbnailUnavailable(request, pathId(params.id), pathId(params.page)),
  },
  {
    method: 'POST',
    path: '/decks/:id/pages/:page/rebuild',
    handler: ({ request, params }) => rebuildUnavailable(request, pathId(params.id), pathId(params.page)),
  },
  {
    method: 'PATCH',
    path: '/decks/:id/progress',
    handler: ({ request, params }) => updateProgress(request, pathId(params.id)),
  },
  {
    method: 'GET',
    path: '/decks/:id/pages/:page/messages',
    handler: ({ request, params }) => messagesUnavailable(request, pathId(params.id), pathId(params.page)),
  },
  {
    method: 'POST',
    path: '/decks/:id/pages/:page/messages',
    handler: ({ request, params }) => messagesUnavailable(request, pathId(params.id), pathId(params.page)),
  },
]
