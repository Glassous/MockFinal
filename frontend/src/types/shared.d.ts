declare module '@shared/page-shell/shell.mjs' {
  import type { PageBundle } from '@/types'

  export const SUPPORTED_RUNTIME_VERSION: string
  export const BUNDLE_SCHEMA_VERSION: string
  export const MAX_BUNDLE_BYTES: number
  export const CSP_CONTENT: string

  export class ShellBuildError extends Error {
    code: string
    constructor(code: string, message: string)
  }

  export function buildShell(input: {
    bundle: PageBundle
    runtimeSource: string
    channel: string
    theme?: 'light' | 'dark'
  }): string

  export function escapeForScript(source: string): string
  export function escapeForStyle(source: string): string
}