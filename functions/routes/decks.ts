import { config } from '../lib/config.ts'
import { chunkCorpus, chunkSourceLabel, loadCorpus, type CorpusChunk } from '../lib/corpus.ts'
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
import { chatJson } from '../lib/json-chat.ts'
import { chat } from '../lib/llm.ts'
import {
  DENSITY_PAGE_RANGES,
  ROLE_MINUTES,
  planPages,
  type PagePlan,
  type PlannerChapter,
  type PlannerKnowledgePoint,
  type TeachingRole,
} from '../lib/planner.ts'
import {
  CHUNK_DIGEST_SYSTEM,
  KP_DETAIL_SYSTEM,
  PAGE_CHAT_SYSTEM,
  PAGE_CONTENT_SYSTEM,
  PAGE_REPAIR_SYSTEM,
  PLAN_SYSTEM,
  REDUCE_SYSTEM,
  chunkDigestUser,
  kpDetailUser,
  pageChatUser,
  pageContentUser,
  pageRepairUser,
  planUser,
  reduceUser,
} from '../lib/prompts.ts'
import {
  PAGE_THEMES,
  describeIssues,
  hasErrors,
  renderPage,
  validateContent,
  type ContentIssue,
  type PageTheme,
} from '../lib/page-kit/index.ts'
import {
  deckEventOut,
  deckJobOut,
  deckOut,
  deckPageOut,
  pageMessageOut,
} from '../lib/serializers.ts'
import { workspaceSourceSignature } from '../lib/signature.ts'
import { readBytes, removeObjects, saveBytes } from '../lib/storage.ts'
import type { Route } from '../router.ts'
import { getOwnedWorkspace } from './workspaces.ts'

const DECK_COLUMNS =
  'id,workspace_id,title,status,style,outline,source_signature,last_page_id,completed_page_ids,created_at,updated_at'
const PAGE_COLUMNS =
  'id,deck_id,knowledge_point_ids,primary_knowledge_point_id,ordinal,title,kind,status,current_version,bundle_key,thumbnail_key,manifest,validation,build_attempts,builder_build_id,created_at,updated_at'
const JOB_COLUMNS =
  'id,deck_id,workspace_id,status,stage,progress,total_pages,ready_pages,failed_pages,error,cancel_requested,target_page_id,feedback,cursor,lease_key,lease_until,created_at,started_at,finished_at'
const KP_COLUMNS =
  'id,deck_id,parent_id,ordinal,title,summary,importance,difficulty,objectives,key_points,formulas,misconceptions,source_refs,interaction_idea,created_at'

const ACTIVE_STATUSES = new Set(['pending', 'running', 'planning', 'building', 'validating'])
const EVENT_PAGE_LIMIT = 500
const LEASE_MS = 120_000
const REDUCE_FAN_IN = 4
const READ_LIMIT = 4 * 1024 * 1024
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024
const MAX_REPAIR_ATTEMPTS = 2
const MAX_SOURCE_EXCERPTS = 12_000
const MAX_SECTION_CHARS = 3_000

const PRESET_ALIASES: Record<string, string> = {
  讲义: 'editorial',
  图解: 'blueprint',
  冲刺: 'drill',
  叙事: 'story',
}
const PRESETS = new Set(['editorial', 'blueprint', 'drill', 'story'])
const DENSITIES = new Set(['concise', 'standard', 'deep'])
const DESIGN_SYSTEMS = new Set(['1.0', '2.0'])

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
    design_system: '2.0',
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
    if (typeof body.page_theme !== 'string' || !PAGE_THEMES.includes(body.page_theme as PageTheme)) {
      throw validationError({ page_theme: 'Input should be a valid literal value' })
    }
    style.page_theme = body.page_theme
  }
  if (body.outline_override !== undefined) {
    style.outline_override = body.outline_override
  }
  return style
}

/* ------------------------------ 构建游标 ------------------------------ */

interface ChapterCursor {
  title: string
  kpIds: number[]
}

interface DeckCursor {
  v: 2
  phase: 'index' | 'reduce' | 'plan' | 'detail' | 'page' | 'render' | 'done'
  chunkTotal: number
  mapDone: number
  reduceLevel: number
  reduceTotal: number
  reduceDone: number
  chapters: ChapterCursor[]
  chapterDone: number
  pageOrdinal: number
  currentPageId: number | null
  attempts: number
  totalPages: number
  singlePage: boolean
  rebuildAll: boolean
}

function emptyCursor(): DeckCursor {
  return {
    v: 2,
    phase: 'index',
    chunkTotal: 0,
    mapDone: 0,
    reduceLevel: 0,
    reduceTotal: 0,
    reduceDone: 0,
    chapters: [],
    chapterDone: 0,
    pageOrdinal: 0,
    currentPageId: null,
    attempts: 0,
    totalPages: 0,
    singlePage: false,
    rebuildAll: false,
  }
}

function readCursor(job: Row): DeckCursor | null {
  const raw = job.cursor
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const cursor = raw as Partial<DeckCursor>
  if (cursor.v !== 2 || typeof cursor.phase !== 'string') return null
  return {
    ...emptyCursor(),
    ...cursor,
    chapters: Array.isArray(cursor.chapters) ? cursor.chapters : [],
    currentPageId: typeof cursor.currentPageId === 'number' ? cursor.currentPageId : null,
  }
}

function terminal(status: string): boolean {
  return status === 'done' || status === 'failed' || status === 'canceled'
}

/* ------------------------------ 基础查询 ------------------------------ */

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
  return selectRows<Row>('deck_pages', PAGE_COLUMNS, [['deck_id', deckId]], { order: 'ordinal' })
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

async function pageCounts(deckId: number): Promise<{ total: number; ready: number; failed: number }> {
  const pages = await selectRows<Row>('deck_pages', 'status', [['deck_id', deckId]])
  return {
    total: pages.length,
    ready: pages.filter((page) => str(page.status) === 'ready').length,
    failed: pages.filter((page) => str(page.status) === 'failed').length,
  }
}

async function addEvent(jobId: number, type: string, pageId: number | null, payload: Row): Promise<void> {
  try {
    await insertRow('deck_build_events', {
      id: newId(),
      job_id: jobId,
      page_id: pageId,
      type,
      payload,
      created_at: new Date().toISOString(),
    })
  } catch {
    // 事件仅用于进度展示，写入失败不影响构建
  }
}

/* ------------------------------ Deck CRUD ------------------------------ */

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
  await getOwnedDeck(deckId, user)
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

/* ------------------------------ 构建任务 ------------------------------ */

