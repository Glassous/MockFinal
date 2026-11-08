import { createStorageClient } from '../_qoder/storage.mjs'
import type { StorageClient } from '../_qoder/storage.mjs'
import { HttpError } from './errors.ts'

let client: StorageClient | null = null

export function storage(): StorageClient {
  if (client === null) client = createStorageClient()
  return client
}

/** 返回同源相对上传地址；浏览器直接 PUT 到该地址。 */
export async function createUploadUrl(objectPath: string): Promise<string> {
  const result = await storage().createSignedUploadUrl(objectPath, { upsert: false })
  return result.signedUrl
}

export async function createDownloadUrl(objectPath: string, expiresIn: number): Promise<string> {
  const result = await storage().createSignedUrl(objectPath, expiresIn)
  return result.signedUrl
}

export async function readBytes(objectPath: string, maxBytes: number): Promise<Uint8Array> {
  let response: Response
  try {
    response = await storage().download(objectPath)
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === 'storage_object_not_found') throw new HttpError(404, '文件对象不存在或已被删除')
    throw new HttpError(503, '存储服务暂时不可用，请稍后重试')
  }
  if (!response.ok || !response.body) {
    if (response.status === 404) throw new HttpError(404, '文件对象不存在或已被删除')
    throw new HttpError(503, '存储服务暂时不可用，请稍后重试')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) throw new HttpError(400, '文件大小超过限制')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

export async function saveBytes(
  objectPath: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  try {
    await storage().upload(objectPath, bytes as unknown as BodyInit, { contentType, upsert: true })
  } catch {
    throw new HttpError(503, '保存文件失败，请稍后重试')
  }
}

export async function removeObjects(paths: string[]): Promise<void> {
  const unique = Array.from(new Set(paths.filter(Boolean)))
  if (unique.length === 0) return
  try {
    await storage().remove(unique)
  } catch {
    console.warn('storage_cleanup_failed', { count: unique.length })
  }
}
