import { describe, expect, it } from 'vitest'
import { formatBytes } from './format'

describe('formatBytes', () => {
  it('处理空值与 0', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-1)).toBe('0 B')
  })

  it('按 1024 进制格式化', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB')
  })
})
