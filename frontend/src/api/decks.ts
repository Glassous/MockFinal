import { request, requestBlob } from './client'
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

export function buildDeck(
  deckId: number,
  options: { rebuildAll?: boolean; replan?: boolean } = {},
): Promise<DeckBuildResponse> {
  return request<DeckBuildResponse>(`/decks/${deckId}/build`, {
    method: 'POST',
    body: { rebuild_all: options.rebuildAll ?? false, replan: options.replan ?? false },
  })
}

export function cancelDeckBuild(deckId: number): Promise<DeckJob> {
  return request<DeckJob>(`/decks/${deckId}/cancel`, { method: 'POST' })
}

export function getDeckJob(jobId: number): Promise<DeckJob> {
  return request<DeckJob>(`/deck-jobs/${jobId}`)
}

/** 客户端驱动的构建推进：每次最多执行一次模型调用。 */
export function advanceDeckJob(jobId: number): Promise<DeckJob> {
  return request<DeckJob>(`/deck-jobs/${jobId}/advance`, { method: 'POST' })
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

/** POST 页面问答（非流式）：拿到完整回答后一次性回调。HTTP 错误抛 ApiError。 */
export async function streamPageMessage(
  deckId: number,
  pageId: number,
  payload: PageMessagePayload,
  handlers: PageMessageStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const result = await request<{ message_id: number; content: string; refs: PageMessageRef[] }>(
    `/decks/${deckId}/pages/${pageId}/messages`,
    { method: 'POST', body: payload, signal },
  )
  handlers.onDelta(result.content)
  handlers.onDone({ message_id: result.message_id, refs: result.refs ?? [] })
}