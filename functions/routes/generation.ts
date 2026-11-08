import { config } from '../lib/config.ts'
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
import { chat } from '../lib/llm.ts'
import {
  ARTIFACT_TITLES,
  EXAM_SYSTEM,
  REVIEW_SYSTEM,
  STAGE_DONE,
  STAGE_FETCHING,
  STAGE_QUEUED,
  STAGE_SAVING,
  STAGE_WRITING,
  SUMMARIZE_SYSTEM,
  examUser,
  reviewUser,
  stageSummarizing,
  summarizeUser,
} from '../lib/prompts.ts'
import { jobOut } from '../lib/serializers.ts'
import { saveBytes } from '../lib/storage.ts'
import type { Route } from '../router.ts'
import { getOwnedWorkspace } from './workspaces.ts'

const JOB_COLUMNS = 'id,workspace_id,status,stage,error,cursor,lease_key,lease_until,finished_at,created_at'
const MAX_MATERIAL_CHARS = 24000

interface JobCursor {
  phase: 'summarize' | 'review' | 'exam' | 'persist' | 'done'
  materialIds: number[]
  done: number[]
  failed: number[]
  summaries: Record<string, string>
  review?: string
  exam?: string
  partialNote?: string
}

function emptyCursor(): JobCursor {
  return { phase: 'summarize', materialIds: [], done: [], failed: [], summaries: {} }
}

