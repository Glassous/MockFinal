import { config } from '../lib/config.ts'
import { chunkCorpus, loadCorpus, chunkSourceLabel, type CorpusChunk } from '../lib/corpus.ts'
import { requireUser } from '../lib/current-user.ts'
import type { CurrentUser } from '../lib/current-user.ts'
import {
  findRow,
  insertRow,
  isUniqueViolation,
  num,
  selectRows,
  str,
  updateWhere,
  type Row,
} from '../lib/db.ts'
import { HttpError } from '../lib/errors.ts'
import { json } from '../lib/http.ts'
import { newId } from '../lib/ids.ts'
import { chatJson } from '../lib/json-chat.ts'
import { chat } from '../lib/llm.ts'
import {
  ARTIFACT_TITLES,
  CHUNK_DIGEST_SYSTEM,
  EXAM_PARTS,
  EXAM_PART_SYSTEM,
  OUTLINE_SYSTEM,
  REDUCE_SYSTEM,
  REVIEW_CHAPTER_SYSTEM,
  STAGE_DONE,
  STAGE_EXAMINING,
  STAGE_OUTLINING,
  STAGE_QUEUED,
  STAGE_REDUCING,
  STAGE_REVIEWING,
  STAGE_SAVING,
  chunkDigestUser,
  examPartUser,
  outlineUser,
  reduceUser,
  reviewChapterUser,
  stageExamining,
  stageMapping,
  stageReducing,
  stageReviewing,
} from '../lib/prompts.ts'
import { jobOut } from '../lib/serializers.ts'
import { readBytes, saveBytes } from '../lib/storage.ts'
import type { Route } from '../router.ts'
import { getOwnedWorkspace } from './workspaces.ts'

const JOB_COLUMNS = 'id,workspace_id,status,stage,error,cursor,lease_key,lease_until,finished_at,created_at'
const LEASE_MS = 120_000
const REDUCE_FAN_IN = 4
const READ_LIMIT = 4 * 1024 * 1024

interface ChapterPlan {
  title: string
  points: string[]
  summary: string
}

interface JobCursor {
  v: 2
  phase: 'map' | 'reduce' | 'outline' | 'review' | 'exam' | 'assemble' | 'done'
  materialIds: number[]
  chunkTotal: number
  mapDone: number
  reduceLevel: number
  reduceTotal: number
  reduceDone: number
  chapters: ChapterPlan[]
  chapterDone: number
  examDone: number
}

function emptyCursor(): JobCursor {
  return {
    v: 2,
    phase: 'map',
    materialIds: [],
    chunkTotal: 0,
    mapDone: 0,
    reduceLevel: 0,
    reduceTotal: 0,
    reduceDone: 0,
    chapters: [],
    chapterDone: 0,
    examDone: 0,
  }
}

function readCursor(job: Row): JobCursor | null {
  const raw = job.cursor
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const cursor = raw as Partial<JobCursor>
  if (cursor.v !== 2 || typeof cursor.phase !== 'string') return null
  return {
    ...emptyCursor(),
    ...cursor,
    materialIds: Array.isArray(cursor.materialIds) ? cursor.materialIds.map(Number) : [],
    chapters: Array.isArray(cursor.chapters) ? cursor.chapters : [],
  }
}

function terminal(status: string): boolean {
  return status === 'done' || status === 'failed'
}

async function ownedJob(jobId: number, user: CurrentUser): Promise<Row> {
  const job = await findRow('generation_jobs', [['id', jobId]], JOB_COLUMNS)
  if (!job) throw new HttpError(404, '任务不存在')
  const workspace = await findRow('workspaces', [['id', num(job.workspace_id)]], 'id,user_id')
  if (!workspace || num(workspace.user_id) !== user.id) throw new HttpError(404, '任务不存在')
  return job
}

async function generate(request: Request, workspaceId: number): Promise<Response> {
  const user = await requireUser(request)
  await getOwnedWorkspace(workspaceId, user)
  if (!config.llmConfigured) {
    throw new HttpError(400, '未配置 LLM 服务（缺少 LLM_API_KEY），无法生成复习资料')
  }
  const indexed = await selectRows('materials', 'id', [
    ['workspace_id', workspaceId],
    ['status', 'indexed'],
  ], { limit: 1 })
  if (indexed.length === 0) {
    throw new HttpError(400, '当前工作区没有已就绪的资料，请先上传资料并等待解析完成')
  }
  for (const status of ['pending', 'running']) {
    const active = await selectRows('generation_jobs', 'id', [
      ['workspace_id', workspaceId],
      ['status', status],
    ], { limit: 1 })
    if (active.length > 0) {
      throw new HttpError(409, '当前工作区已有正在进行的生成任务，请等待其完成')
    }
  }

  const id = newId()
  try {
    await insertRow('generation_jobs', {
      id,
      workspace_id: workspaceId,
      status: 'pending',
      stage: STAGE_QUEUED,
      error: null,
      cursor: emptyCursor(),
      lease_key: null,
      lease_until: null,
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, '当前工作区已有正在进行的生成任务，请等待其完成')
    }
    throw error
  }
  return json({ job_id: id })
}

