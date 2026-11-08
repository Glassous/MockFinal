import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SECTION_CHUNK_SIZE, documentsFromText, sectionPayloads, splitText } from '../lib/section.ts'

test('短文本保持单节', () => {
  assert.deepEqual(splitText('hello world'), ['hello world'])
  assert.deepEqual(splitText('   '), [])
})

test('长文本按上限切分并带重叠', () => {
  const paragraph = '这是一个用于测试切分行为的段落。'.repeat(40)
  const text = Array.from({ length: 6 }, () => paragraph).join('\n\n')
  const chunks = splitText(text)
  assert.ok(chunks.length > 1)
  for (const chunk of chunks) assert.ok(chunk.length <= SECTION_CHUNK_SIZE + 120)
})

test('CRLF 归一化', () => {
  assert.deepEqual(splitText('a\r\nb'), ['a\nb'])
})

test('markdown 按标题切文档', () => {
  const docs = documentsFromText('notes.md', '# 第一章\n内容 A\n## 第二节\n内容 B', true)
  assert.equal(docs.length, 2)
  assert.equal(docs[0].heading, '第一章')
  assert.equal(docs[0].content, '内容 A')
  assert.equal(docs[1].heading, '第二节')
  assert.equal(docs[1].headingLevel, 2)
})

test('纯文本以文件名作为标题', () => {
  const docs = documentsFromText('lecture.txt', '正文', false)
  assert.deepEqual(docs, [{ heading: 'lecture', content: '正文', headingLevel: 0 }])
})

test('sectionPayloads 生成有序分节与 meta', () => {
  const payloads = sectionPayloads('notes.md', '# A\nx\n# B\ny', true)
  assert.equal(payloads.length, 2)
  assert.equal(payloads[0].meta.source, 'notes.md')
  assert.equal(payloads[0].meta.part, 1)
  assert.equal(payloads[0].meta.parts, 1)
  assert.equal(payloads[1].heading, 'B')
  assert.equal(payloads[1].page, null)
})
