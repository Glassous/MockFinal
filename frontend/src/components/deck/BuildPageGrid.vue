<script setup lang="ts">
import { computed } from 'vue'
import type { Deck } from '@/types'
import { sortedPages } from '@/lib/deck'
import DeckPageCard from './DeckPageCard.vue'

const props = defineProps<{ deck: Deck }>()
const emit = defineEmits<{ open: [pageId: number]; retry: [pageId: number] }>()

const pages = computed(() => sortedPages(props.deck))
</script>

<template>
  <div>
    <div v-if="!pages.length" class="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
      <p class="text-sm text-muted">规划完成后，页面会在这里逐页出现。</p>
    </div>
    <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <DeckPageCard
        v-for="page in pages"
        :key="page.id"
        :deck-id="deck.id"
        :page="page"
        @open="emit('open', $event)"
        @retry="emit('retry', $event)"
      />
    </div>
  </div>
</template>