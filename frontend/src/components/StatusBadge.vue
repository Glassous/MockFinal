<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle2, Loader2, AlertCircle, Clock } from 'lucide-vue-next'
import type { MaterialStatus } from '@/types'

const props = defineProps<{ status: MaterialStatus }>()

const config = computed(() => {
  switch (props.status) {
    case 'indexed':
      return {
        label: '已就绪',
        icon: CheckCircle2,
        cls: 'border-transparent bg-invert text-invert-ink',
        spin: false,
      }
    case 'indexing':
      return {
        label: '解析中',
        icon: Loader2,
        cls: 'border-border bg-raised text-ink',
        spin: true,
      }
    case 'failed':
      return {
        label: '失败',
        icon: AlertCircle,
        cls: 'border-border-strong bg-panel text-ink',
        spin: false,
      }
    default:
      return {
        label: '排队中',
        icon: Clock,
        cls: 'border-border bg-panel text-muted',
        spin: false,
      }
  }
})
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap"
    :class="config.cls"
  >
    <component :is="config.icon" class="h-3.5 w-3.5" :class="config.spin ? 'spin' : ''" />
    {{ config.label }}
  </span>
</template>
