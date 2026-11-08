<script setup lang="ts">
import { computed } from 'vue'
import {
  BookOpenCheck,
  GitCompareArrows,
  Lightbulb,
  ListChecks,
  NotebookPen,
  Workflow,
} from 'lucide-vue-next'
import type { TeachingRole } from '@/types'

const props = withDefaults(
  defineProps<{
    role: TeachingRole | null | undefined
    checks?: number | null
    minutes?: number | null
    score?: number | null
    compact?: boolean
  }>(),
  { checks: null, minutes: null, score: null, compact: false },
)

const META: Record<TeachingRole, { label: string; icon: unknown }> = {
  concept: { label: '概念', icon: Lightbulb },
  mechanism: { label: '机制', icon: Workflow },
  worked_example: { label: '例题', icon: NotebookPen },
  practice: { label: '练习', icon: ListChecks },
  compare: { label: '对比', icon: GitCompareArrows },
  summary: { label: '小结', icon: BookOpenCheck },
}

const meta = computed(() => (props.role ? META[props.role] : null))
const detail = computed(() => {
  const parts: string[] = []
  if (props.minutes) parts.push(`${props.minutes} 分钟`)
  if (props.checks) parts.push(`${props.checks} 道检查`)
  if (props.score !== null && props.score !== undefined) parts.push(`教学分 ${props.score}`)
  return parts.join(' · ')
})
</script>

<template>
  <span
    v-if="meta"
    class="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-panel px-2 py-0.5 text-[11px] font-medium text-muted"
    :title="detail || meta.label"
  >
    <component :is="meta.icon" class="h-3 w-3 shrink-0" aria-hidden="true" />
    <span class="shrink-0">{{ meta.label }}</span>
    <span v-if="!compact && detail" class="truncate text-faint">{{ detail }}</span>
  </span>
</template>
