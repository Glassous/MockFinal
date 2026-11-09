export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string }

function stripFence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced ? fenced[1].trim() : raw
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 从 start 开始按字符串/转义感知扫描，返回第一个完整闭合的外层对象结尾下标。 */
function scanBalanced(text: string, start: number): number | null {
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') stack.push('}')
    else if (char === '[') stack.push(']')
    else if (char === '}' || char === ']') {
      if (stack.pop() !== char) return null
      if (stack.length === 0) return index
    }
  }
  return null
}

/** 尝试把被截断的片段补成合法 JSON：闭合字符串与容器，返回候选文本。 */
function renderClosed(text: string): string | null {
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') stack.push('}')
    else if (char === '[') stack.push(']')
    else if (char === '}' || char === ']') {
      if (stack.pop() !== char) return null
    }
  }
  let out = text
  if (inString) out += '"'
  out = out.replace(/,\s*$/, '').replace(/:\s*$/, '')
  for (let index = stack.length - 1; index >= 0; index -= 1) out += stack[index]
  return out
}

/** 截断输出救援：从尾部逐段回退到最近的逗号，直到补全后能解析出对象。 */
function salvageObject(text: string): unknown {
  let cut = text.length
  for (let attempt = 0; attempt < 32 && cut > 0; attempt += 1) {
    const closed = renderClosed(text.slice(0, cut))
    if (closed) {
      const value = tryParse(closed)
      if (value && typeof value === 'object' && !Array.isArray(value)) return value
    }
    const comma = text.lastIndexOf(',', cut - 1)
    if (comma <= 0) break
    cut = comma
  }
  return null
}

export function parseJsonObject(text: string): JsonParseResult {
  const raw = String(text ?? '').trim()
  if (!raw) return { ok: false, reason: '模型返回为空' }
  const body = stripFence(raw)
  const start = body.indexOf('{')
  if (start < 0) return { ok: false, reason: '未找到 JSON 对象' }
  const end = scanBalanced(body, start)
  if (end !== null) {
    const value = tryParse(body.slice(start, end + 1))
    if (value && typeof value === 'object' && !Array.isArray(value)) return { ok: true, value }
    if (Array.isArray(value)) return { ok: false, reason: 'JSON 顶层必须是对象' }
    return { ok: false, reason: 'JSON 解析失败' }
  }
  const salvaged = salvageObject(body.slice(start))
  if (salvaged) return { ok: true, value: salvaged }
  return { ok: false, reason: 'JSON 不完整或无法解析' }
}

export function parseJsonArray(text: string): JsonParseResult {
  const raw = String(text ?? '').trim()
  if (!raw) return { ok: false, reason: '模型返回为空' }
  const body = stripFence(raw)
  const start = body.indexOf('[')
  if (start < 0) return { ok: false, reason: '未找到 JSON 数组' }
  const end = scanBalanced(body, start)
  if (end !== null) {
    const value = tryParse(body.slice(start, end + 1))
    if (Array.isArray(value)) return { ok: true, value }
  }
  return { ok: false, reason: 'JSON 数组不完整或无法解析' }
}
