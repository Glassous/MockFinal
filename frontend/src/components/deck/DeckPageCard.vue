<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { FileImage, RotateCcw } from 'lucide-vue-next'
import type { DeckPageSummary } from '@/types'
import { loadPageThumbnail } from '@/api/decks'
import { pageDisplayTitle } from '@/lib/deck'
import DeckStatusPill from './DeckStatusPill.vue'

const props = defineProps<{
  deckId: number
  page: DeckPageSummary
  active?: boolean
}>()

const emit = defineEmits<{ open: [pageId: number]; retry: [pageId: number] }>()

const thumbnailUrl = ref<string | null>(null)
let objectUrl: string | null = null
let requestToken = 0

function releaseThumbnail() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
  thumbnailUrl.value = null
}

async function loadThumbnail() {
  releaseThumbnail()
  if (!props.page.has_bundle || props.page.status !== 'ready') return
  const token = ++requestToken
  try {
    const blob = await loadPageThumbnail(props.deckId, props.page.id)
    if (token !== requestToken) return
    objectUrl = URL.createObjectURL(blob)
    thumbnailUrl.value = objectUrl
  } catch {
    /* 缩略图失败展示占位，不影响页面打开 */
  }
}

watch(
  () => [props.page.id, props.page.has_bundle, props.page.status] as const,
  () => void loadThumbnail(),
  { immediate: true },
)

onBeforeUnmount(() => {
  requestToken += 1
  releaseThumbnail()
})

function open() {
  if (props.page.status === 'ready' && props.page.has_bundle) emit('open', props.page.id)
}
</script>

<template>
  <div
    class="group relative flex flex-col overflow-hidden rounded-2xl border bg-panel transition-colors"
    :class="active ? 'border-border-strong' : 'border-border hover:border-border-strong'"
  >
    <button
      type="button"
      class="relative block aspect-[16/9] w-full overflow-hidden bg-raised text-left disabled:cursor-default"
      :disabled="page.status !== 'ready' || !page.has_bundle"
      :aria-label="`打开第 ${page.ordinal + 1} 页：${pageDisplayTitle(page)}`"
      @click="open"
    >
      <img
        v-if="thumbnailUrl"
        :src="thumbnailUrl"
        :alt="`${pageDisplayTitle(page)} 缩略图`"
        class="h-full w-full object-cover"
        loading="lazy"
      />
      <span
        v-else
        class="flex h-full w-full flex-col items-center justify-center gap-1.5 text-faint"
      >
        <FileImage class="h-5 w-5" />
        <span class="text-[11px]">
          {{ page.status === 'building' ? '正在构建' : page.status === 'validating' ? '校验中' : '暂无缩略图' }}
        </span>
        <span v-if="page.status === 'building' || page.status === 'validating'" class="anim-pulse text-[11px]">
          请稍候
        </span>
      </span>
      <span
        class="absolute left-2 top-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-panel/95 px-1.5 text-[11px] font-bold text-ink shadow-sm"
      >
        {{ String(page.ordinal + 1).padStart(2, '0') }}
      </span>
    </button>

    <div class="flex flex-1 flex-col gap-2 p-3">
      <div class="flex items-start justify-between gap-2">
        <p class="line-clamp-2 min-h-9 text-sm font-medium leading-snug text-ink">
          {{ pageDisplayTitle(page) }}
        </p>
        <DeckStatusPill kind="page" :status="page.status" />
      </div>
      <div class="mt-auto flex items-center justify-between gap-2 text-[11px] text-faint">
        <span>
          v{{ page.current_version || 0 }}
          <template v-if="page.validation_issue_count > 0">
            · {{ page.validation_issue_count }} 个校验问题
          </template>
        </span>
        <button
          v-if="page.status === 'failed' || (page.status === 'ready' && page.has_bundle)"
          type="button"
          class="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2 text-[11px] text-muted transition-colors hover:bg-raised hover:text-ink"
          @click="emit('retry', page.id)"
        >
          <RotateCcw class="h-3 w-3" />
          {{ page.status === 'failed' ? '重试' : '重做' }}
        </button>
      </div>
    </div>
  </div>
</template>