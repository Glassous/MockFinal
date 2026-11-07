<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, Hammer, Layers, Loader2 } from 'lucide-vue-next'
import type { Deck } from '@/types'
import {
  deckProgressPercent,
  densityLabel,
  presetLabel,
  normalizeDeckStyle,
} from '@/lib/deck'
import { formatRelative } from '@/lib/format'
import AppButton from '@/components/AppButton.vue'
import DeckStatusPill from '@/components/deck/DeckStatusPill.vue'

const props = defineProps<{
  decks: Deck[]
  loading?: boolean
}>()

const emit = defineEmits<{ create: []; open: [deckId: number] }>()

const sorted = computed(() =>
  [...props.decks].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  ),
)

function styleOf(deck: Deck) {
  return normalizeDeckStyle(deck.style)
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold tracking-tight text-ink">复习页</h2>
        <p class="mt-1 text-sm leading-relaxed text-muted">
          按知识点生成的全屏动态复习页。构建在后台进行，已完成页面可以随时开始阅读。
        </p>
      </div>
      <AppButton @click="emit('create')">
        <template #icon><Hammer class="h-4 w-4" /></template>
        新建复习页
      </AppButton>
    </div>

    <div v-if="loading" class="grid gap-4 sm:grid-cols-2">
      <div v-for="index in 2" :key="index" class="h-40 animate-pulse rounded-3xl bg-raised" />
    </div>

    <div
      v-else-if="!sorted.length"
      class="flex flex-col items-center rounded-3xl border border-dashed border-border bg-panel px-6 py-14 text-center"
    >
      <span class="inline-flex h-14 w-14 items-center justify-center rounded-3xl bg-raised text-muted">
        <Layers class="h-6 w-6" />
      </span>
      <h3 class="mt-4 text-base font-semibold text-ink">还没有复习页</h3>
      <p class="mt-1.5 max-w-md text-sm leading-relaxed text-muted">
        选择风格与页面密度，系统会先规划知识点，再逐页构建可交互的复习页面。
      </p>
      <AppButton class="mt-5" @click="emit('create')">
        <template #icon><Hammer class="h-4 w-4" /></template>
        新建复习页
      </AppButton>
    </div>

    <div v-else class="grid gap-4 sm:grid-cols-2">
      <button
        v-for="deck in sorted"
        :key="deck.id"
        type="button"
        class="group flex flex-col rounded-3xl border border-border bg-panel p-5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card"
        @click="emit('open', deck.id)"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate text-base font-semibold tracking-tight text-ink">
              {{ deck.title }}
            </p>
            <p class="mt-1 text-xs text-muted">
              {{ presetLabel(styleOf(deck).preset) }} · {{ densityLabel(styleOf(deck).density) }}
            </p>
          </div>
          <DeckStatusPill kind="deck" :status="deck.status" />
        </div>

        <div class="mt-4">
          <div class="flex items-center justify-between text-[11px] text-muted">
            <span>{{ deck.ready_pages }} / {{ deck.total_pages || '—' }} 页就绪</span>
            <span>{{ deckProgressPercent(deck) }}%</span>
          </div>
          <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised">
            <div
              class="h-full rounded-full bg-invert transition-all duration-300"
              :style="{ width: `${deckProgressPercent(deck)}%` }"
            />
          </div>
        </div>

        <div class="mt-4 flex items-end justify-between gap-2 border-t border-border pt-3">
          <span class="inline-flex items-center gap-1 text-[11px] text-faint">
            <Loader2 v-if="deck.active_job_id" class="h-3 w-3 spin" />
            {{ deck.active_job_id ? '构建进行中' : `更新于 ${formatRelative(deck.updated_at)}` }}
          </span>
          <span
            class="inline-flex items-center gap-0.5 text-xs font-medium text-muted transition-colors group-hover:text-ink"
          >
            打开
            <ArrowRight class="h-3.5 w-3.5" />
          </span>
        </div>
      </button>

      <button
        type="button"
        class="flex min-h-40 flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-border bg-transparent p-5 text-muted transition-colors hover:border-ink hover:text-ink"
        @click="emit('create')"
      >
        <Hammer class="h-5 w-5" />
        <span class="text-sm font-medium">再建一个复习页</span>
      </button>
    </div>
  </section>
</template>