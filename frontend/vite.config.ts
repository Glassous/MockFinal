import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // 阅读器与页面 shell 共用同一份源码，避免渲染漂移
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    fs: {
      allow: [fileURLToPath(new URL('..', import.meta.url))],
    },
  },
})
