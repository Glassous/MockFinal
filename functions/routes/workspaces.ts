import { ALLOWED_MATERIAL_EXTENSIONS, config } from '../lib/config.ts'
import { requireUser } from '../lib/current-user.ts'
import type { CurrentUser } from '../lib/current-user.ts'
import {
  deleteWhere,
  findRow,
  insertRow,
  num,
  selectRows,
  str,
  updateWhere,
  type Row,
} from '../lib/db.ts'
import { HttpError } from '../lib/errors.ts'
import { field, json, noContent, optionalField, readJson } from '../lib/http.ts'
import { newId } from '../lib/ids.ts'
import { workspaceOut } from '../lib/serializers.ts'
import { createUploadUrl, removeObjects } from '../lib/storage.ts'
import type { Route } from '../router.ts'

const WORKSPACE_COLUMNS = 'id,user_id,name,description,created_at'

export async function getOwnedWorkspace(workspaceId: number, user: CurrentUser): Promise<Row> {
  const workspace = await findRow('workspaces', [['id', workspaceId]], WORKSPACE_COLUMNS)
  if (!workspace || num(workspace.user_id) !== user.id) {
    throw new HttpError(404, '工作区不存在')
  }
  return workspace
}

export function validateMaterialFilename(rawName: string): string {
  const raw = (rawName ?? '').trim().replace(/\\/g, '/')
  const name = raw.split('/').pop() ?? ''
  if (
    !name ||
    name !== raw ||
    name === '.' ||
    name === '..' ||
    raw.length > 200 ||
    /[\u0000-\u001f]/.test(raw)
  ) {
    throw new HttpError(400, '文件名无效')
  }
  const dot = name.lastIndexOf('.')
  const extension = dot >= 0 ? name.slice(dot).toLowerCase() : ''
  if (!ALLOWED_MATERIAL_EXTENSIONS.includes(extension as (typeof ALLOWED_MATERIAL_EXTENSIONS)[number])) {
    throw new HttpError(400, '仅支持 md / txt 格式的文件')
  }
  return name
}

async function listWorkspaces(request: Request): Promise<Response> {
  const user = await requireUser(request)
  const rows = await selectRows('workspaces', WORKSPACE_COLUMNS, [['user_id', user.id]], {
    order: 'created_at',
    ascending: false,
  })
  return json(rows.map(workspaceOut))
}

async function createWorkspace(request: Request): Promise<Response> {
  const user = await requireUser(request)
  const body = await readJson(request)
  const name = field(body, 'name', { min: 1, max: 128 })
  const description = optionalField(body, 'description') ?? ''
  const row = {
    id: newId(),
    user_id: user.id,
    name,
    description: description.trim(),
  }
  await insertRow('workspaces', row)
  return json({
    id: row.id,
    name: row.name,
    description: row.description,
    created_at: new Date().toISOString(),
  })
}

async function getWorkspace(request: Request, workspaceId: number): Promise<Response> {
  const user = await requireUser(request)
  const workspace = await getOwnedWorkspace(workspaceId, user)
  return json(workspaceOut(workspace))
}

async function updateWorkspace(request: Request, workspaceId: number): Promise<Response> {
  const user = await requireUser(request)
  await getOwnedWorkspace(workspaceId, user)
  const body = await readJson(request)
  const name = optionalField(body, 'name', { min: 1, max: 128 })
  if (name !== null && !name.trim()) throw new HttpError(400, '工作区名称不能为空')
  const description = optionalField(body, 'description')
  const values: Row = {}
  if (name !== null) values.name = name.trim()
  if (description !== null) values.description = description.trim()
  if (Object.keys(values).length > 0) {
    await updateWhere('workspaces', values, [['id', workspaceId]])
  }
  const updated = await findRow('workspaces', [['id', workspaceId]], WORKSPACE_COLUMNS)
  return json(workspaceOut(updated ?? {}))
}

async function deleteWorkspaceTree(workspaceId: number): Promise<void> {
  const objectKeys: string[] = []
  const decks = await selectRows<Row>('review_decks', 'id', [['workspace_id', workspaceId]])
  for (const deck of decks) {
    const deckId = num(deck.id)
    const pages = await selectRows<Row>('deck_pages', 'id,bundle_key,thumbnail_key', [
      ['deck_id', deckId],
    ])
    for (const page of pages) {
      if (page.bundle_key) objectKeys.push(str(page.bundle_key))
      if (page.thumbnail_key) objectKeys.push(str(page.thumbnail_key))
    }
    const jobs = await selectRows<Row>('deck_build_jobs', 'id', [['deck_id', deckId]])
    for (const job of jobs) {
      await deleteWhere('deck_build_events', [['job_id', num(job.id)]])
    }
    await deleteWhere('page_chat_messages', [['deck_id', deckId]])
    await deleteWhere('knowledge_points', [['deck_id', deckId]])
    await deleteWhere('deck_pages', [['deck_id', deckId]])
    await deleteWhere('deck_build_jobs', [['deck_id', deckId]])
    await deleteWhere('review_decks', [['id', deckId]])
  }

  const materials = await selectRows<Row>('materials', 'storage_key', [['workspace_id', workspaceId]])
  const artifacts = await selectRows<Row>('artifacts', 'storage_key', [['workspace_id', workspaceId]])
  for (const material of materials) objectKeys.push(str(material.storage_key))
  for (const artifact of artifacts) objectKeys.push(str(artifact.storage_key))

  await deleteWhere('material_sections', [['workspace_id', workspaceId]])
  await deleteWhere('materials', [['workspace_id', workspaceId]])
  await deleteWhere('artifacts', [['workspace_id', workspaceId]])
  await deleteWhere('generation_jobs', [['workspace_id', workspaceId]])
  await deleteWhere('workspaces', [['id', workspaceId]])
  await removeObjects(objectKeys)
}

async function deleteWorkspace(request: Request, workspaceId: number): Promise<Response> {
  const user = await requireUser(request)
  await getOwnedWorkspace(workspaceId, user)
  await deleteWorkspaceTree(workspaceId)
  return noContent()
}

async function uploadCredentials(request: Request, url: URL, workspaceId: number): Promise<Response> {
  const user = await requireUser(request)
  await getOwnedWorkspace(workspaceId, user)
  const filename = validateMaterialFilename(url.searchParams.get('filename') ?? '')
  const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  const materialId = newId()
  const objectPath = `materials/${user.id}/${workspaceId}/${materialId}${extension}`
  const signedUrl = await createUploadUrl(objectPath)
  return json(
    {
      mode: 'sites',
      path: objectPath,
      signedUrl,
      expiresIn: config.maxUploadUrlTtl,
    },
    200,
    { 'cache-control': 'no-store' },
  )
}

export const workspaceRoutes: Route[] = [
  { method: 'GET', path: '/workspaces', handler: ({ request }) => listWorkspaces(request) },
  { method: 'POST', path: '/workspaces', handler: ({ request }) => createWorkspace(request) },
  {
    method: 'GET',
    path: '/workspaces/:id',
    handler: ({ request, params }) => getWorkspace(request, Number(params.id)),
  },
  {
    method: 'PATCH',
    path: '/workspaces/:id',
    handler: ({ request, params }) => updateWorkspace(request, Number(params.id)),
  },
  {
    method: 'DELETE',
    path: '/workspaces/:id',
    handler: ({ request, params }) => deleteWorkspace(request, Number(params.id)),
  },
  {
    method: 'POST',
    path: '/workspaces/:id/upload-credentials',
    handler: ({ request, url, params }) => uploadCredentials(request, url, Number(params.id)),
  },
]
