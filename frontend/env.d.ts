/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

// highlight.js 常用语言子集（约 35 种），显著减小打包体积；官方未提供该子路径的类型声明，此处补齐
declare module 'highlight.js/lib/common' {
  const hljs: typeof import('highlight.js').default
  export default hljs
}