function readCursor(job: Row): JobCursor | null {
  const raw = job.cursor
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const cursor = raw as Partial<JobCursor>
  if (typeof cursor.phase !== 'string' || !Array.isArray(cursor.materialIds)) return null
  return {
    phase: cursor.phase,
    materialIds: cursor.materialIds.map((value) => Number(value)),
    done: Array.isArray(cursor.done) ? cursor.done.map((value) => Number(value)) : [],
    failed: Array.isArray(cursor.failed) ? cursor.failed.map((value) => Number(value)) : [],
    summaries: cursor.summaries && typeof cursor.summaries === 'object' ? cursor.summaries : {},
    review: typeof cursor.review === 'string' ? cursor.review : undefined,
    exam: typeof cursor.exam === 'string' ? cursor.exam : undefined,
    partialNote: typeof cursor.partialNote === 'string' ? cursor.partialNote : undefined,
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
  const running = await selectRows('generation_jobs', 'id', [
    ['workspace_id', workspaceId],
    ['status', 'pending'],
  ], { limit: 1 })
  if (running.length > 0) {
    throw new HttpError(409, '当前工作区已有正在进行的生成任务，请等待其完成')
  }
  const active = await selectRows('generation_jobs', 'id', [
    ['workspace_id', workspaceId],
    ['status', 'running'],
  ], { limit: 1 })
  if (active.length > 0) {
    throw new HttpError(409, '当前工作区已有正在进行的生成任务，请等待其完成')
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

async function sectionsText(materialId: number): Promise<string> {
  const sections = await selectRows<Row>('material_sections', 'heading,content', [
    ['material_id', materialId],
  ], { order: 'ordinal' })
  const rendered = sections.map((section) => {
    const heading = str(section.heading).trim()
    const body = str(section.content).trim()
    if (heading && !body.startsWith(heading)) return `## ${heading}\n${body}`
    return body
  })
  return rendered.join('\n\n')
}

async function materialFilename(materialId: number): Promise<string> {
  const material = await findRow('materials', [['id', materialId]], 'filename')
  return material ? str(material.filename, `资料#${materialId}`) : `资料#${materialId}`
}

async function artifactsPaths(userId: number, workspaceId: number, jobId: number, kind: string): Promise<string> {
  return `artifacts/${userId}/${workspaceId}/${jobId}-${kind}.md`
}

async function persistArtifacts(
  job: Row,
  cursor: JobCursor,
  userId: number,
  workspaceId: number,
): Promise<void> {
  const jobId = num(job.id)
  const contents: Record<string, string> = {
    review: cursor.review ?? '',
    exam: cursor.exam ?? '',
  }
  for (const kind of ['review', 'exam']) {
    const content = contents[kind]
    if (!content) throw new HttpError(400, '生成结果为空，请重新发起生成')
    const objectPath = await artifactsPaths(userId, workspaceId, jobId, kind)
    await saveBytes(objectPath, new TextEncoder().encode(content), 'text/markdown; charset=utf-8')
    try {
      await insertRow(
        'artifacts',
        {
          id: newId(),
          workspace_id: workspaceId,
          job_id: jobId,
          kind,
          title: ARTIFACT_TITLES[kind],
          storage_key: objectPath,
        },
        'id',
      )
    } catch (error) {
      if (isUniqueViolation(error)) continue
      throw error
    }
  }
}

async function advanceStep(job: Row, userId: number): Promise<void> {
  const jobId = num(job.id)
  const workspaceId = num(job.workspace_id)
  let cursor = readCursor(job)
  if (!cursor) {
    const materials = await selectRows<Row>('materials', 'id', [
      ['workspace_id', workspaceId],
      ['status', 'indexed'],
    ], { order: 'created_at' })
    if (materials.length === 0) throw new HttpError(400, '没有可用于生成的已就绪资料，请先上传资料')
    cursor = { ...emptyCursor(), materialIds: materials.map((row) => num(row.id)) }
    await saveCursor(jobId, cursor, STAGE_FETCHING)
  }

  const active: JobCursor = cursor

  if (active.phase === 'summarize') {
    const pending = active.materialIds.find((id) => !active.done.includes(id))
    if (pending === undefined) {
      active.phase = 'review'
      await saveCursor(jobId, active, STAGE_WRITING)
      return
    }
    const total = active.materialIds.length
    const filename = await materialFilename(pending)
    const content = (await sectionsText(pending)).slice(0, MAX_MATERIAL_CHARS)
    try {
      const summary = await chat([
        { role: 'system', content: SUMMARIZE_SYSTEM },
        { role: 'user', content: summarizeUser(filename, content) },
      ], { temperature: 0.3 })
      active.summaries[String(pending)] = `## 《${filename}》\n\n${summary}`
    } catch (error) {
      if (error instanceof HttpError && (error.status === 429 || error.status === 502)) throw error
      active.failed.push(pending)
      active.summaries[String(pending)] = ''
    }
    active.done.push(pending)
    active.phase = active.done.length >= total ? 'review' : 'summarize'
    await saveCursor(
      jobId,
      active,
      active.phase === 'review' ? STAGE_WRITING : stageSummarizing(active.done.length, total),
    )
    return
  }

  if (active.phase === 'review') {
    const summaries = active.materialIds
      .map((id) => active.summaries[String(id)] ?? '')
      .filter((text) => text.trim().length > 0)
    if (summaries.length === 0) throw new HttpError(400, '资料摘要全部失败，无法生成复习资料')
    if (active.failed.length > 0) {
      active.partialNote = `${active.failed.length}/${active.materialIds.length} 份资料摘要失败，结果可能不完整`
    }
    const merged = summaries.join('\n\n---\n\n')
    active.review = await chat([
      { role: 'system', content: REVIEW_SYSTEM },
      { role: 'user', content: reviewUser(merged, summaries.length) },
    ], { temperature: 0.5 })
    active.phase = 'exam'
    await saveCursor(jobId, active, STAGE_WRITING)
    return
  }

  if (active.phase === 'exam') {
    const summaries = active.materialIds
      .map((id) => active.summaries[String(id)] ?? '')
      .filter((text) => text.trim().length > 0)
    const merged = summaries.join('\n\n---\n\n')
    active.exam = await chat([
      { role: 'system', content: EXAM_SYSTEM },
      { role: 'user', content: examUser(merged, summaries.length) },
    ], { temperature: 0.5 })
    active.phase = 'persist'
    await saveCursor(jobId, active, STAGE_SAVING)
    return
  }

  if (active.phase === 'persist') {
    await persistArtifacts(job, active, userId, workspaceId)
    active.phase = 'done'
    await updateWhere(
      'generation_jobs',
      {
        status: 'done',
        stage: STAGE_DONE,
        error: active.partialNote ?? null,
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
      lease_until: new Date(Date.now() + 90_000).toISOString(),
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
