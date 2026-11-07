import { describe, expect, it } from 'vitest'
import { createSseParser } from './sse'

describe('createSseParser', () => {
  it('解析单个事件并容忍分块', () => {
    const parse = createSseParser()
    expect(parse('event: delta\ndata: {"te')).toEqual([])
    const events = parse('xt":"你好"}\n\n')
    expect(events).toEqual([{ event: 'delta', data: '{"text":"你好"}' }])
  })

  it('一次输入解析多个事件', () => {
    const parse = createSseParser()
    const events = parse(
      'event: delta\ndata: {"text":"a"}\n\nevent: done\ndata: {"message_id":1}\n\n',
    )
    expect(events.map((item) => item.event)).toEqual(['delta', 'done'])
    expect(events[1].data).toBe('{"message_id":1}')
  })

  it('支持 CRLF、多行 data 与注释行', () => {
    const parse = createSseParser()
    const events = parse(': keepalive\r\nevent: delta\r\ndata: line1\r\ndata: line2\r\n\r\n')
    expect(events).toEqual([{ event: 'delta', data: 'line1\nline2' }])
  })

  it('忽略没有 data 的事件块', () => {
    const parse = createSseParser()
    expect(parse('event: ping\n\n')).toEqual([])
  })
})