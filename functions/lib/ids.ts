let counter = Math.floor(Math.random() * 4096)

/**
 * 生成 64 位以下的安全整数 ID（< 2^53，Postgres bigint 可直接接收）。
 * 高位为毫秒时间戳，低位为进程内递增序列，保证同毫秒批量生成不重复。
 */
export function newId(): number {
  counter = (counter + 1) & 0xfff
  return Date.now() * 4096 + counter
}

/** 一次性预留一段连续 ID（用于分节批量写入，避免逐条随机碰撞）。 */
export function newIdBlock(count: number): number[] {
  const size = Math.max(1, Math.min(count, 4000))
  counter = (counter + size) & 0xfff
  const base = Date.now() * 4096 + counter - size
  const ids: number[] = []
  for (let index = 0; index < count; index += 1) {
    ids.push(index < size ? base + index : newId())
  }
  return ids
}

export function newUuid(): string {
  return crypto.randomUUID()
}
