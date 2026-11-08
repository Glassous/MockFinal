import { num, selectRows, str, type Row } from './db.ts'

/** 与旧后端 compute_source_signature 相同的摘要：按 (material_id, id) 排序后对 id+content 求 sha256。 */
export async function workspaceSourceSignature(workspaceId: number): Promise<string> {
  const sections = await selectRows<Row>('material_sections', 'material_id,id,content', [
    ['workspace_id', workspaceId],
  ])
  const entries = sections
    .map((row) => [num(row.material_id), num(row.id), str(row.content)] as const)
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
  const parts: string[] = []
  for (const [, sectionId, content] of entries) parts.push(`${sectionId}\x1f${content}\x1f`)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('')))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
