import {
  BUNDLE_SCHEMA_VERSION,
  MAX_BUNDLE_BYTES,
  SUPPORTED_RUNTIME_VERSION,
  ShellBuildError,
  buildShell,
} from '@shared/page-shell/shell.mjs'
import runtimeSource from '@shared/page-runtime/runtime.js?raw'
import type { PageBundle } from '@/types'

export {
  BUNDLE_SCHEMA_VERSION,
  MAX_BUNDLE_BYTES,
  SUPPORTED_RUNTIME_VERSION,
  ShellBuildError,
}

/** 每次 iframe 独立的 32 位十六进制 channel；不复用，也不写入全局。 */
export function createChannel(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface PageShell {
  html: string
  channel: string
}

/**
 * 组装沙箱页面 shell。失败时抛 ShellBuildError（含契约失败码），
 * 阅读器必须展示错误卡片，不得静默渲染半成品。
 */
export function buildPageShell(
  bundle: PageBundle,
  theme: 'light' | 'dark',
): PageShell {
  const channel = createChannel()
  const html = buildShell({ bundle, runtimeSource, channel, theme })
  return { html, channel }
}

export function describeShellError(error: unknown): string {
  if (error instanceof ShellBuildError) {
    switch (error.code) {
      case 'BUNDLE_TOO_LARGE':
        return '页面内容超过 2 MiB 上限，无法安全渲染'
      case 'RUNTIME_VERSION_MISMATCH':
        return '页面运行时版本与阅读器不一致，请重新生成该页面'
      case 'SHELL_ESCAPE_SEQUENCE':
        return '页面包含不安全的标签序列，已被拒绝渲染'
      case 'BUNDLE_SCHEMA_INVALID':
        return '页面数据结构不合法，请重新生成该页面'
      default:
        return error.message || '页面组装失败'
    }
  }
  return error instanceof Error ? error.message : '页面组装失败'
}