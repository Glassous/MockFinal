<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowDown, TerminalSquare } from 'lucide-vue-next'
import type { Deck, DeckEvent } from '@/types'
import { eventPageLabel, eventText, eventTypeLabel } from '@/lib/deck'

const props = defineProps<{
  events: DeckEvent[]
  deck: Deck
}>()

const scroller = ref<HTMLElement | null>(null)
const stickToBottom = ref(true)

const rows = computed(() =>
  props.events
    .filter((event) => ['stage', 'text', 'tool', 'validation', 'page_ready', 'retry', 'error'].includes(event.type))
    .slice(-300)
    .map((event) => ({
      id: event.id,
      type: event.type,
      label: eventTypeLabel(event.type),
      page: eventPageLabel(event, props.deck),
      text: eventText(event),
      time: new Date(event.created_at).toLocaleTimeString('zh-CN', { hour12: false }),
    }))
    .filter((row) => row.text || row.type !== 'text'),
)

function onScroll() {
  const element = scroller.value
  if (!element) return
  stickToBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight < 48
}

function scrollToBottom() {
  const element = scroller.value
  if (!element) return
  element.scrollTop = element.scrollHeight
  stickToBottom.value = true
}

watch(
  () => rows.value.length,
  async () => {
    if (!stickToBottom.value) return
    await nextTick()
    scrollToBottom()
  },
)

watch(
  () => props.events.length,
  async () => {
    if (!stickToBottom.value) return
    await nextTick()
    scrollToBottom()
  },
)

defineExpose({ scrollToBottom })
</script>

<template>
  <div class="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-panel">
    <div class="flex shrink-0 items-center gap-2 border-b border-border px-3.5 py-2.5">
      <TerminalSquare class="h-4 w-4 text-muted" />
      <span class="text-xs font-semibold text-ink">构建输出</span>
      <span class="ml-auto text-[11px] text-faint">仅展示可见文本与动作摘要</span>
    </div>

    <div
      ref="scroller"
      class="min-h-0 flex-1 overflow-y-auto px-3.5 py-2.5 font-mono text-[11px] leading-relaxed"
      role="log"
      aria-live="polite"
      @scroll="onScroll"
    >
      <div v-if="!rows.length" class="flex h-full min-h-24 items-center justify-center text-muted">
        等待构建输出…
      </div>
      <div
        v-for="row in rows"
        :key="row.id"
        class="flex gap-2 border-b border-border/60 py-1.5 last:border-b-0"
      >
        <span class="w-14 shrink-0 text-faint">{{ row.time }}</span>
        <span class="w-14 shrink-0 text-muted">{{ row.label }}</span>
        <span class="min-w-0 flex-1 break-words text-ink">
          <span v-if="row.page" class="mr-1 text-faint">[{{ row.page }}]</span>
          {{ row.text || '—' }}
        </span>
      </div>
    </div>

    <button
      v-if="!stickToBottom"
      type="button"
      class="absolute bottom-3 right-3 inline-flex h-8 items-center gap-1 rounded-full border border-border-strong bg-panel px-3 text-[11px] text-ink shadow-card"
      @click="scrollToBottom"
    >
      <ArrowDown class="h-3.5 w-3.5" />
      有新输出
    </button>
  </div>
</template>