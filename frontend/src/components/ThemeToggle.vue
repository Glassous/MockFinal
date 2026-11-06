<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { Sun, Moon } from 'lucide-vue-next'
import { useThemeStore } from '@/stores/theme'

withDefaults(defineProps<{ size?: 'sm' | 'md' }>(), { size: 'md' })

const themeStore = useThemeStore()
const { isDark } = storeToRefs(themeStore)
</script>

<template>
  <button
    type="button"
    class="group relative inline-flex items-center justify-center overflow-hidden rounded-full border border-border bg-panel text-ink transition-colors duration-150 hover:border-border-strong hover:bg-raised"
    :class="size === 'sm' ? 'h-8 w-8' : 'h-9 w-9'"
    :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
    :title="isDark ? '切换到浅色模式' : '切换到深色模式'"
    @click="themeStore.toggle()"
  >
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 -rotate-90 scale-50"
      enter-to-class="opacity-100 rotate-0 scale-100"
      leave-active-class="transition duration-150 ease-in absolute"
      leave-from-class="opacity-100 rotate-0 scale-100"
      leave-to-class="opacity-0 rotate-90 scale-50"
    >
      <Sun v-if="!isDark" key="sun" :class="size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]'" />
      <Moon v-else key="moon" :class="size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]'" />
    </transition>
  </button>
</template>