async function buildDeck(request: Request, deckId: number): Promise<Response> {
  const user = await requireUser(request)
  const deck = await getOwnedDeck(deckId, user)
  if (!config.llmConfigured) {
    throw new HttpError(400, '未配置 LLM 服务（缺少 LLM_API_KEY），无法构建复习页')
  }
  const indexed = await selectRows('materials', 'id', [
    ['workspace_id', num(deck.workspace_id)],
    ['status', 'indexed'],
  ], { limit: 1 })
  if (indexed.length === 0) {
    throw new HttpError(400, '当前工作区没有已就绪的资料，请先上传资料并等待解析完成')
  }
  if (await activeJobId(deckId) !== null) {
    throw new HttpError(409, '当前复习页已有正在进行的构建任务，请等待其完成')
  }

  let body: Record<string, unknown> = {}
  try {
    body = await readJson(request)
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 400) throw error
  }
  const cursor = { ...emptyCursor(), rebuildAll: Boolean(body.rebuild_all ?? body.rebuildAll) }

  const jobId = newId()
  const now = new Date().toISOString()
  await insertRow('deck_build_jobs', {
    id: jobId,
    deck_id: deckId,
    workspace_id: num(deck.workspace_id),
    status: 'pending',
    stage: '任务已创建，等待执行…',
    progress: 0,
    total_pages: 0,
    ready_pages: 0,
    failed_pages: 0,
    error: null,
    cancel_requested: false,
    target_page_id: null,
    feedback: null,
    usage: {},
    cursor,
    lease_key: null,
    lease_until: null,
    created_at: now,
    started_at: null,
    finished_at: null,
  })
  await updateWhere('review_decks', { status: 'building', updated_at: now }, [['id', deckId]])
  await addEvent(jobId, 'job_started', null, { deck_id: deckId })
  return json({ job_id: jobId, deck_id: deckId })
}

async function cancelDeckBuild(request: Request, deckId: number): Promise<Response> {
  const user = await requireUser(request)
  await getOwnedDeck(deckId, user)
  const jobs = await selectRows<Row>('deck_build_jobs', 'id,status', [['deck_id', deckId]], { order: 'id' })
  const active = jobs.find((job) => ACTIVE_STATUSES.has(str(job.status)))
  if (!active) throw new HttpError(409, '当前没有正在进行的构建任务')
  const jobId = num(active.id)
  const now = new Date().toISOString()

  const pages = await pagesForDeck(deckId)
  for (const page of pages) {
    if (str(page.status) === 'building') {
      // 已有旧版本的页面取消后仍可阅读，只有从未生成成功的页退回 planned
      await updateWhere('deck_pages', {
        status: str(page.bundle_key) ? 'ready' : 'planned',
        updated_at: now,
      }, [['id', num(page.id)]])
    }
  }
  const updated = await updateWhere<Row>('deck_build_jobs', {
    status: 'canceled',
    cancel_requested: true,
    stage: '已取消',
    finished_at: now,
    lease_key: null,
    lease_until: null,
  }, [['id', jobId]], JOB_COLUMNS)
  if (updated.length === 0) throw new HttpError(503, '取消失败，请稍后重试')
  const counts = await pageCounts(deckId)
  await updateWhere('review_decks', {
    status: counts.ready > 0 ? 'partial' : 'draft',
    updated_at: now,
  }, [['id', deckId]])
  await addEvent(jobId, 'job_canceled', null, { ready_pages: counts.ready, total_pages: counts.total })
  return json(deckJobOut(updated[0]))
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
  // 重建中的页面仍可读旧版本，只要有已保存的 bundle
  if (!str(page.bundle_key)) {
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

async function rebuildPage(request: Request, deckId: number, pageId: number): Promise<Response> {
  const user = await requireUser(request)
  const deck = await getOwnedDeck(deckId, user)
  const page = await ownedPage(deck, pageId)
  if (!config.llmConfigured) {
    throw new HttpError(400, '未配置 LLM 服务（缺少 LLM_API_KEY），无法重建页面')
  }
  if (await activeJobId(deckId) !== null) {
    throw new HttpError(409, '当前复习页已有正在进行的构建任务，请等待其完成')
  }
  let body: Record<string, unknown> = {}
  try {
    body = await readJson(request)
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 400) throw error
  }
  const feedback = typeof body.feedback === 'string' ? body.feedback.trim().slice(0, 500) : ''

  const cursor: DeckCursor = {
    ...emptyCursor(),
    phase: 'page',
    pageOrdinal: num(page.ordinal),
    currentPageId: pageId,
    totalPages: 1,
    singlePage: true,
  }
  const jobId = newId()
  const now = new Date().toISOString()
  await insertRow('deck_build_jobs', {
    id: jobId,
    deck_id: deckId,
    workspace_id: num(deck.workspace_id),
    status: 'pending',
    stage: '页面重做已排队…',
    progress: 0,
    total_pages: 1,
    ready_pages: 0,
    failed_pages: 0,
    error: null,
    cancel_requested: false,
    target_page_id: pageId,
    feedback: feedback || null,
    usage: {},
    cursor,
    lease_key: null,
    lease_until: null,
    created_at: now,
    started_at: null,
    finished_at: null,
  })
  await addEvent(jobId, 'job_started', pageId, { deck_id: deckId, rebuild: true })
  return json({ job_id: jobId, deck_id: deckId })
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

/* ------------------------------ 构建状态机 ------------------------------ */

function jobPrefix(deckId: number, jobId: number): string {
  return `decks/${deckId}/jobs/${jobId}`
}

function digestKey(prefix: string, level: number, index: number): string {
  return `${prefix}/digest/L${level}-${index}.md`
}

function pageContentKey(prefix: string, pageId: number): string {
  return `${prefix}/pages/${pageId}.json`
}

async function readText(key: string): Promise<string> {
  const bytes = await readBytes(key, READ_LIMIT)
  return new TextDecoder('utf-8').decode(bytes)
}

async function writeText(key: string, content: string): Promise<void> {
  await saveBytes(key, new TextEncoder().encode(content), 'text/markdown; charset=utf-8')
}

async function loadChunks(workspaceId: number): Promise<CorpusChunk[]> {
  const chunks = chunkCorpus(await loadCorpus(workspaceId))
  if (chunks.length === 0) throw new HttpError(400, '资料正文为空，无法构建复习页')
  return chunks
}

async function finalDigest(prefix: string, cursor: DeckCursor): Promise<string> {
  const parts: string[] = []
  for (let index = 0; index < cursor.reduceTotal; index += 1) {
    parts.push(await readText(digestKey(prefix, cursor.reduceLevel, index)))
  }
  return parts.join('\n\n---\n\n')
}

async function saveCursor(jobId: number, cursor: DeckCursor, stage: string): Promise<void> {
  await updateWhere('deck_build_jobs', { cursor, stage, status: 'running' }, [['id', jobId]])
}

async function failJob(jobId: number, deckId: number, detail: string): Promise<void> {
  const now = new Date().toISOString()
  const pages = await pagesForDeck(deckId)
  for (const page of pages) {
    if (str(page.status) === 'building') {
      await updateWhere('deck_pages', {
        status: str(page.bundle_key) ? 'ready' : 'planned',
        updated_at: now,
      }, [['id', num(page.id)]])
    }
  }
  const counts = await pageCounts(deckId)
  await updateWhere('deck_build_jobs', {
    status: 'failed',
    stage: '构建失败',
    error: detail.slice(0, 2000),
    finished_at: now,
    lease_key: null,
    lease_until: null,
    ready_pages: counts.ready,
    failed_pages: counts.failed,
    total_pages: counts.total,
    progress: counts.ready + counts.failed,
  }, [['id', jobId]])
  await updateWhere('review_decks', {
    status: counts.ready > 0 ? 'partial' : 'failed',
    updated_at: now,
  }, [['id', deckId]])
  await addEvent(jobId, 'job_failed', null, { message: detail.slice(0, 500) })
}

async function refreshJobCounters(jobId: number, deckId: number): Promise<void> {
  const counts = await pageCounts(deckId)
  await updateWhere('deck_build_jobs', {
    ready_pages: counts.ready,
    failed_pages: counts.failed,
    total_pages: counts.total,
    progress: counts.ready + counts.failed,
  }, [['id', jobId]])
}

function validatePlan(value: unknown): string | null {
  const record = value as Record<string, unknown>
  const chapters = record.chapters
  if (!Array.isArray(chapters) || chapters.length < 3 || chapters.length > 6) {
    return 'chapters 必须是 3–6 章的数组'
  }
  let total = 0
  for (const [index, chapter] of chapters.entries()) {
    if (!chapter || typeof chapter !== 'object') return `第 ${index + 1} 章不是对象`
    const item = chapter as Record<string, unknown>
    if (typeof item.title !== 'string' || !item.title.trim()) return `第 ${index + 1} 章缺少标题`
    if (!Array.isArray(item.knowledge_points) || item.knowledge_points.length === 0) {
      return `第 ${index + 1} 章缺少知识点`
    }
    total += item.knowledge_points.length
    for (const [kpIndex, kp] of (item.knowledge_points as unknown[]).entries()) {
      if (!kp || typeof kp !== 'object') return `第 ${index + 1} 章第 ${kpIndex + 1} 个知识点不是对象`
      const point = kp as Record<string, unknown>
      if (typeof point.title !== 'string' || !point.title.trim()) {
        return `第 ${index + 1} 章第 ${kpIndex + 1} 个知识点缺少标题`
      }
      if (point.section_ids !== undefined && !Array.isArray(point.section_ids)) {
        return `第 ${index + 1} 章第 ${kpIndex + 1} 个知识点的 section_ids 必须是数组`
      }
    }
  }
  if (total < 6 || total > 16) return `知识点总数必须为 6–16，当前为 ${total}`
  return null
}

function validateKpDetail(value: unknown): string | null {
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.knowledge_points)) return 'knowledge_points 必须是数组'
  for (const item of record.knowledge_points) {
    if (!item || typeof item !== 'object') return 'knowledge_points 中存在非对象条目'
    if (typeof (item as Record<string, unknown>).id !== 'number') return 'knowledge_points.id 必须是数字'
  }
  return null
}

