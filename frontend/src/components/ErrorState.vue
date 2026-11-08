<script setup lang="ts">
import { AlertCircle } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    title?: string
    message: string
    retryLabel?: string
    retry?: boolean
  }>(),
  { title: '页面暂时无法使用', retryLabel: '重试', retry: true },
)

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="flex flex-col items-center justify-center px-6 py-12 text-center" role="alert">
    <span class="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-raised text-ink">
      <AlertCircle class="h-5 w-5" />
    </span>
    <p class="text-sm font-semibold text-ink">{{ title }}</p>
    <p class="mt-1 max-w-md text-xs leading-relaxed text-muted">{{ message }}</p>
    <div class="mt-4 flex flex-wrap justify-center gap-2">
      <button
        v-if="retry"
        type="button"
        class="inline-flex h-9 items-center rounded-2xl bg-invert px-3.5 text-sm font-medium text-invert-ink transition-opacity hover:opacity-90"
        @click="emit('retry')"
      >
        {{ retryLabel }}
      </button>
      <slot />
    </div>
  </div>
</template>
