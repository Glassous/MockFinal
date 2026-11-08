import {
  ApiError,
  getToken,
  handleUnauthorized,
  parseErrorResponse,
  request,
  requestBlob,
} from './client'
import { API_BASE } from './base'
import { FEATURES } from '@/lib/features'
import { createSseParser } from '@/lib/sse'
import type {
  Deck,
  DeckBuildResponse,
  DeckCreate,
  DeckEvent,
  DeckJob,
  DeckPage,
  DeckProgress,
  DeckUpdate,
  PageBundle,
  PageChatMessage,
} from '@/types'

export function listDecks(workspaceId: number): Promise<Deck[]> {
  return request<Deck[]>(`/workspaces/${workspaceId}/decks`)
}

export function createDeck(workspaceId: number, payload: DeckCreate): Promise<Deck> {
  return request<Deck>(`/workspaces/${workspaceId}/decks`, { method: 'POST', body: payload })
}

export function getDeck(deckId: number): Promise<Deck> {
  return request<Deck>(`/decks/${deckId}`)
}

export function updateDeck(deckId: number, payload: DeckUpdate): Promise<Deck> {
  return request<Deck>(`/decks/${deckId}`, { method: 'PATCH', body: payload })
}

export function deleteDeck(deckId: number): Promise<void> {
  return request<void>(`/decks/${deckId}`, { method: 'DELETE' })
}

const DECK_BUILD_UNAVAILABLE = '复习页构建服务未部署（Serverless 版本暂不提供）'
const DECK_CHAT_UNAVAILABLE = '页面 AI 助手未部署（Serverless 版本暂不提供）'

export function buildDeck(
  deckId: number,
  options: { rebuildAll?: boolean; replan?: boolean } = {},
): Promise<DeckBuildResponse> {
  if (!FEATURES.deckBuild) return Promise.reject(new ApiError(503, DECK_BUILD_UNAVAILABLE))
  return request<DeckBuildResponse>(`/decks/${deckId}/build`, {
    method: 'POST',
    body: { rebuild_all: options.rebuildAll ?? false, replan: options.replan ?? false },
  })
}

export function cancelDeckBuild(deckId: number): Promise<DeckJob> {
  if (!FEATURES.deckBuild) return Promise.reject(new ApiError(503, DECK_BUILD_UNAVAILABLE))
  return request<DeckJob>(`/decks/${deckId}/cancel`, { method: 'POST' })
}

export function getDeckJob(jobId: number): Promise<DeckJob> {
  return request<DeckJob>(`/deck-jobs/${jobId}`)
}

export function listDeckEvents(jobId: number, afterId = 0): Promise<DeckEvent[]> {
  return request<DeckEvent[]>(`/deck-jobs/${jobId}/events?after_id=${afterId}`)
}

export function getDeckPage(deckId: number, pageId: number): Promise<DeckPage> {
  return request<DeckPage>(`/decks/${deckId}/pages/${pageId}`)
}

export function getPageBundle(deckId: number, pageId: number): Promise<PageBundle> {
  return request<PageBundle>(`/decks/${deckId}/pages/${pageId}/bundle`)
}

export function loadPageThumbnail(deckId: number, pageId: number): Promise<Blob> {
  return requestBlob(`/decks/${deckId}/pages/${pageId}/thumbnail`)
}

export async function rebuildPage(
  deckId: number,
  pageId: number,
  feedback?: string,
): Promise<DeckBuildResponse> {
  if (!FEATURES.deckBuild) throw new ApiError(503, DECK_BUILD_UNAVAILABLE)
  return request<DeckBuildResponse>(`/decks/${deckId}/pages/${pageId}/rebuild`, {
    method: 'POST',
    body: { feedback: feedback?.trim() || null },
  })
}

export function updateDeckProgress(
  deckId: number,
  payload: { last_page_id?: number; completed_page_ids?: number[] },
): Promise<DeckProgress> {
  return request<DeckProgress>(`/decks/${deckId}/progress`, { method: 'PATCH', body: payload })
}

export function listPageMessages(deckId: number, pageId: number): Promise<PageChatMessage[]> {
  return request<PageChatMessage[]>(`/decks/${deckId}/pages/${pageId}/messages`)
}

export interface PageMessagePayload {
  content: string
  quote?: string | null
  block_text?: string | null
}

export interface PageMessageRef {
  material_id: number | null
  material_name: string
  section_id: number | null
  heading: string
  quote: string
  unverified: boolean
}

export interface PageMessageStreamHandlers {
  onDelta: (text: string) => void
  onDone: (payload: { message_id: number; refs: PageMessageRef[] }) => void
  onError: (detail: string) => void
}

/** POST 页面问答并消费 SSE；HTTP 错误抛 ApiError，流内错误交给 onError。 */
export async function streamPageMessage(
  deckId: number,
  pageId: number,
  payload: PageMessagePayload,
  handlers: PageMessageStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  if (!FEATURES.deckChat) throw new ApiError(501, DECK_CHAT_UNAVAILABLE)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API_BASE}/decks/${deckId}/pages/${pageId}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  })
  if (res.status === 401) handleUnauthorized()
  if (!res.ok) throw await parseErrorResponse(res)
  if (!res.body) throw new ApiError(500, '当前浏览器不支持流式回答')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const parse = createSseParser()
  let settled = false

  const handleEvents = (events: ReturnType<ReturnType<typeof createSseParser>>) => {
    for (const event of events) {
      let data: unknown
      try {
        data = JSON.parse(event.data)
      } catch {
        continue
      }
      if (event.event === 'delta') {
        const text = (data as { text?: unknown }).text
        if (typeof text === 'string' && text) handlers.onDelta(text)
      } else if (event.event === 'done') {
        settled = true
        const id = (data as { message_id?: unknown }).message_id
        const refs = (data as { refs?: unknown }).refs
        handlers.onDone({
          message_id: typeof id === 'number' ? id : 0,
          refs: Array.isArray(refs) ? (refs as PageMessageRef[]) : [],
        })
      } else if (event.event === 'error') {
        settled = true
        const detail = (data as { detail?: unknown }).detail
        handlers.onError(typeof detail === 'string' ? detail : '页面助手回答失败，请稍后重试')
      }
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      handleEvents(parse(decoder.decode(value, { stream: true })))
    }
    handleEvents(parse(decoder.decode()))
    if (!settled) handlers.onError('连接已中断，回答可能不完整，请重试')
  } finally {
    reader.releaseLock()
  }
}