interface PlannedKp {
  title: string
  summary: string
  importance: string
  difficulty: string
  teaching_role_hint: TeachingRole
  section_ids: number[]
  key_points: string[]
  interaction_idea: string
  misconceptions: string[]
}

interface PlannedChapter {
  title: string
  knowledge_points: PlannedKp[]
}

function normalizePlan(value: unknown, validSections: Set<number>): PlannedChapter[] {
  const chapters = (value as { chapters: Array<Record<string, unknown>> }).chapters
  const roles = new Set(['concept', 'mechanism', 'worked_example', 'practice', 'compare', 'summary'])
  return chapters.map((chapter) => ({
    title: str(chapter.title).trim().slice(0, 255),
    knowledge_points: ((chapter.knowledge_points as unknown[]) ?? []).map((raw) => {
      const kp = raw as Record<string, unknown>
      const sectionIds = Array.isArray(kp.section_ids)
        ? (kp.section_ids as unknown[]).map(Number).filter((id) => Number.isInteger(id) && validSections.has(id))
        : []
      const importance = str(kp.importance, 'normal')
      const difficulty = str(kp.difficulty, 'medium')
      const hint = str(kp.teaching_role_hint) as TeachingRole
      return {
        title: str(kp.title).trim().slice(0, 255),
        summary: str(kp.summary).trim().slice(0, 4000),
        importance: ['core', 'normal', 'minor'].includes(importance) ? importance : 'normal',
        difficulty: ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium',
        teaching_role_hint: roles.has(hint) ? hint : 'concept',
        section_ids: sectionIds.slice(0, 50),
        key_points: Array.isArray(kp.key_points)
          ? (kp.key_points as unknown[]).map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
          : [],
        interaction_idea: str(kp.interaction_idea).trim().slice(0, 2000),
        misconceptions: Array.isArray(kp.misconceptions)
          ? (kp.misconceptions as unknown[]).map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
          : [],
      }
    }),
  }))
}

function sectionMap(rows: Row[]): Map<number, Row> {
  const map = new Map<number, Row>()
  for (const row of rows) map.set(num(row.id), row)
  return map
}

function sourceRefsFor(
  sectionIds: number[],
  sections: Map<number, Row>,
): Array<Record<string, unknown>> {
  const refs: Array<Record<string, unknown>> = []
  for (const id of sectionIds) {
    const section = sections.get(id)
    if (!section) continue
    refs.push({
      material_id: num(section.material_id),
      section_id: id,
      heading: str(section.heading),
      quote: str(section.content).replace(/\s+/g, ' ').trim().slice(0, 200),
      unverified: false,
    })
    if (refs.length >= 5) break
  }
  return refs
}

