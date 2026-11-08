import {
  getUploadCredentials,
  putToSignedUrl,
  registerMaterial,
  resolveSignedUrl,
} from '@/api/materials'
import type { Material } from '@/types'

/** 允许的扩展名与大小上限（与后端校验保持一致） */
export const ALLOWED_EXTENSIONS = ['md', 'txt'] as const
export const MAX_FILE_SIZE = 8 * 1024 * 1024 // 8MB

/** 预检文件；返回错误文案（null 表示通过） */
export function validateFile(file: File): string | null {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  if (!ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
    return `不支持的文件类型「.${ext || '无'}」，仅支持 ${ALLOWED_EXTENSIONS.join(' / ')}`
  }
  if (file.size === 0) {
    return `文件「${file.name}」为空，无法上传`
  }
  if (file.size > MAX_FILE_SIZE) {
    return `文件「${file.name}」超过 8MB 上限`
  }
  return null
}

function contentTypeOf(file: File): string {
  if (file.type) return file.type
  return file.name.toLowerCase().endsWith('.md')
    ? 'text/markdown; charset=utf-8'
    : 'text/plain; charset=utf-8'
}

/**
 * 上传单个文件到工作区：
 * 申请签名 → PUT 到 Qoder Sites Storage → 登记并同步解析。
 * 返回登记后的 Material（解析失败时 status='failed'，不会抛错）。
 */
export async function uploadFile(
  workspaceId: number,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Material> {
  if (signal?.aborted) throw new Error('上传已取消')

  const creds = await getUploadCredentials(workspaceId, file.name)
  const contentType = contentTypeOf(file)

  await putToSignedUrl(resolveSignedUrl(creds.signedUrl), file, contentType, onProgress, signal)
  onProgress?.(100)

  return registerMaterial(workspaceId, {
    filename: file.name,
    storage_key: creds.path,
    size: file.size,
    content_type: contentType,
  })
}
