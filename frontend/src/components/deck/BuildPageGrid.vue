<script setup lang="ts">
import { computed } from 'vue'
import { Hammer } from 'lucide-vue-next'
import type { Deck } from '@/types'
import { sortedPages } from '@/lib/deck'
import EmptyState from '@/components/EmptyState.vue'
import DeckPageCard from './DeckPageCard.vue'

const props = defineProps<{ deck: Deck }>()
const emit = defineEmits<{ open: [pageId: number]; retry: [pageId: number] }>()

const pages = computed(() => sortedPages(props.deck))
</script>

<template>
  <div>
    <div v-if="!pages.length">
      <EmptyState title="还没有页面" description="规划完成后，页面会在这里逐页出现。" icon>
        <template #icon><Hammer class="h-5 w-5" /></template>
      </EmptyState>
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