async function planDeck(
  job: Row,
  cursor: DeckCursor,
  deck: Row,
): Promise<void> {
  const deckId = num(deck.id)
  const workspaceId = num(deck.workspace_id)
  const jobId = num(job.id)
  const prefix = jobPrefix(deckId, jobId)
  const digest = await finalDigest(prefix, cursor)
  const style = jsonValue<DeckStyle>(deck.style, defaultStyle())
  const density = DENSITY_PAGE_RANGES[style.density] ? style.density : 'standard'
  const range = DENSITY_PAGE_RANGES[density]
  const styleHint = [
    style.preset ? `版式 ${style.preset}` : '',
    style.content.length ? `内容偏好：${style.content.join('、')}` : '',
    style.custom_prompt,
  ].filter(Boolean).join('；')

  const plan = await chatJson(
    PLAN_SYSTEM,
    planUser(digest, styleHint, `${range[0]}–${range[1]} 页`),
    { temperature: 0.3 },
    validatePlan,
  )

  const sections = sectionMap(await selectRows<Row>(
    'material_sections',
    'id,material_id,heading,content',
    [['workspace_id', workspaceId]],
  ))
  const chapters = normalizePlan(plan, new Set(sections.keys()))
  if (chapters.length === 0) throw new HttpError(500, '模型未给出任何章节，请稍后重试')

  const oldPages = await pagesForDeck(deckId)
  const oldKeys = oldPages
    .flatMap((page) => [page.bundle_key, page.thumbnail_key])
    .filter((key): key is string => typeof key === 'string' && key.length > 0)
  await deleteWhere('page_chat_messages', [['deck_id', deckId]])
  await deleteWhere('knowledge_points', [['deck_id', deckId]])
  await deleteWhere('deck_pages', [['deck_id', deckId]])
  await removeObjects(oldKeys)

  const chapterCursors: ChapterCursor[] = []
  let kpOrdinal = 0
  for (const chapter of chapters) {
    const kpIds: number[] = []
    for (const kp of chapter.knowledge_points) {
      const kpId = newId()
      await insertRow('knowledge_points', {
        id: kpId,
        deck_id: deckId,
        parent_id: null,
        ordinal: kpOrdinal,
        title: kp.title,
        summary: kp.summary,
        importance: kp.importance,
        difficulty: kp.difficulty,
        objectives: [],
        key_points: kp.key_points,
        formulas: [],
        misconceptions: kp.misconceptions,
        source_refs: sourceRefsFor(kp.section_ids, sections),
        interaction_idea: kp.interaction_idea,
      })
      kpIds.push(kpId)
      kpOrdinal += 1
    }
    chapterCursors.push({ title: chapter.title, kpIds })
  }

  const plannerChapters: PlannerChapter[] = chapters.map((chapter) => ({
    title: chapter.title,
    knowledge_points: chapter.knowledge_points.map((kp): PlannerKnowledgePoint => ({
      title: kp.title,
      summary: kp.summary,
      importance: kp.importance,
      interaction_idea: kp.interaction_idea,
      misconceptions: kp.misconceptions,
      teaching_role_hint: kp.teaching_role_hint,
    })),
  }))
  const plans = planPages(plannerChapters, density)
  const flatKpIds = chapterCursors.flatMap((chapter) => chapter.kpIds)

  const now = new Date().toISOString()
  for (const page of plans) {
    const primaryKpId = flatKpIds[page.primary_kp_index]
    const mergedIds = page.kp_indices.map((index) => flatKpIds[index]).filter((id) => Number.isInteger(id))
    await insertRow('deck_pages', {
      id: newId(),
      deck_id: deckId,
      knowledge_point_ids: mergedIds,
      primary_knowledge_point_id: primaryKpId ?? null,
      ordinal: page.ordinal,
      title: page.title.slice(0, 255),
      kind: page.kind,
      status: 'planned',
      current_version: 0,
      bundle_key: null,
      thumbnail_key: null,
      manifest: { role: page.role },
      validation: {},
      build_attempts: 0,
      builder_build_id: null,
      created_at: now,
      updated_at: now,
    })
  }

  cursor.chapters = chapterCursors
  cursor.chapterDone = 0
  cursor.totalPages = plans.length
  cursor.phase = 'detail'
  await writeText(`${prefix}/outline.json`, JSON.stringify({ density, chapters: plannerChapters }, null, 2))
  await updateWhere('deck_build_jobs', { total_pages: plans.length }, [['id', jobId]])
  await updateWhere('review_decks', {
    outline: {
      chapters: chapters.map((chapter) => ({ title: chapter.title, knowledge_point_count: chapter.knowledge_points.length })),
      density,
      generated_at: now,
    },
    status: 'building',
    updated_at: now,
  }, [['id', deckId]])
  await saveCursor(jobId, cursor, `大纲完成：${plans.length} 页，正在补全知识点…`)
}

async function detailChapter(
  job: Row,
  cursor: DeckCursor,
  deck: Row,
  chapter: ChapterCursor,
): Promise<void> {
  const deckId = num(deck.id)
  const jobId = num(job.id)
  const prefix = jobPrefix(deckId, jobId)
  const digest = await finalDigest(prefix, cursor)
  const allKps = await selectRows<Row>('knowledge_points', KP_COLUMNS, [['deck_id', deckId]], { order: 'ordinal' })
  const byId = new Map(allKps.map((row) => [num(row.id), row]))
  const points = chapter.kpIds.map((id) => {
    const row = byId.get(id)
    return { id, title: str(row?.title), summary: str(row?.summary) }
  })
  const result = await chatJson(
    KP_DETAIL_SYSTEM,
    kpDetailUser(chapter.title, points, digest),
    { temperature: 0.3 },
    validateKpDetail,
  ) as { knowledge_points: Array<Record<string, unknown>> }
  const detailById = new Map(result.knowledge_points.map((item) => [num(item.id), item]))
  const sections = sectionMap(await selectRows<Row>(
    'material_sections',
    'id,material_id,heading,content',
    [['workspace_id', num(deck.workspace_id)]],
  ))

  for (const id of chapter.kpIds) {
    const detail = detailById.get(id)
    if (!detail) continue
    const refs = Array.isArray(detail.source_refs)
      ? (detail.source_refs as Array<Record<string, unknown>>)
        .map((ref) => num(ref.section_id))
        .filter((sectionId) => sections.has(sectionId))
      : []
    const values: Row = {
      objectives: Array.isArray(detail.objectives)
        ? (detail.objectives as unknown[]).map((item) => String(item).trim()).filter(Boolean).slice(0, 3)
        : [],
      key_points: Array.isArray(detail.key_points)
        ? (detail.key_points as unknown[]).map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
        : [],
      formulas: Array.isArray(detail.formulas)
        ? (detail.formulas as unknown[]).map((item) => String(item).trim()).filter(Boolean).slice(0, 4)
        : [],
      misconceptions: Array.isArray(detail.misconceptions)
        ? (detail.misconceptions as unknown[]).map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
        : [],
    }
    if (refs.length > 0) values.source_refs = sourceRefsFor(refs, sections)
    if (typeof detail.interaction_idea === 'string' && detail.interaction_idea.trim()) {
      values.interaction_idea = detail.interaction_idea.trim().slice(0, 2000)
    }
    await updateWhere('knowledge_points', values, [['id', id]])
  }
}

function excerptSections(kps: Row[], sections: Map<number, Row>, budget = MAX_SOURCE_EXCERPTS): string {
  const parts: string[] = []
  let used = 0
  const seen = new Set<number>()
  for (const kp of kps) {
    const refs = jsonValue<Array<Record<string, unknown>>>(kp.source_refs, [])
    for (const ref of refs) {
      const sectionId = num(ref.section_id)
      if (seen.has(sectionId)) continue
      seen.add(sectionId)
      const section = sections.get(sectionId)
      if (!section) continue
      const heading = str(section.heading).trim()
      const content = str(section.content).replace(/\r\n/g, '\n').trim()
      const text = `### §${sectionId}${heading ? ` ${heading}` : ''}\n${content.slice(0, MAX_SECTION_CHARS)}`
      if (used + text.length > budget) return parts.join('\n\n')
      parts.push(text)
      used += text.length
    }
  }
  return parts.join('\n\n')
}