async function getJob(request: Request, jobId: number): Promise<Response> {
  const user = await requireUser(request)
  const job = await ownedJob(jobId, user)
  return json(jobOut(job))
}

async function releaseLease(jobId: number): Promise<void> {
  await updateWhere('generation_jobs', { lease_key: null, lease_until: null }, [['id', jobId]])
}

async function saveCursor(jobId: number, cursor: JobCursor, stage: string): Promise<void> {
  await updateWhere('generation_jobs', { cursor, stage, status: 'running' }, [['id', jobId]])
}

async function failJob(jobId: number, detail: string): Promise<void> {
  await updateWhere(
    'generation_jobs',
    {
      status: 'failed',
      error: detail.slice(0, 2000),
      finished_at: new Date().toISOString(),
      lease_key: null,
      lease_until: null,
    },
    [['id', jobId]],
  )
}

function jobPrefix(userId: number, jobId: number): string {
  return `jobs/${userId}/${jobId}`
}

function digestKey(prefix: string, level: number, index: number): string {
  return `${prefix}/digest/L${level}-${index}.md`
}

function reviewKey(prefix: string, index: number): string {
  return `${prefix}/review/${index}.md`
}

function examKey(prefix: string, index: number): string {
  return `${prefix}/exam/${index}.md`
}

async function readText(key: string): Promise<string> {
  const bytes = await readBytes(key, READ_LIMIT)
  return new TextDecoder('utf-8').decode(bytes)
}

async function writeText(key: string, content: string): Promise<void> {
  await saveBytes(key, new TextEncoder().encode(content), 'text/markdown; charset=utf-8')
}

async function loadChunks(workspaceId: number): Promise<CorpusChunk[]> {
  const corpus = await loadCorpus(workspaceId)
  const chunks = chunkCorpus(corpus)
  if (chunks.length === 0) throw new HttpError(400, '资料正文为空，无法生成复习资料')
  return chunks
}

async function finalDigest(prefix: string, cursor: JobCursor): Promise<string> {
  const parts: string[] = []
  for (let index = 0; index < cursor.reduceTotal; index += 1) {
    parts.push(await readText(digestKey(prefix, cursor.reduceLevel, index)))
  }
  return parts.join('\n\n---\n\n')
}

function validateOutline(value: unknown): string | null {
  const record = value as Record<string, unknown>
  const chapters = record.chapters
  if (!Array.isArray(chapters) || chapters.length < 4 || chapters.length > 10) {
    return 'chapters 必须是 4–10 章的数组'
  }
  for (const [index, chapter] of chapters.entries()) {
    if (!chapter || typeof chapter !== 'object') return `第 ${index + 1} 章不是对象`
    const item = chapter as Record<string, unknown>
    if (typeof item.title !== 'string' || !item.title.trim()) return `第 ${index + 1} 章缺少标题`
    if (!Array.isArray(item.points) || item.points.length < 2 || item.points.length > 6) {
      return `第 ${index + 1} 章 points 必须为 2–6 条`
    }
  }
  return null
}

function outlineChapters(value: unknown): ChapterPlan[] {
  const chapters = (value as { chapters: Array<Record<string, unknown>> }).chapters
  return chapters.map((chapter) => ({
    title: String(chapter.title).trim(),
    points: (chapter.points as unknown[]).map((point) => String(point).trim()),
    summary: typeof chapter.summary === 'string' ? chapter.summary.trim() : '',
  }))
}

function withHeading(text: string, title: string): string {
  const body = text.trim()
  return body.startsWith('##') ? body : `## ${title}\n\n${body}`
}

function reviewMarkdown(cursor: JobCursor, parts: string[], materialCount: number): string {
  const header = [
    '# 期末终极复习',
    '',
    `> 依据 ${materialCount} 份课程资料全文分块整理，共 ${cursor.chapters.length} 章。`,
    '',
  ].join('\n')
  return `${header}\n${parts.join('\n\n---\n\n')}\n`
}

