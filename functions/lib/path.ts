/**
 * 归一化平台可能剥离/保留的 `/functions/v1` 与物理函数名前缀。
 * 返回业务路径（`/health` 等），无法识别的前缀返回 null。
 */
export function normalizePath(pathname: string): string | null {
  let path = pathname.replace(/\/+$/, '') || '/'
  const functionMatch = /^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/.exec(path)
  if (functionMatch) {
    path = functionMatch[1] ?? '/'
  } else if (path === '/api' || path.startsWith('/api/')) {
    path = path.slice(4) || '/'
  } else {
    return null
  }
  if (path === '') return '/'
  return path.startsWith('/') ? path : `/${path}`
}
