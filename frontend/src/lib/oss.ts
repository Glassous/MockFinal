import type OSS from 'ali-oss'
import { getUploadCredentials, registerMaterial, uploadMaterialLocal } from '@/api/materials'
import type { Material, OssCredentials } from '@/types'

/** 允许的扩展名与大小上限（前端本地预检） */
export const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'pptx', 'md', 'txt'] as const
export const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

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
    return `文件「${file.name}」超过 50MB 上限`
  }
  return null
}

interface CachedClient {
  client: OSS
  creds: OssCredentials
  /** 凭证过期时间戳（ms） */
  expiresAt: number
}

/** 按 workspace 缓存 OSS 客户端 */
const clientCache = new Map<number, CachedClient>()
/** 过期前 5 分钟主动刷新 */
const REFRESH_AHEAD_MS = 5 * 60 * 1000

function parseExpiration(expiration: string): number {
  const t = Date.parse(expiration)
  return Number.isNaN(t) ? Date.now() + 30 * 60 * 1000 : t
}

/** 获取（或复用/刷新）某工作区的 OSS 客户端 */
async function getOssClient(workspaceId: number, creds: OssCredentials): Promise<OSS> {
  const now = Date.now()
  const cached = clientCache.get(workspaceId)
  if (cached && cached.expiresAt - REFRESH_AHEAD_MS > now) {
    return cached.client
  }

  // 动态加载 ali-oss：仅在真正需要 OSS 直传时才下载该 SDK（~500KB），
  // 避免其被打进工作区首屏 chunk
  const ossModule = (await import('ali-oss')) as unknown as {
    default?: new (options: OSS.Options) => OSS
  }
  const OssClient =
    ossModule.default ?? (ossModule as unknown as new (options: OSS.Options) => OSS)

  const client: OSS = new OssClient({
    region: creds.region,
    bucket: creds.bucket,
    accessKeyId: creds.accessKeyId,
    accessKeySecret: creds.accessKeySecret,
    stsToken: creds.securityToken,
    authorizationV4: true,
    secure: true,
    // ali-oss 内部在 token 临近失效时自动调用，续期后返回新凭证
    refreshSTSToken: async () => {
      const fresh = await getUploadCredentials(workspaceId)
      if (fresh.mode !== 'oss') {
        throw new Error('上传凭证已切换为本地模式，请重试')
      }
      const entry = clientCache.get(workspaceId)
      if (entry) {
        entry.creds = fresh
        entry.expiresAt = parseExpiration(fresh.expiration)
      }
      return {
        accessKeyId: fresh.accessKeyId,
        accessKeySecret: fresh.accessKeySecret,
        stsToken: fresh.securityToken,
      }
    },
    refreshSTSTokenInterval: 50 * 60 * 1000,
  })

  clientCache.set(workspaceId, { client, creds, expiresAt: parseExpiration(creds.expiration) })
  return client
}

/**
 * 上传单个文件到工作区。
 * - mode=oss：STS 直传（multipartUpload 分片，进度回调）→ 登记元数据
 * - mode=local：multipart 经后端上传（XMLHttpRequest，带进度）
 * 返回登记后的 Material。
 */
export async function uploadFile(
  workspaceId: number,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Material> {
  if (signal?.aborted) throw new Error('上传已取消')
  const creds = await getUploadCredentials(workspaceId)

  if (creds.mode === 'local') {
    // local 模式透传 signal：组件卸载/切换时中止底层 XHR
    return uploadMaterialLocal(workspaceId, file, onProgress, signal)
  }

  // OSS 模式：multipartUpload 中途取消超出本次范围，仅在关键节点前置检查中止状态
  if (signal?.aborted) throw new Error('上传已取消')
  const client = await getOssClient(workspaceId, creds)
  const key = `${creds.key_prefix}${Date.now()}-${file.name}`

  await client.multipartUpload(key, file, {
    partSize: 1024 * 1024,
    parallel: 4,
    progress: (p: number) => {
      onProgress?.(Math.min(99, Math.round(p * 100)))
    },
  })
  onProgress?.(100)

  return registerMaterial(workspaceId, {
    filename: file.name,
    storage_key: key,
    size: file.size,
    content_type: file.type || 'application/octet-stream',
  })
}
