import { HttpError } from './errors.ts'
import { parseJsonObject } from './json.ts'
import { chatDetailed, type LlmOptions } from './llm.ts'

type Validator = (value: unknown) => string | null

/**
 * 调用模型并解析 JSON；解析或结构不合法时最多纠正两次。
 * 输出因 token 上限被截断时自动提高上限并提示精简，仍失败按任务失败处理。
 */
export async function chatJson(
  system: string,
  user: string,
  options: LlmOptions = {},
  validate?: Validator,
): Promise<unknown> {
  let prompt = user
  let reason = ''
  let maxTokens = options.maxTokens ?? 4096
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await chatDetailed(
      [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.2, ...options, maxTokens },
    )
    const parsed = parseJsonObject(result.content)
    if (parsed.ok) {
      const problem = validate ? validate(parsed.value) : null
      if (!problem) return parsed.value
      reason = problem
    } else {
      reason = parsed.reason
    }
    console.error('llm_json_invalid', {
      attempt,
      reason: reason.slice(0, 160),
      finishReason: result.finishReason,
      length: result.content.length,
    })
    const truncated = result.finishReason === 'length'
    if (truncated) maxTokens = Math.min(8192, maxTokens * 2)
    const hint = truncated
      ? '上一次输出因长度上限被截断。请精简内容，减少条目数量，确保 JSON 完整闭合。'
      : `上一次输出不符合要求（${reason}）。请修正后只输出严格 JSON，不要任何解释。`
    prompt = `${user}\n\n注意：${hint}`
  }
  throw new HttpError(500, `模型输出格式不符合要求：${reason.slice(0, 120)}`)
}
