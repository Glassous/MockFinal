/**
 * 所有业务接口的统一前缀。
 *
 * Qoder Sites 只提供一个逻辑函数 `app`，函数路由直接挂在
 * `/functions/v1/app` 下。本地开发用 `VITE_API_BASE` 指向已发布站点或线上函数。
 */
const raw = import.meta.env.VITE_API_BASE as string | undefined
const override = raw?.trim()

export const API_BASE = override || '/functions/v1/app'
