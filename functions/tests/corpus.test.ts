import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CORPUS_CHUNK_CHARS,
  CORPUS_CHUNK_OVERLAP,
  chunkCorpus,
  chunkSourceLabel,
  type CorpusMaterial,
} from '../lib/corpus.ts'

function material(id: number, text: string): CorpusMaterial {
  return {
    id,
    filename: `m${id}.md`,
    text,
    spans: [{ id: id * 10, start: 0, end: text.length }],
  }
}

test('分块覆盖全文且不留空隙', () => {
  const text = '甲'.repeat(CORPUS_CHUNK_CHARS * 2 + 123)
  const chunks = chunkCorpus([material(1, text)])
  assert.equal(chunks.length, 3)

  const covered = new Uint8Array(text.length)
  let expectedFrom = 0
  for (const chunk of chunks) {
    assert.equal(chunk.from, expectedFrom)
    assert.ok(chunk.to > chunk.from)
    assert.ok(chunk.to - chunk.from <= CORPUS_CHUNK_CHARS)
    assert.equal(chunk.text, text.slice(chunk.from, chunk.to))
    covered.fill(1, chunk.from, chunk.to)
    expectedFrom = chunk.to - CORPUS_CHUNK_OVERLAP
  }

  assert.equal(chunks[chunks.length - 1].to, text.length)
  assert.ok(covered.every((value) => value === 1), '全文每个字符都应至少出现在一块中')
  assert.equal(chunks[0].from, 0)
  assert.equal(chunks[1].from, CORPUS_CHUNK_CHARS - CORPUS_CHUNK_OVERLAP)
})

test('多份资料按顺序分块并携带来源', () => {
  const chunks = chunkCorpus([material(1, 'A'.repeat(30_000)), material(2, 'B'.repeat(100))])
  assert.equal(chunks[0].materialId, 1)
  assert.equal(chunks[chunks.length - 1].materialId, 2)
  assert.ok(chunkSourceLabel(chunks[0]).includes('§10'))
})

test('空资料不产生分块', () => {
  assert.deepEqual(chunkCorpus([material(1, '   ')]), [])
})
