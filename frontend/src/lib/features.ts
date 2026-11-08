/**
 * Serverless 版本的功能开关。
 *
 * Deck 构建依赖常驻的 Builder / Validator 与流式 SSE，Serverless 版本暂不提供；
 * 后端对应接口分别返回 503 / 501，前端据此隐藏入口。
 */
export const FEATURES = {
  deckBuild: false,
  deckChat: false,
} as const
