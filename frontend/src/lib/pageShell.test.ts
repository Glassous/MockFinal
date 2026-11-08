import { describe, expect, it } from 'vitest'
import type { PageBundle } from '@/types'
import {
  ShellBuildError,
  buildPageShell,
  createChannel,
  describeShellError,
} from './pageShell'

function bundle(partial: Partial<PageBundle> = {}): PageBundle {
  return {
    schema_version: '1.0',
    runtime_version: '1.0.0',
    manifest: { page_id: 'page_test', title: '测试页' },
    html: '<div class="mp-page"><h1>测试</h1></div>',
    css: '.mp-page { color: #111; }',
    js: "MockFinal.ready({ title: '测试' });",
    ...partial,
  }
}

describe('pageShell', () => {
  it('创建 32 位十六进制 channel', () => {
    expect(createChannel()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('组装 shell 包含 CSP、runtime 与独立 channel', () => {
    const shell = buildPageShell(bundle(), 'dark')
    expect(shell.channel).toMatch(/^[0-9a-f]{32}$/)
    expect(shell.html).toContain('connect-src \'none\'')
    expect(shell.html).toContain('data-mp-theme="dark"')
    expect(shell.html).toContain(shell.channel)
    expect(shell.html).toContain('window.MockFinal')
  })

  it('拒绝破坏 shell 的 html 序列', () => {
    try {
      buildPageShell(bundle({ html: '<div></script></div>' }), 'light')
      throw new Error('应当拒绝')
    } catch (error) {
      expect(error).toBeInstanceOf(ShellBuildError)
      expect((error as ShellBuildError).code).toBe('SHELL_ESCAPE_SEQUENCE')
      expect(describeShellError(error)).toContain('不安全的标签序列')
    }
  })

  it('拒绝运行时版本不一致的 bundle', () => {
    try {
      buildPageShell(bundle({ runtime_version: '9.9.9' }), 'light')
      throw new Error('应当拒绝')
    } catch (error) {
      expect(error).toBeInstanceOf(ShellBuildError)
      expect((error as ShellBuildError).code).toBe('RUNTIME_VERSION_MISMATCH')
      expect((error as ShellBuildError).message).toContain('1.0.0 / 1.1.0 之一')
    }
  })
})