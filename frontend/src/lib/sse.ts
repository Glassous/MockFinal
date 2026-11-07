export interface SseEvent {
  event: string
  data: string
}

/**
 * 增量 SSE 解析器：跨 chunk 维护缓冲区，支持 CRLF、多行 data 与注释行。
 * 返回工厂函数，每次喂入文本返回本次完整事件（可能 0 个或多个）。
 */
export function createSseParser(): (chunk: string) => SseEvent[] {
  let buffer = ''
  return (chunk: string) => {
    buffer = (buffer + chunk).replace(/\r\n/g, '\n')
    const events: SseEvent[] = []
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const dataLines: string[] = []
      let eventName = 'message'
      for (const line of block.split('\n')) {
        if (!line || line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon >= 0 ? line.slice(0, colon) : line
        let value = colon >= 0 ? line.slice(colon + 1) : ''
        if (value.startsWith(' ')) value = value.slice(1)
        if (field === 'event') eventName = value
        else if (field === 'data') dataLines.push(value)
      }
      if (dataLines.length) events.push({ event: eventName, data: dataLines.join('\n') })
      boundary = buffer.indexOf('\n\n')
    }
    return events
  }
}