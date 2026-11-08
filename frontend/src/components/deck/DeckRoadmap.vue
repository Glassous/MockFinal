<script setup lang="ts">
import { computed } from 'vue'
import {
  AlertCircle,
  Check,
  CheckCheck,
  CircleDashed,
  CircleDot,
  Loader2,
} from 'lucide-vue-next'
import type { RoadmapChapter, RoadmapNode } from '@/lib/deck'
import { PAGE_STATUS_LABELS, TEACHING_ROLE_LABELS } from '@/lib/deck'

const props = defineProps<{
  chapters: RoadmapChapter[]
  compact?: boolean
}>()

const emit = defineEmits<{ open: [pageId: number] }>()

const gridStyle = computed(() => ({
  "--roadmap-cols": String(Math.max(props.chapters.length, 1)),
}))

function canOpen(node: RoadmapNode): boolean {
  return node.page?.status === 'ready' && !!node.page.has_bundle
}

function nodeClass(node: RoadmapNode): string {
  switch (node.status) {
    case 'ready':
      return 'border-transparent bg-invert text-invert-ink'
    case 'building':
    case 'validating':
      return 'border-border-strong bg-panel text-ink'
    case 'failed':
      return 'border-border-strong bg-raised text-ink'
    case 'planned':
      return 'border-border bg-panel text-ink'
    default:
      return 'border-dashed border-border bg-transparent text-muted'
  }
}

function statusLabel(node: RoadmapNode): string {
  if (node.status === 'unstarted') return '未构建'
  return PAGE_STATUS_LABELS[node.status] ?? node.status
}

const statusIcon = (node: RoadmapNode) => {
  if (node.learned) return CheckCheck
  if (node.status === 'ready') return Check
  if (node.status === 'building' || node.status === 'validating') return Loader2
  if (node.status === 'failed') return AlertCircle
  if (node.status === 'planned') return CircleDashed
  return CircleDot
}

function openNode(node: RoadmapNode) {
  if (node.page && canOpen(node)) emit('open', node.page.id)
}
</script>

<template>
  <div class="min-w-0">
    <div class="overflow-x-auto pb-1">
      <div class="deck-roadmap-grid" :style="gridStyle">
        <section
          v-for="(chapter, chapterIndex) in chapters"
          :key="chapter.title + chapterIndex"
          class="min-w-0"
        >
          <header class="mb-2 flex items-baseline gap-2 border-b border-border pb-1.5">
            <span class="text-[11px] font-bold tracking-wider text-faint">
              {{ String(chapterIndex + 1).padStart(2, '0') }}
            </span>
            <h3 class="truncate text-xs font-semibold text-ink" :title="chapter.title">
              {{ chapter.title }}
            </h3>
          </header>

          <div class="relative space-y-2">
            <span
              class="absolute bottom-3 left-[13px] top-2 w-px bg-border"
              aria-hidden="true"
            />
            <button
              v-for="node in chapter.nodes"
              :key="node.index"
              type="button"
              class="relative flex w-full items-center gap-2 rounded-2xl border px-2 py-1.5 text-left transition-all duration-150"
              :class="[
                nodeClass(node),
                node.importance === 'core' ? 'font-semibold' : '',
                canOpen(node) ? 'hover:opacity-90' : 'cursor-default',
              ]"
              :disabled="!canOpen(node)"
              :aria-label="`${node.title}：${statusLabel(node)}`"
              :title="`${node.title} · ${statusLabel(node)}`"
              @click="openNode(node)"
            >
              <span
                class="relative z-10 inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border text-[11px] font-bold"
                :class="
                  node.status === 'ready'
                    ? 'border-transparent bg-invert-ink/15 text-invert-ink'
                    : 'border-border bg-panel text-muted'
                "
              >
                <component
                  :is="statusIcon(node)"
                  class="h-3.5 w-3.5"
                  :class="
                    node.status === 'building' || node.status === 'validating' ? 'spin' : ''
                  "
                />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-xs leading-tight">{{ node.title }}</span>
                <span
                  class="mt-0.5 block text-[11px] leading-tight"
                  :class="node.status === 'ready' ? 'text-invert-ink/65' : 'text-faint'"
                >
                  {{ statusLabel(node) }}
                  <template v-if="node.learned"> · 已学完</template>
                  <template v-if="node.role"> · {{ TEACHING_ROLE_LABELS[node.role] }}</template>
                  <template v-if="node.checkCount"> · {{ node.checkCount }} 检查</template>
                  <template v-if="node.pageCount > 1"> · {{ node.pageCount }} 页</template>
                  <template v-if="node.importance === 'core'"> · 核心</template>
                </span>
              </span>
              <span
                v-if="node.page"
                class="shrink-0 text-[11px] font-medium"
                :class="node.status === 'ready' ? 'text-invert-ink/65' : 'text-faint'"
              >
                {{ String(node.page.ordinal + 1).padStart(2, '0') }}
              </span>
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.deck-roadmap-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.75rem;
}
@media (min-width: 768px) {
  .deck-roadmap-grid {
    grid-template-columns: repeat(var(--roadmap-cols, 1), minmax(0, 1fr));
    min-width: 640px;
  }
}
</style>