import type { Row } from './db.ts'

/** 每块送入模型的原始资料字符数；块间保留重叠，避免切断跨段公式。 */
export const CORPUS_CHUNK_CHARS = 20_000
export const CORPUS_CHUNK_OVERLAP = 400

export interface CorpusSection {
  id: number
  heading: string
  content: string
}

export interface CorpusMaterial {
  id: number
  filename: string
  text: string
  spans: Array<{ id: number; start: number; end: number }>
}

export interface CorpusChunk {
  index: number
  materialId: number
  filename: string
  from: number
  to: number
  sectionIds: number[]
  text: string
}

export async function loadCorpus(workspaceId: number): Promise<CorpusMaterial[]> {
  // 延迟加载，保持 chunkCorpus 可在无数据库注入的本地单测中直接使用
  const { num, selectRows, str } = await import('./db.ts')
  const materials = await selectRows<Row>('materials', 'id,filename', [
    ['workspace_id', workspaceId],
    ['status', 'indexed'],
  ], { order: 'created_at' })
  const result: CorpusMaterial[] = []
  for (const material of materials) {
    const id = num(material.id)
    const sections = await selectRows<Row>('material_sections', 'id,heading,content', [
      ['material_id', id],
    ], { order: 'ordinal' })
    let text = ''
    const spans: CorpusMaterial['spans'] = []
    for (const section of sections) {
      const heading = str(section.heading).trim()
      const body = str(section.content).trim()
      const piece = `${heading ? `## ${heading}\n` : ''}${body}`
      if (!piece) continue
      if (text) text += '\n\n'
      const start = text.length
      text += piece
      spans.push({ id: num(section.id), start, end: text.length })
    }
    if (text.trim()) {
      result.push({ id, filename: str(material.filename, `资料#${id}`), text, spans })
    }
  }
  return result
}

export function chunkCorpus(materials: CorpusMaterial[]): CorpusChunk[] {
  const chunks: CorpusChunk[] = []
  for (const material of materials) {
    if (!material.text.trim()) continue
    let start = 0
    while (start < material.text.length) {
      const end = Math.min(start + CORPUS_CHUNK_CHARS, material.text.length)
      const sectionIds = material.spans
        .filter((span) => span.start < end && span.end > start)
        .map((span) => span.id)
      chunks.push({
        index: chunks.length,
        materialId: material.id,
        filename: material.filename,
        from: start,
        to: end,
        sectionIds,
        text: material.text.slice(start, end),
      })
      if (end >= material.text.length) break
      start = end - CORPUS_CHUNK_OVERLAP
    }
  }
  return chunks
}

export function chunkSourceLabel(chunk: CorpusChunk): string {
  const ids = chunk.sectionIds.length ? chunk.sectionIds.map((id) => `§${id}`).join(' ') : '§?'
  return `《${chunk.filename}》${ids}`
}
