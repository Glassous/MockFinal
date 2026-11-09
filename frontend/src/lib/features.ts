/**
 * Serverless 版本的功能开关。
 *
 * 资料生成、复习页构建与页面问答全部由 Edge Function 承担，
 * 客户端通过 advance 接口驱动长任务。
 */
export const FEATURES = {
  deckBuild: true,
  deckChat: true,
} as const