function examMarkdown(parts: string[]): string {
  return `# 期末模拟考试\n\n> 本试卷依据课程资料自动生成，公式使用 KaTeX 语法。\n\n${parts.join('\n\n')}\n`
}

async function persistArtifacts(
  job: Row,
  userId: number,
  workspaceId: number,
  review: string,
  exam: string,
): Promise<void> {
  const jobId = num(job.id)
  const contents: Record<string, string> = { review, exam }
  for (const kind of ['review', 'exam']) {
    const content = contents[kind]
    if (!content.trim()) throw new HttpError(400, '生成结果为空，请重新发起生成')
    const objectPath = `artifacts/${userId}/${workspaceId}/${jobId}-${kind}.md`
    await saveBytes(objectPath, new TextEncoder().encode(content), 'text/markdown; charset=utf-8')
    try {
      await insertRow('artifacts', {
        id: newId(),
        workspace_id: workspaceId,
        job_id: jobId,
        kind,
        title: ARTIFACT_TITLES[kind],
        storage_key: objectPath,
      }, 'id')
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
    }
  }
}

async function advanceStep(job: Row, userId: number): Promise<void> {
  const jobId = num(job.id)
  const workspaceId = num(job.workspace_id)
  const prefix = jobPrefix(userId, jobId)
  let cursor = readCursor(job)
  let chunks: CorpusChunk[] | null = null

  if (!cursor || cursor.chunkTotal === 0) {
    chunks = await loadChunks(workspaceId)
    cursor = {
      ...emptyCursor(),
      materialIds: [...new Set(chunks.map((chunk) => chunk.materialId))],
      chunkTotal: chunks.length,
      reduceTotal: chunks.length,
    }
    await saveCursor(jobId, cursor, stageMapping(0, chunks.length))
  }

  const active = cursor

  if (active.phase === 'map') {
    if (active.mapDone >= active.chunkTotal) {
      active.phase = active.reduceTotal <= REDUCE_FAN_IN ? 'outline' : 'reduce'
      active.reduceLevel = 0
      active.reduceTotal = active.chunkTotal
      active.reduceDone = 0
      await saveCursor(jobId, active, active.phase === 'outline' ? STAGE_OUTLINING : STAGE_REDUCING)
      return
    }
    chunks ??= await loadChunks(workspaceId)
    const chunk = chunks[active.mapDone]
    if (!chunk) throw new HttpError(500, '资料分块读取失败，请重新发起生成')
    const digest = await chat([
      { role: 'system', content: CHUNK_DIGEST_SYSTEM },
      { role: 'user', content: chunkDigestUser(chunk.filename, chunkSourceLabel(chunk), chunk.text) },
    ], { temperature: 0.2 })
    await writeText(digestKey(prefix, 0, active.mapDone), digest)
    active.mapDone += 1
    const stage = active.mapDone >= active.chunkTotal
      ? STAGE_REDUCING
      : stageMapping(active.mapDone, active.chunkTotal)
    await saveCursor(jobId, active, stage)
    return
  }

  if (active.phase === 'reduce') {
    const groups = Math.ceil(active.reduceTotal / REDUCE_FAN_IN)
    if (active.reduceDone >= groups) {
      active.reduceLevel += 1
      active.reduceTotal = groups
      active.reduceDone = 0
      if (active.reduceTotal <= REDUCE_FAN_IN) {
        active.phase = 'outline'
        await saveCursor(jobId, active, STAGE_OUTLINING)
      } else {
        await saveCursor(jobId, active, stageReducing(active.reduceLevel, 0, active.reduceTotal))
      }
      return
    }
    const start = active.reduceDone * REDUCE_FAN_IN
    const parts: string[] = []
    for (let index = start; index < Math.min(start + REDUCE_FAN_IN, active.reduceTotal); index += 1) {
      parts.push(await readText(digestKey(prefix, active.reduceLevel, index)))
    }
    const merged = await chat([
      { role: 'system', content: REDUCE_SYSTEM },
      { role: 'user', content: reduceUser(parts) },
    ], { temperature: 0.2 })
    await writeText(digestKey(prefix, active.reduceLevel + 1, active.reduceDone), merged)
    active.reduceDone += 1
    await saveCursor(jobId, active, stageReducing(active.reduceLevel, active.reduceDone, groups))
    return
  }

  if (active.phase === 'outline') {
    const digest = await finalDigest(prefix, active)
    const outline = await chatJson(OUTLINE_SYSTEM, outlineUser(digest), { temperature: 0.2 }, validateOutline)
    active.chapters = outlineChapters(outline)
    active.chapterDone = 0
    active.phase = 'review'
    await saveCursor(jobId, active, stageReviewing(0, active.chapters.length))
    return
  }

  if (active.phase === 'review') {
    if (active.chapterDone >= active.chapters.length) {
      active.phase = 'exam'
      active.examDone = 0
      await saveCursor(jobId, active, stageExamining(0, EXAM_PARTS.length))
      return
    }
    const digest = await finalDigest(prefix, active)
    const chapter = active.chapters[active.chapterDone]
    const content = await chat([
      { role: 'system', content: REVIEW_CHAPTER_SYSTEM },
      { role: 'user', content: reviewChapterUser(chapter, digest) },
    ], { temperature: 0.4 })
    await writeText(reviewKey(prefix, active.chapterDone), withHeading(content, chapter.title))
    active.chapterDone += 1
    await saveCursor(jobId, active, stageReviewing(active.chapterDone, active.chapters.length))
    return
  }

  if (active.phase === 'exam') {
    if (active.examDone >= EXAM_PARTS.length) {
      active.phase = 'assemble'
      await saveCursor(jobId, active, STAGE_SAVING)
      return
    }
    const digest = await finalDigest(prefix, active)
    const part = EXAM_PARTS[active.examDone]
    const content = await chat([
      { role: 'system', content: EXAM_PART_SYSTEM },
      { role: 'user', content: examPartUser(part, digest) },
    ], { temperature: 0.5 })
    await writeText(examKey(prefix, active.examDone), withHeading(content, part.title))
    active.examDone += 1
    await saveCursor(jobId, active, stageExamining(active.examDone, EXAM_PARTS.length))
    return
  }

  if (active.phase === 'assemble') {
    const reviewParts: string[] = []
    for (let index = 0; index < active.chapters.length; index += 1) {
      reviewParts.push(await readText(reviewKey(prefix, index)))
    }
    const examParts: string[] = []
    for (let index = 0; index < EXAM_PARTS.length; index += 1) {
      examParts.push(await readText(examKey(prefix, index)))
    }
    const review = reviewMarkdown(active, reviewParts, active.materialIds.length)
    const exam = examMarkdown(examParts)
    await saveCursor(jobId, active, STAGE_SAVING)
    await persistArtifacts(job, userId, workspaceId, review, exam)
    active.phase = 'done'
    await updateWhere(
      'generation_jobs',
      {
        status: 'done',
        stage: STAGE_DONE,
        error: null,
        cursor: active,
        finished_at: new Date().toISOString(),
        lease_key: null,
        lease_until: null,
      },
      [['id', jobId]],
    )
  }
}

