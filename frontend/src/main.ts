import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { setUnauthorizedHandler } from './api/client'
import { useAuthStore } from './stores/auth'
import { useThemeStore } from './stores/theme'

// KaTeX 公式样式（全局，主题无关）
import 'katex/dist/katex.min.css'
// 项目主题与语义 token（须在 katex 之后，便于必要覆盖）
import './style.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

// 初始化主题 store：应用 html.dark 并挂载代码高亮主题 link（与 index.html 内联脚本一致）
useThemeStore()

// 全局 401 处理：清除 token 并跳转登录
setUnauthorizedHandler(() => {
  useAuthStore().logout()
  if (router.currentRoute.value.name !== 'login') {
    router.replace({ name: 'login' })
  }
})

app.mount('#app')
