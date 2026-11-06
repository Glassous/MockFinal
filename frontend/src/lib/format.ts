/** 字节数格式化为易读大小 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

function toDate(input: string): Date {
  const d = new Date(input)
  return Number.isNaN(d.getTime()) ? new Date() : d
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** YYYY-MM-DD HH:mm */
export function formatDateTime(iso: string): string {
  const d = toDate(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

/** 相对时间（刚刚 / x 分钟前 / x 小时前 / x 天前 / 日期） */
export function formatRelative(iso: string): string {
  const d = toDate(iso)
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
