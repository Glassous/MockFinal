/**
 * 所有业务接口的统一前缀。
 *
 * Qoder Sites 只提供一个逻辑函数 `app`，平台保留 `/api` 等路径，因此生产环境
 * 走 `/functions/v1/app/api`。本地开发默认仍指向旧 FastAPI（vite 代理 /api）；
 * 调试线上函数时用 `VITE_API_BASE` 覆盖。
 */
const raw = import.meta.env.VITE_API_BASE as string | undefined
const override = raw?.trim()

export const API_BASE = override || (import.meta.env.PROD ? '/functions/v1/app/api' : '/api')
