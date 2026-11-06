import { request, requestBlob, getToken, handleUnauthorized, ApiError } from './client'
import type { Material, MaterialCreate, UploadCredentials } from '@/types'

/** 申请上传凭证（OSS STS 或 local 回退） */
export function getUploadCredentials(workspaceId: number): Promise<UploadCredentials> {
  return request<UploadCredentials>(`/workspaces/${workspaceId}/upload-credentials`, {
    method: 'POST',
  })
}

/** OSS 模式：直传完成后登记资料元数据 */
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

/** local 回退模式上传超时（ms） */
const LOCAL_UPLOAD_TIMEOUT = 120_000

/**
 * local 回退模式：multipart 直传后端，XMLHttpRequest 支持上传进度回调。
 * 传入 signal 可在组件卸载/切换工作区时中止上传（xhr.abort）。
 */
export function uploadMaterialLocal(
  workspaceId: number,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Material> {
  return new Promise<Material>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const form = new FormData()
    form.append('file', file)

    xhr.open('POST', `/api/workspaces/${workspaceId}/materials`)
    xhr.timeout = LOCAL_UPLOAD_TIMEOUT
    const token = getToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    // 外部中止：signal 触发时 abort 掉 XHR
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
      if (xhr.status === 401) handleUnauthorized()
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as Material)
        } catch {
          reject(new ApiError(xhr.status, '响应解析失败'))
        }
      } else {
        let detail = `上传失败（HTTP ${xhr.status}）`
        try {
          const data = JSON.parse(xhr.responseText)
          if (data && typeof data.detail === 'string') detail = data.detail
        } catch {
          /* 忽略 */
        }
        reject(new ApiError(xhr.status, detail))
      }
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
    xhr.send(form)
  })
}
