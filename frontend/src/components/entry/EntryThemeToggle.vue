<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { Moon, Sun } from 'lucide-vue-next'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()
const { isDark } = storeToRefs(themeStore)
</script>

<template>
  <button
    type="button"
    class="e-icon-btn"
    :aria-label="isDark ? '切换到浅色模式' : '切换到深色模式'"
    :title="isDark ? '切换到浅色模式' : '切换到深色模式'"
    @click="themeStore.toggle()"
  >
    <Transition name="e-icon" mode="out-in">
      <Moon v-if="isDark" key="moon" :size="16" :stroke-width="1.8" />
      <Sun v-else key="sun" :size="16" :stroke-width="1.8" />
    </Transition>
  </button>
</template>

<style scoped>
.e-icon-enter-active,
.e-icon-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.e-icon-enter-from {
  opacity: 0;
  transform: rotate(-40deg) scale(0.7);
}

.e-icon-leave-to {
  opacity: 0;
  transform: rotate(40deg) scale(0.7);
}
</style>