function pageRules(role: TeachingRole): string {
  if (role === 'worked_example') {
    return 'blocks 3–5 个，正文 400–700 字；必须包含一个 example 块（3–5 个步骤，含答案与易错点）；check 1 题。'
  }
  if (role === 'practice') {
    return 'blocks 2–3 个，正文不超过 300 字；check 2 题，每题选项简短、附解析；不要提供 figure，整页为单屏。'
  }
  if (role === 'summary') {
    return 'blocks 2–3 个，正文不超过 220 字；必须提供 summary.key_points（2–3 条，每条不超过 30 字）；check 1 题；不要提供 figure，整页为单屏。'
  }
  if (role === 'compare') {
    return 'blocks 2–3 个，正文 350–650 字；必须包含一个 compare 块（2–3 列，每列 2–4 条）并给出结论；check 1 题。'
  }
  if (role === 'mechanism') {
    return 'blocks 4–6 个，正文 400–700 字；必须包含一个 example 块和顶层 figure（states 2–3 个）；check 1 题。'
  }
  return 'blocks 3–5 个，正文 350–650 字；必须有一个 callout 块（kind 为 key 或 definition）给出核心结论；check 1 题。'
}

function pageRoleFromTitle(page: Row, fallback: TeachingRole): TeachingRole {
  const manifest = jsonValue<Record<string, unknown>>(page.manifest, {})
  const saved = str(manifest.role) as TeachingRole
  if (['concept', 'mechanism', 'worked_example', 'practice', 'compare', 'summary'].includes(saved)) {
    return saved
  }
  const title = str(page.title)
  if (title.endsWith('（例题）')) return 'worked_example'
  if (title.endsWith('（练习）')) return 'practice'
  if (title.endsWith('（小结）')) return 'summary'
  if (title.endsWith('（对比）')) return 'compare'
  if (title.endsWith('（机制）')) return 'mechanism'
  return fallback
}

function buildPageBrief(
  deck: Row,
  page: Row,
  role: TeachingRole,
  kps: Row[],
  sections: Map<number, Row>,
  feedback: string,
): string {
  const primary = kps[0]
  const items = [
    `复习页标题：${str(deck.title)}`,
    `页面标题：${str(page.title)}`,
    `页面角色：${role}（${pageRules(role)}）`,
    primary ? `知识点：${str(primary.title)}` : '',
    primary ? `说明：${str(primary.summary)}` : '',
    ...kps.flatMap((kp) => {
      const objectives = jsonValue<string[]>(kp.objectives, [])
      const keyPoints = jsonValue<string[]>(kp.key_points, [])
      const formulas = jsonValue<string[]>(kp.formulas, [])
      const misconceptions = jsonValue<string[]>(kp.misconceptions, [])
      return [
        `## ${str(kp.title)}`,
        objectives.length ? `学习目标：${objectives.join('；')}` : '',
        keyPoints.length ? `关键点：${keyPoints.join('；')}` : '',
        formulas.length ? `公式：${formulas.join('；')}` : '',
        misconceptions.length ? `易错点：${misconceptions.join('；')}` : '',
      ].filter(Boolean)
    }),
    feedback ? `本次重做要求：${feedback}` : '',
  ].filter(Boolean)

  const excerpt = excerptSections(kps, sections)
  if (excerpt) items.push(`资料节选（§编号可直接用于 source_refs）：\n${excerpt}`)
  return items.join('\n\n').slice(0, 12_000)
}

function validatePageContentShape(value: unknown): string | null {
  const record = value as Record<string, unknown>
  if (!record || typeof record !== 'object') return '页面内容必须是对象'
  if (record.content_version !== '2.0') return 'content_version 必须为 "2.0"'
  if (typeof record.role !== 'string') return 'role 必须是字符串'
  if (typeof record.title !== 'string' || !record.title.trim()) return 'title 必须是非空字符串'
  if (!Array.isArray(record.blocks) || record.blocks.length === 0) return 'blocks 必须是非空数组'
  return null
}

async function buildPageContent(
  job: Row,
  cursor: DeckCursor,
  deck: Row,
  page: Row,
  index: number,
): Promise<void> {
  const deckId = num(deck.id)
  const workspaceId = num(deck.workspace_id)
  const jobId = num(job.id)
  const pageId = num(page.id)
  const prefix = jobPrefix(deckId, jobId)

  await updateWhere('deck_pages', {
    status: 'building',
    updated_at: new Date().toISOString(),
  }, [['id', pageId]])

  const kpIds = jsonValue<number[]>(page.knowledge_point_ids, [])
  const kps: Row[] = []
  for (const kpId of kpIds) {
    const kp = await findRow('knowledge_points', [['id', kpId]], KP_COLUMNS)
    if (kp) kps.push(kp)
  }
  const sections = sectionMap(await selectRows<Row>(
    'material_sections',
    'id,material_id,heading,content',
    [['workspace_id', workspaceId]],
  ))
  const role = pageRoleFromTitle(page, 'concept')
  const brief = buildPageBrief(deck, page, role, kps, sections, str(job.feedback))

  const content = await chatJson(
    PAGE_CONTENT_SYSTEM,
    pageContentUser(brief, role, pageRules(role)),
    { temperature: 0.4 },
    validatePageContentShape,
  )
  await saveBytes(
    pageContentKey(prefix, pageId),
    new TextEncoder().encode(JSON.stringify(content)),
    'application/json; charset=utf-8',
  )

  cursor.currentPageId = pageId
  cursor.attempts = 0
  cursor.phase = 'render'
  await saveCursor(
    jobId,
    cursor,
    cursor.singlePage ? '正在重建页面…' : `正在生成页面 ${index + 1}/${cursor.totalPages}…`,
  )
}

async function abandonPage(
  job: Row,
  cursor: DeckCursor,
  deck: Row,
  page: Row,
  error: unknown,
): Promise<void> {
  const detail = error instanceof HttpError && typeof error.detail === 'string'
    ? error.detail
    : '页面生成失败'
  const now = new Date().toISOString()
  await updateWhere('deck_pages', {
    status: 'failed',
    validation: { status: 'failed', issues: [], issue_count: 0, message: detail },
    updated_at: now,
  }, [['id', num(page.id)]])
  await addEvent(num(job.id), 'page_failed', num(page.id), { message: detail })
  cursor.currentPageId = null
  cursor.attempts = 0
  cursor.pageOrdinal += 1
  cursor.phase = 'page'
  await refreshJobCounters(num(job.id), num(deck.id))
  await saveCursor(num(job.id), cursor, detail)
}

