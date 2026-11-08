import { HttpError } from './errors.ts'

const decoder = new TextDecoder('utf-8')

/** 解码文本并做粗粒度二进制检测，避免把图片等误当 md/txt 建索引。 */
export function decodeTextFile(filename: string, bytes: Uint8Array): string {
  if (bytes.byteLength === 0) throw new HttpError(400, '文件内容为空')
  const text = decoder.decode(bytes).replace(/^\uFEFF/, '')
  if (!text.trim()) throw new HttpError(400, `《${filename}》内容为空，无法建立资料索引`)

  let control = 0
  const sample = Math.min(text.length, 4096)
  for (let index = 0; index < sample; index += 1) {
    const code = text.charCodeAt(index)
    if (code === 9 || code === 10 || code === 13) continue
    if (code < 32 || code === 0xfffd) control += 1
  }
  if (sample > 0 && control / sample > 0.01) {
    throw new HttpError(400, `《${filename}》不是有效的文本文件`)
  }
  return text
}

export function isMarkdownFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.md')
}
