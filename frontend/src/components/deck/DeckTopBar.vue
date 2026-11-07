<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import ThemeToggle from '@/components/ThemeToggle.vue'

defineProps<{
  workspaceId: number
  title: string
  subtitle?: string
}>()
</script>

<template>
  <header class="flex shrink-0 items-center gap-3 border-b border-border bg-panel px-4 py-3 sm:px-6">
    <router-link
      :to="{ name: 'workspace', params: { id: workspaceId } }"
      class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-2xl px-2.5 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
      aria-label="返回工作区"
    >
      <ArrowLeft class="h-4 w-4" />
      <span class="hidden sm:inline">工作区</span>
    </router-link>
    <div class="min-w-0 flex-1">
      <h1 class="truncate text-base font-semibold tracking-tight text-ink sm:text-lg">
        {{ title }}
      </h1>
      <p v-if="subtitle" class="truncate text-xs text-muted">{{ subtitle }}</p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <slot />
      <ThemeToggle size="sm" />
    </div>
  </header>
</template>