async function renderBuiltPage(job: Row, cursor: DeckCursor, deck: Row): Promise<void> {
  const deckId = num(deck.id)
  const jobId = num(job.id)
  const pageId = cursor.currentPageId
  if (pageId === null) {
    cursor.phase = 'page'
    return
  }
  const page = await findRow<Row>('deck_pages', [['id', pageId]], PAGE_COLUMNS)
  if (!page) {
    cursor.currentPageId = null
    cursor.phase = 'page'
    return
  }
  const prefix = jobPrefix(deckId, jobId)
  const key = pageContentKey(prefix, pageId)
  let raw = ''
  let content: unknown = null
  try {
    raw = await readText(key)
    content = JSON.parse(raw)
  } catch {
    content = null
  }

  let issues: ContentIssue[] = content === null
    ? [{ severity: 'error', code: 'CONTENT_PARSE', path: '', message: '页面 JSON 无法解析' }]
    : validateContent(content)
  const now = new Date().toISOString()

  if (hasErrors(issues) && cursor.attempts < MAX_REPAIR_ATTEMPTS && content !== null) {
    const repaired = await chat(
      [
        { role: 'system', content: PAGE_REPAIR_SYSTEM },
        { role: 'user', content: pageRepairUser(raw.slice(0, 12_000), describeIssues(issues)) },
      ],
      { temperature: 0.2 },
    )
    const start = repaired.indexOf('{')
    const end = repaired.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        const next = JSON.parse(repaired.slice(start, end + 1))
        await saveBytes(key, new TextEncoder().encode(JSON.stringify(next)), 'application/json; charset=utf-8')
        content = next
        issues = validateContent(next)
      } catch {
        // 修复结果不合法，按次数上限处理
      }
    }
    cursor.attempts += 1
    if (hasErrors(issues)) {
      await saveCursor(jobId, cursor, '正在修复页面内容…')
      return
    }
  }

  if (hasErrors(issues) || content === null) {
    const first = issues.find((issue) => issue.severity === 'error')
    const detail = first ? `页面校验未通过：${first.message}` : '页面生成失败'
    await updateWhere('deck_pages', {
      status: 'failed',
      validation: { status: 'failed', issues, issue_count: issues.length },
      build_attempts: cursor.attempts,
      updated_at: now,
    }, [['id', pageId]])
    await addEvent(jobId, 'page_failed', pageId, { message: detail })
    cursor.currentPageId = null
    cursor.attempts = 0
    cursor.pageOrdinal += 1
    cursor.phase = cursor.singlePage ? 'done' : 'page'
    await refreshJobCounters(jobId, deckId)
    await saveCursor(jobId, cursor, detail)
    return
  }

  const style = jsonValue<DeckStyle>(deck.style, defaultStyle())
  const theme = (PAGE_THEMES.includes(style.page_theme as PageTheme) ? style.page_theme : 'workbench') as PageTheme
  const kpIds = jsonValue<number[]>(page.knowledge_point_ids, [])
  const kps: Row[] = []
  for (const kpId of kpIds) {
    const kp = await findRow('knowledge_points', [['id', kpId]], KP_COLUMNS)
    if (kp) kps.push(kp)
  }
  const primary = kps[0]
  const refs = kps.flatMap((kp) => jsonValue<Array<Record<string, unknown>>>(kp.source_refs, []))
  try {
    const rendered = renderPage(content, {
      pageId: `page_${pageId}`,
      theme,
      knowledgePointIds: kpIds.map((id) => `kp_${id}`),
      importance: primary ? str(primary.importance, 'normal') : 'normal',
      estimatedMinutes: ROLE_MINUTES[pageRoleFromTitle(page, 'concept')] ?? 8,
      sourceRefs: refs,
      deckTitle: str(deck.title),
    })
    const bundle = {
      schema_version: '1.1',
      runtime_version: '1.1.0',
      manifest: rendered.manifest,
      html: rendered.html,
      css: rendered.css,
      js: rendered.js,
    }
    const bytes = new TextEncoder().encode(JSON.stringify(bundle))
    if (bytes.byteLength > MAX_BUNDLE_BYTES) {
      throw new HttpError(500, '页面体积超过 2 MiB，请减少内容后重试')
    }
    const version = num(page.current_version) + 1
    const bundleKey = `decks/${deckId}/pages/${pageId}/v${version}.json`
    await saveBytes(bundleKey, bytes, 'application/json; charset=utf-8')
    await updateWhere('deck_pages', {
      status: 'ready',
      current_version: version,
      bundle_key: bundleKey,
      manifest: rendered.manifest,
      validation: {
        status: 'ok',
        issues: rendered.issues,
        issue_count: rendered.issues.length,
      },
      build_attempts: cursor.attempts,
      builder_build_id: String(jobId),
      updated_at: now,
    }, [['id', pageId]])
    await addEvent(jobId, 'page_ready', pageId, {
      version,
      title: rendered.manifest.title ?? str(page.title),
    })
  } catch (error) {
    const detail = error instanceof HttpError ? String(error.detail) : '页面渲染失败'
    await updateWhere('deck_pages', {
      status: 'failed',
      validation: { status: 'failed', issues, issue_count: issues.length, message: detail },
      build_attempts: cursor.attempts,
      updated_at: now,
    }, [['id', pageId]])
    await addEvent(jobId, 'page_failed', pageId, { message: detail })
  }

  cursor.currentPageId = null
  cursor.attempts = 0
  cursor.pageOrdinal += 1
  cursor.phase = cursor.singlePage ? 'done' : 'page'
  await refreshJobCounters(jobId, deckId)
  await saveCursor(jobId, cursor, cursor.singlePage ? '页面重做完成' : '页面已保存，继续构建…')
}

