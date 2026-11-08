import { config } from './config.ts'
import { HttpError } from './errors.ts'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmOptions {
  temperature?: number
  maxTokens?: number
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

async function requestOnce(messages: LlmMessage[], options: LlmOptions): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.llmTimeoutMs)
  try {
    const response = await fetch(`${config.llmBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: config.llmModel,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? config.llmMaxOutputTokens,
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300)
      const error = new Error(`llm_http_${response.status}: ${detail}`) as Error & { retryable?: boolean }
      error.retryable = response.status === 429 || response.status >= 500
      throw error
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = textOfContent(payload.choices?.[0]?.message?.content).trim()
    if (!content) throw new Error('llm_empty_response')
    return content
  } finally {
    clearTimeout(timer)
  }
}

export async function chat(messages: LlmMessage[], options: LlmOptions = {}): Promise<string> {
  if (!config.llmConfigured) {
    throw new HttpError(400, '未配置 LLM 服务（缺少 LLM_API_KEY），无法生成复习资料')
  }
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await requestOnce(messages, options)
    } catch (error) {
      lastError = error
      const retryable = (error as { retryable?: boolean } | null)?.retryable
        || error instanceof TypeError
        || (error instanceof Error && error.name === 'AbortError')
      if (!retryable || attempt === 2) break
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)))
    }
  }
  console.error('llm_request_failed', {
    error: lastError instanceof Error ? lastError.message.slice(0, 300) : String(lastError),
  })
  throw new HttpError(502, 'AI 服务调用失败，请稍后重试')
}
