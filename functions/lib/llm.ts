import { config } from './config.ts'
import { HttpError } from './errors.ts'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmOptions {
  temperature?: number
  maxTokens?: number
  /** 要求服务端返回严格 JSON（DashScope 兼容模式支持）。 */
  jsonMode?: boolean
}

export interface LlmResult {
  content: string
  finishReason: string
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block
        if (block && typeof block === 'object' && 'text' in block) {
          return String((block as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .join('')
  }
  return content === null || content === undefined ? '' : String(content)
}

async function requestOnce(messages: LlmMessage[], options: LlmOptions): Promise<LlmResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.llmTimeoutMs)
  const url = `${config.llmBaseUrl.replace(/\/+$/, '')}/chat/completions`
  const send = (body: Record<string, unknown>) => fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.llmApiKey}`,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
  const failed = (status: number, detail: string): Error => {
    const error = new Error(`llm_http_${status}: ${detail.slice(0, 300)}`) as Error & { retryable?: boolean }
    error.retryable = status === 429 || status >= 500
    return error
  }
  try {
    const body: Record<string, unknown> = {
      model: config.llmModel,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? config.llmMaxOutputTokens,
      // 推理型模型的思考 token 会挤占正文，显式关闭；不支持的网关会逐项回退。
      enable_thinking: false,
      thinking: { type: 'disabled' },
    }
    if (config.llmJsonModeSupported && options.jsonMode) {
      body.response_format = { type: 'json_object' }
    }
    // 400 时按顺序剔除网关不识别的扩展参数，保留尽量多的关闭思考开关。
    const removable = ['response_format', 'enable_thinking', 'thinking']
      .filter((key) => body[key] !== undefined)
    let response = await send(body)
    while (!response.ok && response.status === 400 && removable.length > 0) {
      const key = removable.shift() as string
      delete body[key]
      console.error('llm_retry_without_extension', { key })
      response = await send(body)
    }
    if (!response.ok) {
      throw failed(response.status, await response.text().catch(() => ''))
    }
    const payload = (await response.json()) as {
      usage?: unknown
      choices?: Array<{
        message?: { content?: unknown; reasoning_content?: unknown }
        finish_reason?: unknown
      }>
    }
    const choice = payload.choices?.[0]
    const content = textOfContent(choice?.message?.content).trim()
    const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : ''
    if (!content) {
      console.error('llm_empty_content', {
        finishReason,
        hasReasoning: Boolean(choice?.message?.reasoning_content),
        usage: payload.usage ?? null,
      })
      const error = new Error(`llm_empty_response:${finishReason || 'unknown'}`) as Error & {
        retryable?: boolean
        emptyReason?: string
      }
      error.retryable = finishReason === 'length'
      error.emptyReason = finishReason
      throw error
    }
    return { content, finishReason }
  } finally {
    clearTimeout(timer)
  }
}

export async function chatDetailed(messages: LlmMessage[], options: LlmOptions = {}): Promise<LlmResult> {
  if (!config.llmConfigured) {
    throw new HttpError(400, '未配置 LLM 服务（缺少 LLM_API_KEY），无法生成复习资料')
  }
  let current = { ...options }
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await requestOnce(messages, current)
    } catch (error) {
      lastError = error
      const tagged = error as { retryable?: boolean; emptyReason?: string } | null
      const retryable = tagged?.retryable
        || error instanceof TypeError
        || (error instanceof Error && error.name === 'AbortError')
      // 推理 token 吃满预算时提升上限后重试，避免正文为空。
      if (tagged?.emptyReason === 'length') {
        current = {
          ...current,
          maxTokens: Math.min(8192, (current.maxTokens ?? config.llmMaxOutputTokens) * 2),
        }
      }
      if (!retryable || attempt === 2) break
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)))
    }
  }
  console.error('llm_request_failed', {
    error: lastError instanceof Error ? lastError.message.slice(0, 300) : String(lastError),
  })
  if (lastError instanceof Error && lastError.name === 'AbortError') {
    throw new HttpError(502, 'AI 服务响应超时，请稍后重试')
  }
  throw new HttpError(502, 'AI 服务调用失败，请稍后重试')
}

export async function chat(messages: LlmMessage[], options: LlmOptions = {}): Promise<string> {
  return (await chatDetailed(messages, options)).content
}
