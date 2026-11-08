export const SECTION_CHUNK_SIZE = 1200
export const SECTION_CHUNK_OVERLAP = 100
export const SECTION_SEPARATORS = ['\n\n', '\n', '。', '；', '.', ';', ' ', '']

export interface SectionDocument {
  heading: string
  content: string
  headingLevel: number
}

export interface SectionPayload {
  heading: string
  content: string
  char_count: number
  page: number | null
  meta: {
    source: string
    heading_level: number
    part: number
    parts: number
  }
}

function splitKeepingSeparator(text: string, separator: string): string[] {
  if (separator === '') return Array.from(text)
  const parts = text.split(separator)
  return parts.map((part, index) => (index < parts.length - 1 ? part + separator : part))
}

function splitUnits(text: string, separators: string[]): string[] {
  for (let index = 0; index < separators.length; index += 1) {
    const separator = separators[index]
    if (separator !== '' && !text.includes(separator)) continue
    const pieces = splitKeepingSeparator(text, separator)
    if (pieces.length <= 1 && separator !== '') continue
    const units: string[] = []
    for (const piece of pieces) {
      if (piece.length <= SECTION_CHUNK_SIZE) {
        units.push(piece)
      } else {
        units.push(...splitUnits(piece, separators.slice(index + 1)))
      }
    }
    return units
  }
  return [text]
}

function mergeUnits(units: string[]): string[] {
  const chunks: string[] = []
  let current = ''
  for (const unit of units) {
    if (current.length === 0) {
      current = unit
      continue
    }
    if (current.length + unit.length <= SECTION_CHUNK_SIZE) {
      current += unit
    } else {
      chunks.push(current)
      current = unit
    }
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

export function splitText(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return []
  if (normalized.length <= SECTION_CHUNK_SIZE) return [normalized]
  const units = splitUnits(normalized, SECTION_SEPARATORS)
  const chunks = mergeUnits(units)
  return chunks.map((chunk, index) => {
    if (index === 0) return chunk.trim()
    const previous = chunks[index - 1]
    const overlap = previous.slice(-SECTION_CHUNK_OVERLAP)
    return `${overlap}${chunk}`.trim()
  }).filter((chunk) => chunk.length > 0)
}

/** Markdown 按标题切文档；纯文本作为单文档（与原解析器「不跨节合并」的语义一致）。 */
export function documentsFromText(filename: string, text: string, isMarkdown: boolean): SectionDocument[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  const base = filename.replace(/\.[^.]+$/, '') || filename
  if (!isMarkdown) {
    return normalized.trim() ? [{ heading: base, content: normalized, headingLevel: 0 }] : []
  }

  const lines = normalized.split('\n')
  const documents: SectionDocument[] = []
  let heading = base
  let headingLevel = 0
  let buffer: string[] = []

  const flush = () => {
    const content = buffer.join('\n').trim()
    if (content) documents.push({ heading, content, headingLevel })
    buffer = []
  }

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (match) {
      flush()
      heading = match[2].trim().slice(0, 255)
      headingLevel = match[1].length
      continue
    }
    buffer.push(line)
  }
  flush()

  if (documents.length === 0) {
    const content = normalized.trim()
    return content ? [{ heading: base, content, headingLevel: 0 }] : []
  }
  return documents
}

export function sectionPayloads(
  filename: string,
  text: string,
  isMarkdown: boolean,
): SectionPayload[] {
  const documents = documentsFromText(filename, text, isMarkdown)
  const payloads: SectionPayload[] = []
  for (const document of documents) {
    const pieces = splitText(document.content)
    const total = pieces.length
    pieces.forEach((piece, index) => {
      payloads.push({
        heading: document.heading.slice(0, 255),
        content: piece,
        char_count: piece.length,
        page: null,
        meta: {
          source: filename,
          heading_level: document.headingLevel,
          part: index + 1,
          parts: total,
        },
      })
    })
  }
  return payloads
}