async function advance(request: Request, jobId: number): Promise<Response> {
  const user = await requireUser(request)
  const job = await ownedJob(jobId, user)
  if (terminal(str(job.status))) return json(jobOut(job))

  const leaseUntil = job.lease_until ? Date.parse(str(job.lease_until)) : 0
  if (job.lease_key !== null && Number.isFinite(leaseUntil) && leaseUntil > Date.now()) {
    return json(jobOut(job))
  }

  await updateWhere(
    'generation_jobs',
    {
      status: 'running',
      lease_key: jobId,
      lease_until: new Date(Date.now() + LEASE_MS).toISOString(),
    },
    [['id', jobId]],
  )

  try {
    await advanceStep(job, user.id)
  } catch (error) {
    if (error instanceof HttpError && (error.status === 429 || error.status === 502)) {
      await releaseLease(jobId)
      throw error
    }
    const detail = error instanceof HttpError && typeof error.detail === 'string'
      ? error.detail
      : '生成失败，请稍后重试'
    await failJob(jobId, detail)
  }

  const updated = await findRow('generation_jobs', [['id', jobId]], JOB_COLUMNS)
  if (!updated) return json(jobOut(job))
  if (!terminal(str(updated.status)) && Number(updated.lease_key) === jobId) {
    await releaseLease(jobId)
    updated.lease_key = null
    updated.lease_until = null
  }
  return json(jobOut(updated))
}

export const generationRoutes: Route[] = [
  {
    method: 'POST',
    path: '/workspaces/:id/generate',
    handler: ({ request, params }) => generate(request, Number(params.id)),
  },
  {
    method: 'GET',
    path: '/jobs/:id',
    handler: ({ request, params }) => getJob(request, Number(params.id)),
  },
  {
    method: 'POST',
    path: '/jobs/:id/advance',
    handler: ({ request, params }) => advance(request, Number(params.id)),
  },
]
