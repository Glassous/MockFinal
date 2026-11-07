<script setup lang="ts">
import { computed } from 'vue'
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Loader2,
} from 'lucide-vue-next'
import { DECK_STATUS_LABELS, JOB_STATUS_LABELS, PAGE_STATUS_LABELS } from '@/lib/deck'

const props = defineProps<{
  kind?: 'deck' | 'page' | 'job'
  status: string
}>()

const label = computed(() => {
  if (props.kind === 'page') {
    return PAGE_STATUS_LABELS[props.status as keyof typeof PAGE_STATUS_LABELS] ?? props.status
  }
  if (props.kind === 'job') {
    return JOB_STATUS_LABELS[props.status as keyof typeof JOB_STATUS_LABELS] ?? props.status
  }
  return DECK_STATUS_LABELS[props.status as keyof typeof DECK_STATUS_LABELS] ?? props.status
})

const config = computed(() => {
  switch (props.status) {
    case 'ready':
    case 'done':
      return {
        icon: CheckCircle2,
        cls: 'border-transparent bg-invert text-invert-ink',
        spin: false,
      }
    case 'planning':
    case 'building':
    case 'validating':
    case 'pending':
      return { icon: Loader2, cls: 'border-border bg-raised text-ink', spin: true }
    case 'partial':
      return { icon: CircleDot, cls: 'border-border-strong bg-panel text-ink', spin: false }
    case 'failed':
      return { icon: AlertCircle, cls: 'border-border-strong bg-panel text-ink', spin: false }
    case 'canceled':
      return { icon: Ban, cls: 'border-border bg-panel text-muted', spin: false }
    default:
      return { icon: CircleDashed, cls: 'border-border bg-panel text-muted', spin: false }
  }
})
</script>

<template>
  <span
    class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium"
    :class="config.cls"
  >
    <component :is="config.icon" class="h-3.5 w-3.5" :class="config.spin ? 'spin' : ''" />
    {{ label }}
  </span>
</template>