async function advanceDeckStep(job: Row): Promise<void> {
  const jobId = num(job.id)
  const deckId = num(job.deck_id)
  const deck = await findRow<Row>('review_decks', [['id', deckId]], DECK_COLUMNS)
  if (!deck) throw new HttpError(404, '复习页不存在')
  const prefix = jobPrefix(deckId, jobId)
  const cursor = readCursor(job) ?? emptyCursor()
  let chunks: CorpusChunk[] | null = null

  if (cursor.chunkTotal === 0 && cursor.phase !== 'page' && cursor.phase !== 'render') {
    chunks = await loadChunks(num(deck.workspace_id))
    cursor.chunkTotal = chunks.length
    cursor.reduceTotal = chunks.length
    await saveCursor(jobId, cursor, `正在通读资料（0/${chunks.length} 块）`)
  }

  if (cursor.phase === 'index') {
    if (cursor.mapDone >= cursor.chunkTotal) {
      cursor.phase = cursor.reduceTotal <= REDUCE_FAN_IN ? 'plan' : 'reduce'
      cursor.reduceLevel = 0
      cursor.reduceDone = 0
      await saveCursor(jobId, cursor, cursor.phase === 'plan' ? '资料要点已就绪，正在规划…' : '正在合并要点…')
      return
    }
    chunks ??= await loadChunks(num(deck.workspace_id))
    const chunk = chunks[cursor.mapDone]
    if (!chunk) throw new HttpError(500, '资料分块读取失败，请重新发起构建')
    const digest = await chat([
      { role: 'system', content: CHUNK_DIGEST_SYSTEM },
      { role: 'user', content: chunkDigestUser(chunk.filename, chunkSourceLabel(chunk), chunk.text) },
    ], { temperature: 0.2 })
    await writeText(digestKey(prefix, 0, cursor.mapDone), digest)
    cursor.mapDone += 1
    await saveCursor(
      jobId,
      cursor,
      cursor.mapDone >= cursor.chunkTotal ? '资料通读完成，正在合并要点…' : `正在通读资料（${cursor.mapDone}/${cursor.chunkTotal} 块）`,
    )
    return
  }

  if (cursor.phase === 'reduce') {
    const groups = Math.ceil(cursor.reduceTotal / REDUCE_FAN_IN)
    if (cursor.reduceDone >= groups) {
      cursor.reduceLevel += 1
      cursor.reduceTotal = groups
      cursor.reduceDone = 0
      if (cursor.reduceTotal <= REDUCE_FAN_IN) {
        cursor.phase = 'plan'
        await saveCursor(jobId, cursor, '资料要点已就绪，正在规划…')
      } else {
        await saveCursor(jobId, cursor, `正在合并要点（第 ${cursor.reduceLevel + 1} 层）`)
      }
      return
    }
    const start = cursor.reduceDone * REDUCE_FAN_IN
    const parts: string[] = []
    for (let index = start; index < Math.min(start + REDUCE_FAN_IN, cursor.reduceTotal); index += 1) {
      parts.push(await readText(digestKey(prefix, cursor.reduceLevel, index)))
    }
    const merged = await chat([
      { role: 'system', content: REDUCE_SYSTEM },
      { role: 'user', content: reduceUser(parts) },
    ], { temperature: 0.2 })
    await writeText(digestKey(prefix, cursor.reduceLevel + 1, cursor.reduceDone), merged)
    cursor.reduceDone += 1
    await saveCursor(jobId, cursor, `正在合并要点（第 ${cursor.reduceLevel + 1} 层 ${cursor.reduceDone}/${groups}）`)
    return
  }

  if (cursor.phase === 'plan') {
    await planDeck(job, cursor, deck)
    return
  }

  if (cursor.phase === 'detail') {
    const chapter = cursor.chapters[cursor.chapterDone]
    if (!chapter) {
      cursor.phase = 'page'
      cursor.pageOrdinal = 0
      await saveCursor(jobId, cursor, `知识点已补全，开始生成 ${cursor.totalPages} 页…`)
      return
    }
    await detailChapter(job, cursor, deck, chapter)
    cursor.chapterDone += 1
    const stage = cursor.chapterDone >= cursor.chapters.length
      ? `知识点已补全，开始生成 ${cursor.totalPages} 页…`
      : `正在补全知识点（${cursor.chapterDone}/${cursor.chapters.length} 章）`
    await saveCursor(jobId, cursor, stage)
    return
  }

  if (cursor.phase === 'page') {
    if (cursor.singlePage) {
      const pageId = cursor.currentPageId
      if (pageId === null) {
        cursor.phase = 'done'
        await saveCursor(jobId, cursor, '页面重做完成')
        return
      }
      const page = await findRow<Row>('deck_pages', [['id', pageId]], PAGE_COLUMNS)
      if (!page) throw new HttpError(404, '页面不存在')
      await buildPageContent(job, cursor, deck, page, 0)
      return
    }
    if (cursor.pageOrdinal >= cursor.totalPages) {
      cursor.phase = 'done'
      await saveCursor(jobId, cursor, '页面已全部生成，正在收尾…')
      return
    }
    const pages = await selectRows<Row>('deck_pages', PAGE_COLUMNS, [
      ['deck_id', deckId],
      ['ordinal', cursor.pageOrdinal],
    ], { limit: 1 })
    const page = pages[0]
    if (!page) {
      cursor.pageOrdinal += 1
      await saveCursor(jobId, cursor, '正在准备下一页…')
      return
    }
    if (str(page.status) === 'ready') {
      cursor.pageOrdinal += 1
      await saveCursor(jobId, cursor, '页面已存在，继续下一页…')
      return
    }
    try {
      await buildPageContent(job, cursor, deck, page, cursor.pageOrdinal)
    } catch (error) {
      if (error instanceof HttpError && (error.status === 429 || error.status === 502)) throw error
      await abandonPage(job, cursor, deck, page, error)
    }
    return
  }

  if (cursor.phase === 'render') {
    await renderBuiltPage(job, cursor, deck)
    return
  }

  if (cursor.phase === 'done') {
    const now = new Date().toISOString()
    const counts = await pageCounts(deckId)
    const status = counts.total > 0 && counts.ready === counts.total
      ? 'ready'
      : counts.ready > 0 ? 'partial' : 'failed'
    const signature = await workspaceSourceSignature(num(deck.workspace_id))
    await updateWhere('deck_build_jobs', {
      status: 'done',
      stage: status === 'ready' ? '构建完成' : '构建完成（部分页面失败）',
      progress: counts.ready + counts.failed,
      total_pages: counts.total,
      ready_pages: counts.ready,
      failed_pages: counts.failed,
      cursor,
      finished_at: now,
      lease_key: null,
      lease_until: null,
    }, [['id', jobId]])
    await updateWhere('review_decks', {
      status,
      source_signature: signature,
      updated_at: now,
    }, [['id', deckId]])
    await addEvent(jobId, 'job_done', null, {
      status,
      ready_pages: counts.ready,
      failed_pages: counts.failed,
      total_pages: counts.total,
    })
  }
}

async function advanceDeckJob(request: Request, jobId: number): Promise<Response> {
  const user = await requireUser(request)
  const job = await ownedDeckJob(jobId, user)
  if (terminal(str(job.status))) return json(deckJobOut(job))

  const leaseUntil = job.lease_until ? Date.parse(str(job.lease_until)) : 0
  if (job.lease_key !== null && Number.isFinite(leaseUntil) && leaseUntil > Date.now()) {
    return json(deckJobOut(job))
  }

  const now = new Date().toISOString()
  await updateWhere('deck_build_jobs', {
    status: 'running',
    lease_key: jobId,
    lease_until: new Date(Date.now() + LEASE_MS).toISOString(),
    started_at: str(job.started_at) || now,
  }, [['id', jobId]])

  try {
    await advanceDeckStep(job)
  } catch (error) {
    if (error instanceof HttpError && (error.status === 429 || error.status === 502)) {
      await updateWhere('deck_build_jobs', { lease_key: null, lease_until: null }, [['id', jobId]])
      throw error
    }
    const detail = error instanceof HttpError && typeof error.detail === 'string'
      ? error.detail
      : '构建失败，请稍后重试'
    await failJob(jobId, num(job.deck_id), detail)
  }

  const updated = await findRow('deck_build_jobs', [['id', jobId]], JOB_COLUMNS)
  if (!updated) return json(deckJobOut(job))
  if (!terminal(str(updated.status)) && Number(updated.lease_key) === jobId) {
    await updateWhere('deck_build_jobs', { lease_key: null, lease_until: null }, [['id', jobId]])
    updated.lease_key = null
    updated.lease_until = null
  }
  return json(deckJobOut(updated))
}

