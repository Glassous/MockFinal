<script setup lang="ts">
import { computed } from 'vue'
import {
  AlertCircle,
  ArrowRight,
  Hammer,
  Loader2,
  Play,
  RotateCcw,
} from 'lucide-vue-next'
import type { Deck } from '@/types'
import {
  deckProgressPercent,
  deckUpdatedSummary,
  densityLabel,
  normalizeDeckStyle,
  presetLabel,
  sortedPages,
} from '@/lib/deck'
import AppButton from '@/components/AppButton.vue'
import DeckPageCard from './DeckPageCard.vue'
import DeckStatusPill from './DeckStatusPill.vue'

const props = defineProps<{ deck: Deck }>()
const emit = defineEmits<{
  continue: [pageId: number]
  open: [pageId: number]
  build: []
  'rebuild-all': []
  'replan': []
  retry: [pageId: number]
}>()

const style = computed(() => normalizeDeckStyle(props.deck.style))
const pages = computed(() => sortedPages(props.deck))
const progress = computed(() => deckProgressPercent(props.deck))
const completedCount = computed(() => props.deck.completed_page_ids.length)
const allFailed = computed(
  () => pages.value.length > 0 && pages.value.every((page) => page.status === 'failed'),
)
const active = computed(() => !!props.deck.active_job_id)
</script>

<template>
  <aside class="flex h-full min-h-0 flex-col rounded-3xl border border-border bg-panel">
    <header class="shrink-0 border-b border-border px-5 py-4">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-sm font-semibold tracking-tight text-ink">工作台</h2>
        <DeckStatusPill kind="deck" :status="deck.status" />
      </div>
      <p class="mt-1 text-xs text-muted">{{ deckUpdatedSummary(deck) }}</p>

      <div class="mt-3">
        <div class="flex items-center justify-between text-[11px] text-muted">
          <span>就绪进度</span>
          <span>{{ progress }}%</span>
        </div>
        <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised">
          <div
            class="h-full rounded-full bg-invert transition-all duration-300"
            :style="{ width: `${progress}%` }"
          />
        </div>
      </div>

      <div v-if="active" class="mt-3">
        <AppButton block size="sm" @click="emit('build')">
          <template #icon><Loader2 class="h-4 w-4 spin" /></template>
          查看构建进度
        </AppButton>
      </div>
      <div v-else-if="deck.continue_page_id" class="mt-3">
        <AppButton block size="sm" @click="emit('continue', deck.continue_page_id)">
          <template #icon><Play class="h-4 w-4" /></template>
          继续阅读
        </AppButton>
      </div>
      <div v-else-if="!pages.length" class="mt-3">
        <AppButton block size="sm" @click="emit('build')">
          <template #icon><Hammer class="h-4 w-4" /></template>
          开始构建
        </AppButton>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <div v-if="deck.source_changed" class="mb-4 flex items-start gap-2 rounded-2xl border border-border-strong bg-raised px-3 py-2.5">
        <AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-ink" />
        <p class="text-xs leading-relaxed text-muted">
          资料已在构建后发生变化。建议整册重建，使页面引用与最新资料一致。
        </p>
      </div>

      <div class="mb-4 grid grid-cols-3 gap-2 text-center">
        <div class="rounded-2xl border border-border bg-raised px-2 py-2">
          <p class="text-lg font-bold text-ink">{{ deck.ready_pages }}</p>
          <p class="text-[10px] text-faint">已就绪</p>
        </div>
        <div class="rounded-2xl border border-border bg-raised px-2 py-2">
          <p class="text-lg font-bold text-ink">{{ deck.failed_pages }}</p>
          <p class="text-[10px] text-faint">失败</p>
        </div>
        <div class="rounded-2xl border border-border bg-raised px-2 py-2">
          <p class="text-lg font-bold text-ink">{{ completedCount }}</p>
          <p class="text-[10px] text-faint">已阅读</p>
        </div>
      </div>

      <section class="mb-4">
        <h3 class="text-xs font-semibold text-ink">风格</h3>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          <span class="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
            {{ presetLabel(style.preset) }}
          </span>
          <span class="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
            {{ densityLabel(style.density) }}
          </span>
          <span
            v-for="item in style.content.slice(0, 3)"
            :key="item"
            class="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted"
          >
            {{ item }}
          </span>
        </div>
        <p v-if="style.custom_prompt" class="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-faint">
          {{ style.custom_prompt }}
        </p>
      </section>

      <section class="mb-4">
        <h3 class="text-xs font-semibold text-ink">资料覆盖</h3>
        <p class="mt-1 text-[11px] leading-relaxed text-muted">
          <template v-if="deck.outline?.unverified_knowledge_points">
            {{ deck.outline.unverified_knowledge_points }} 个知识点未能可靠引用资料，已标记待核对。
          </template>
          <template v-else-if="pages.length">全部知识点均已解析来源引用。</template>
          <template v-else>规划完成后显示资料覆盖情况。</template>
        </p>
      </section>

      <section v-if="pages.length">
        <div class="mb-2 flex items-center justify-between">
          <h3 class="text-xs font-semibold text-ink">页面</h3>
          <span class="text-[11px] text-faint">{{ pages.length }} 页</span>
        </div>
        <div class="space-y-2.5">
          <DeckPageCard
            v-for="page in pages"
            :key="page.id"
            :deck-id="deck.id"
            :page="page"
            @open="emit('open', $event)"
            @retry="emit('retry', $event)"
          />
        </div>
      </section>

      <section v-else class="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
        <Hammer class="mx-auto h-6 w-6 text-faint" />
        <p class="mt-2 text-sm font-medium text-ink">还没有页面</p>
        <p class="mt-1 text-xs leading-relaxed text-muted">
          从构建工作台选择风格与密度，开始生成第一版复习页。
        </p>
        <AppButton class="mt-3" size="sm" @click="emit('build')">
          <template #icon><ArrowRight class="h-4 w-4" /></template>
          去构建
        </AppButton>
      </section>
    </div>

    <footer v-if="pages.length" class="shrink-0 border-t border-border px-5 py-3">
      <div class="flex flex-wrap gap-2">
        <AppButton
          v-if="deck.last_job_id && !active"
          variant="secondary"
          size="sm"
          @click="emit('build')"
        >
          查看最近构建
        </AppButton>
        <AppButton
          v-if="allFailed"
          variant="secondary"
          size="sm"
          @click="emit('replan')"
        >
          <template #icon><RotateCcw class="h-3.5 w-3.5" /></template>
          重新规划
        </AppButton>
        <AppButton variant="secondary" size="sm" :disabled="active" @click="emit('rebuild-all')">
          <template #icon><RotateCcw class="h-3.5 w-3.5" /></template>
          整册重建
        </AppButton>
      </div>
      <p class="mt-2 text-[10px] leading-relaxed text-faint">
        重建时旧页面在新版本就绪前保持可读；单页可在页面卡片或阅读器中重做。
      </p>
    </footer>
  </aside>
</template>