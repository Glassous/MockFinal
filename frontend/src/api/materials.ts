import { request, requestBlob, ApiError } from './client'
import type { Material, MaterialCreate, UploadCredentials } from '@/types'

/** 申请上传凭证：返回服务端生成的对象路径与同源签名上传地址 */
export function getUploadCredentials(
  workspaceId: number,
  filename: string,
): Promise<UploadCredentials> {
  return request<UploadCredentials>(
    `/workspaces/${workspaceId}/upload-credentials?filename=${encodeURIComponent(filename)}`,
    { method: 'POST' },
  )
}

/** 直传完成后登记资料元数据（服务端同步下载、解析、分节） */
export function registerMaterial(
  workspaceId: number,
  payload: MaterialCreate,
): Promise<Material> {
  return request<Material>(`/workspaces/${workspaceId}/materials`, {
    method: 'POST',
    body: payload,
  })
}

export function listMaterials(workspaceId: number): Promise<Material[]> {
  return request<Material[]>(`/workspaces/${workspaceId}/materials`)
}

export function deleteMaterial(id: number): Promise<void> {
  return request<void>(`/materials/${id}`, { method: 'DELETE' })
}

export function downloadMaterial(id: number): Promise<Blob> {
  return requestBlob(`/materials/${id}/download`)
}

/** 签名直传超时（ms）：8MiB 文本在弱网下也足够 */
const SIGNED_UPLOAD_TIMEOUT = 120_000

/**
 * 用签名地址 PUT 文件字节（XMLHttpRequest 以支持上传进度）。
 * 签名地址由服务端按 `materials/{uid}/{wid}/...` 生成，浏览器无法指定其他路径。
 */
export function putToSignedUrl(
  signedUrl: string,
  file: File,
  contentType: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', signedUrl)
    xhr.timeout = SIGNED_UPLOAD_TIMEOUT
    xhr.setRequestHeader('Content-Type', contentType)
    // 平台存储地址与站点同源，不额外携带业务 JWT

    const onExternalAbort = () => xhr.abort()
    if (signal) {
      if (signal.aborted) {
        reject(new ApiError(0, '上传已取消'))
        return
      }
      signal.addEventListener('abort', onExternalAbort)
    }
    const detach = () => signal?.removeEventListener('abort', onExternalAbort)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }

    xhr.onload = () => {
      detach()
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new ApiError(xhr.status, `文件上传失败（HTTP ${xhr.status}）`))
    }
    xhr.onerror = () => {
      detach()
      reject(new ApiError(0, '网络错误，上传失败'))
    }
    xhr.ontimeout = () => {
      detach()
      reject(new ApiError(0, '上传超时，请检查网络后重试'))
    }
    xhr.onabort = () => {
      detach()
      reject(new ApiError(0, '上传已取消'))
    }
    xhr.send(file)
  })
}

/** 兜底：确保签名地址相对站点根路径解析（平台返回的是同源相对地址）。 */
export function resolveSignedUrl(signedUrl: string): string {
  if (/^https?:\/\//i.test(signedUrl)) return signedUrl
  return new URL(signedUrl, window.location.origin).toString()
}
