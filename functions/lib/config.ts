const runtime = globalThis as typeof globalThis & {
  Deno?: { env?: { get(name: string): string | undefined } }
}

export function env(name: string): string {
  try {
    return runtime.Deno?.env?.get(name)?.trim() ?? ''
  } catch {
    return ''
  }
}

function intEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(env(name), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const config = {
  get jwtSecret(): string {
    return env('JWT_SECRET') || 'dev-only-insecure-secret-change-me'
  },
  accessTokenMinutes: 60 * 24 * 7,
  resetTokenMinutes: 10,
  verifyWindowSeconds: 15 * 60,
  verifyMaxFailures: 5,

  get llmApiKey(): string {
    return env('LLM_API_KEY')
  },
  get llmConfigured(): boolean {
    return Boolean(this.llmApiKey)
  },
  get llmBaseUrl(): string {
    return env('LLM_BASE_URL') || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  },
  get llmModel(): string {
    return env('LLM_MODEL') || 'qwen-plus'
  },
  /** DashScope 兼容模式支持 response_format 与关闭思考。 */
  get llmJsonModeSupported(): boolean {
    return /dashscope|aliyuncs\.com/i.test(this.llmBaseUrl)
  },
  get llmTimeoutMs(): number {
    return intEnv('LLM_TIMEOUT_SECONDS', 45) * 1000
  },
  get llmMaxOutputTokens(): number {
    return intEnv('LLM_MAX_OUTPUT_TOKENS', 4096)
  },

  get materialMaxBytes(): number {
    return intEnv('MATERIAL_MAX_BYTES', 8 * 1024 * 1024)
  },
  maxUploadUrlTtl: 900,
  downloadUrlTtl: 300,
  requestJsonLimit: 256 * 1024,
  /** 生成结果只读回传全文；md 文本远小于该上限。 */
  artifactMaxBytes: 4 * 1024 * 1024,
}

export const ALLOWED_MATERIAL_EXTENSIONS = ['.md', '.txt'] as const