/* ------------------------------ 页面问答 ------------------------------ */

async function loadSectionContext(deck: Row): Promise<{
  sections: Map<number, Row>
  materials: Map<number, string>
}> {
  const workspaceId = num(deck.workspace_id)
  const sectionRows = await selectRows<Row>(
    'material_sections',
    'id,material_id,heading,content',
    [['workspace_id', workspaceId]],
  )
  const materialRows = await selectRows<Row>('materials', 'id,filename', [['workspace_id', workspaceId]])
  return {
    sections: sectionMap(sectionRows),
    materials: new Map(materialRows.map((row) => [num(row.id), str(row.filename)])),
  }
}

function messageRefs(
  kps: Row[],
  sections: Map<number, Row>,
  materials: Map<number, string>,
): Array<Record<string, unknown>> {
  const refs: Array<Record<string, unknown>> = []
  const seen = new Set<number>()
  for (const kp of kps) {
    for (const ref of jsonValue<Array<Record<string, unknown>>>(kp.source_refs, [])) {
      const sectionId = num(ref.section_id)
      if (!sectionId || seen.has(sectionId)) continue
      seen.add(sectionId)
      const section = sections.get(sectionId)
      if (!section) {
        refs.push({
          material_id: null,
          material_name: '未知资料',
          section_id: sectionId,
          heading: str(ref.heading),
          quote: str(ref.quote),
          unverified: true,
        })
      } else {
        const materialId = num(section.material_id)
        refs.push({
          material_id: materialId,
          material_name: materials.get(materialId) ?? '未知资料',
          section_id: sectionId,
          heading: str(section.heading, str(ref.heading)),
          quote: str(section.content).replace(/\s+/g, ' ').trim().slice(0, 200),
          unverified: false,
        })
      }
      if (refs.length >= 5) return refs
    }
  }
  return refs
}

async function listPageMessages(request: Request, deckId: number, pageId: number): Promise<Response> {
  const user = await requireUser(request)
  const deck = await getOwnedDeck(deckId, user)
  await ownedPage(deck, pageId)
  const rows = await selectRows<Row>('page_chat_messages',
    'id,deck_id,page_id,role,status,content,quote,context_refs,created_at',
    [['deck_id', deckId], ['page_id', pageId]],
    { order: 'id' })
  return json(rows.slice(-30).map(pageMessageOut))
}

async function createPageMessage(request: Request, deckId: number, pageId: number): Promise<Response> {
  const user = await requireUser(request)
  const deck = await getOwnedDeck(deckId, user)
  const page = await ownedPage(deck, pageId)
  if (!config.llmConfigured) {
    throw new HttpError(400, '未配置 LLM 服务（缺少 LLM_API_KEY），无法使用页面助手')
  }
  const body = await readJson(request)
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) throw new HttpError(400, '问题不能为空')
  if (content.length > 2000) throw new HttpError(400, '问题不能超过 2000 字')
  const quote = typeof body.quote === 'string' ? body.quote.trim().slice(0, 300) : ''
  const blockText = typeof body.block_text === 'string' ? body.block_text.trim().slice(0, 1200) : ''

  const kpIds = jsonValue<number[]>(page.knowledge_point_ids, [])
  const kps: Row[] = []
  for (const kpId of kpIds) {
    const kp = await findRow('knowledge_points', [['id', kpId]], KP_COLUMNS)
    if (kp) kps.push(kp)
  }
  const manifest = jsonValue<Record<string, unknown>>(page.manifest, {})
  const assistant = jsonValue<Record<string, unknown>>(manifest.assistant, {})
  const keyFacts = jsonValue<string[]>(assistant.key_facts, [])
  const context = [
    `页面标题：${str(manifest.title, str(page.title))}`,
    str(manifest.subtitle) ? `页面导语：${str(manifest.subtitle)}` : '',
    keyFacts.length ? `页面要点：${keyFacts.join('；')}` : '',
    ...kps.map((kp) => [
      `知识点：${str(kp.title)}`,
      str(kp.summary) ? `说明：${str(kp.summary)}` : '',
      jsonValue<string[]>(kp.key_points, []).length
        ? `关键点：${jsonValue<string[]>(kp.key_points, []).join('；')}`
        : '',
      jsonValue<string[]>(kp.formulas, []).length
        ? `公式：${jsonValue<string[]>(kp.formulas, []).join('；')}`
        : '',
    ].filter(Boolean).join('\n')),
  ].filter(Boolean).join('\n\n')

  const answer = await chat([
    { role: 'system', content: PAGE_CHAT_SYSTEM },
    { role: 'user', content: pageChatUser(context, content, quote, blockText) },
  ], { temperature: 0.4, maxTokens: 900 })

  const { sections, materials } = await loadSectionContext(deck)
  const refs = messageRefs(kps, sections, materials)
  const now = new Date().toISOString()
  const messageId = newId()
  await insertRow('page_chat_messages', {
    id: newId(),
    user_id: user.id,
    deck_id: deckId,
    page_id: pageId,
    role: 'user',
    status: 'done',
    content,
    quote: quote || null,
    context_refs: [],
    created_at: now,
  })
  await insertRow('page_chat_messages', {
    id: messageId,
    user_id: user.id,
    deck_id: deckId,
    page_id: pageId,
    role: 'assistant',
    status: 'done',
    content: answer,
    quote: null,
    context_refs: refs,
    created_at: new Date().toISOString(),
  })
  return json({ message_id: messageId, content: answer, refs })
}

/* ------------------------------ 路由 ------------------------------ */

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
    handler: ({ request, params }) => buildDeck(request, pathId(params.id)),
  },
  {
    method: 'POST',
    path: '/decks/:id/cancel',
    handler: ({ request, params }) => cancelDeckBuild(request, pathId(params.id)),
  },
  {
    method: 'GET',
    path: '/deck-jobs/:id',
    handler: ({ request, params }) => getDeckJob(request, pathId(params.id)),
  },
  {
    method: 'POST',
    path: '/deck-jobs/:id/advance',
    handler: ({ request, params }) => advanceDeckJob(request, pathId(params.id)),
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
    handler: ({ request, params }) => rebuildPage(request, pathId(params.id), pathId(params.page)),
  },
  {
    method: 'PATCH',
    path: '/decks/:id/progress',
    handler: ({ request, params }) => updateProgress(request, pathId(params.id)),
  },
  {
    method: 'GET',
    path: '/decks/:id/pages/:page/messages',
    handler: ({ request, params }) => listPageMessages(request, pathId(params.id), pathId(params.page)),
  },
  {
    method: 'POST',
    path: '/decks/:id/pages/:page/messages',
    handler: ({ request, params }) => createPageMessage(request, pathId(params.id), pathId(params.page)),
  },
]
