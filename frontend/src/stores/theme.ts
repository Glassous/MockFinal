import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { applyHighlightTheme } from '@/lib/highlight'

export type Theme = 'light' | 'dark'
const THEME_KEY = 'theme'

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const useThemeStore = defineStore('theme', () => {
  const theme = ref<Theme>(getInitialTheme())
  const isDark = computed(() => theme.value === 'dark')

  function apply(value: Theme): void {
    const root = document.documentElement
    root.classList.toggle('dark', value === 'dark')
    applyHighlightTheme(value === 'dark')
  }

  function setTheme(value: Theme): void {
    theme.value = value
    localStorage.setItem(THEME_KEY, value)
    apply(value)
  }

  function toggle(): void {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  // 初始化：与 index.html 内联脚本保持一致，并挂载代码高亮主题
  apply(theme.value)

  // 用户未手动选择时跟随系统深浅色
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', (event) => {
    if (!localStorage.getItem(THEME_KEY)) {
      theme.value = event.matches ? 'dark' : 'light'
      apply(theme.value)
    }
  })

  return { theme, isDark, setTheme, toggle }
})
