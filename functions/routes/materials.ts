import { config } from '../lib/config.ts'
import { requireUser } from '../lib/current-user.ts'
import type { CurrentUser } from '../lib/current-user.ts'
import {
  deleteWhere,
  findRow,
  insertRow,
  insertRows,
  isUniqueViolation,
  num,
  selectRows,
  str,
  updateWhere,
  type Row,
} from '../lib/db.ts'
import { HttpError } from '../lib/errors.ts'
import { field, intField, json, noContent, readJson, redirect } from '../lib/http.ts'
import { newId, newIdBlock } from '../lib/ids.ts'
import { decodeTextFile, isMarkdownFile } from '../lib/parse.ts'
import { sectionPayloads } from '../lib/section.ts'
import { materialOut } from '../lib/serializers.ts'
import { createDownloadUrl, readBytes, removeObjects } from '../lib/storage.ts'
import type { Route } from '../router.ts'
import { getOwnedWorkspace, validateMaterialFilename } from './workspaces.ts'

const MATERIAL_COLUMNS =
  'id,workspace_id,filename,storage_key,size,content_type,status,error,chunk_count,created_at'

async function getOwnedMaterial(materialId: number, user: CurrentUser): Promise<Row> {
  const material = await findRow('materials', [['id', materialId]], MATERIAL_COLUMNS)
  if (!material) throw new HttpError(404, '资料不存在')
  const workspace = await findRow('workspaces', [['id', num(material.workspace_id)]], 'id,user_id')
  if (!workspace || num(workspace.user_id) !== user.id) throw new HttpError(404, '资料不存在')
  return material
}

async function listMaterials(request: Request, workspaceId: number): Promise<Response> {
  const user = await requireUser(request)
  await getOwnedWorkspace(workspaceId, user)
  const rows = await selectRows('materials', MATERIAL_COLUMNS, [['workspace_id', workspaceId]], {
    order: 'created_at',
  })
  return json(rows.map(materialOut))
}

function markFailed(materialId: number, filename: string, error: unknown): Promise<unknown> {
  const detail = error instanceof HttpError && typeof error.detail === 'string'
    ? error.detail
    : `《${filename}》解析失败，请检查文件内容`
  return updateWhere('materials', { status: 'failed', error: detail }, [['id', materialId]])
}

async function registerMaterial(request: Request, workspaceId: number): Promise<Response> {
  const user = await requireUser(request)
  await getOwnedWorkspace(workspaceId, user)
  const body = await readJson(request)
  const filename = validateMaterialFilename(field(body, 'filename', { min: 1, max: 200 }))
  const storageKey = field(body, 'storage_key', { min: 1, max: 512, trim: false })
  const size = intField(body, 'size', { min: 1, max: config.materialMaxBytes })
  const contentType = field(body, 'content_type', { trim: false, optional: true, fallback: '' })

  const prefix = `materials/${user.id}/${workspaceId}/`
  if (!storageKey.startsWith(prefix) || storageKey.includes('..')) {
    throw new HttpError(400, `storage_key 必须以 ${prefix} 开头`)
  }
  const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  if (!storageKey.toLowerCase().endsWith(extension)) {
    throw new HttpError(400, 'storage_key 与文件名扩展名不一致')
  }

  const bytes = await readBytes(storageKey, config.materialMaxBytes)
  if (bytes.byteLength !== size) {
    throw new HttpError(400, '文件大小与存储实际对象不一致，请重新上传')
  }

  const materialId = newId()
  const row: Row = {
    id: materialId,
    workspace_id: workspaceId,
    filename,
    storage_key: storageKey,
    size,
    content_type: contentType || (isMarkdownFile(filename) ? 'text/markdown' : 'text/plain'),
    status: 'indexed',
    error: null,
    chunk_count: 0,
  }
  try {
    await insertRow('materials', row, 'created_at')
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(400, '该文件已登记，请勿重复提交')
    throw error
  }

  try {
    const text = decodeTextFile(filename, bytes)
    const payloads = sectionPayloads(filename, text, isMarkdownFile(filename))
    if (payloads.length === 0) throw new HttpError(400, `《${filename}》分节结果为空，无法建立资料索引`)
    const ids = newIdBlock(payloads.length)
    const sectionRows = payloads.map((payload, index) => ({
      id: ids[index],
      material_id: materialId,
      workspace_id: workspaceId,
      ordinal: index,
      heading: payload.heading,
      content: payload.content,
      char_count: payload.char_count,
      page: payload.page,
      meta: payload.meta,
    }))
    await insertRows('material_sections', sectionRows)
    await updateWhere('materials', { chunk_count: sectionRows.length, status: 'indexed', error: null }, [
      ['id', materialId],
    ])
    row.chunk_count = sectionRows.length
  } catch (error) {
    await markFailed(materialId, filename, error)
    const stored = await findRow('materials', [['id', materialId]], MATERIAL_COLUMNS)
    return json(materialOut(stored ?? row))
  }

  const created = await findRow('materials', [['id', materialId]], MATERIAL_COLUMNS)
  return json(materialOut(created ?? row))
}

async function deleteMaterial(request: Request, materialId: number): Promise<Response> {
  const user = await requireUser(request)
  const material = await getOwnedMaterial(materialId, user)
  await deleteWhere('material_sections', [['material_id', materialId]])
  await deleteWhere('materials', [['id', materialId]])
  await removeObjects([str(material.storage_key)])
  return noContent()
}

async function downloadMaterial(request: Request, materialId: number): Promise<Response> {
  const user = await requireUser(request)
  const material = await getOwnedMaterial(materialId, user)
  const signedUrl = await createDownloadUrl(str(material.storage_key), config.downloadUrlTtl)
  return redirect(signedUrl)
}

export const materialRoutes: Route[] = [
  {
    method: 'GET',
    path: '/workspaces/:id/materials',
    handler: ({ request, params }) => listMaterials(request, Number(params.id)),
  },
  {
    method: 'POST',
    path: '/workspaces/:id/materials',
    handler: ({ request, params }) => registerMaterial(request, Number(params.id)),
  },
  {
    method: 'DELETE',
    path: '/materials/:id',
    handler: ({ request, params }) => deleteMaterial(request, Number(params.id)),
  },
  {
    method: 'GET',
    path: '/materials/:id/download',
    handler: ({ request, params }) => downloadMaterial(request, Number(params.id)),
  },
]
