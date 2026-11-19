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
      class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-sm px-2 text-sm text-muted transition-colors hover:bg-raised hover:text-pen"
      aria-label="返回工作区"
    >
      <ArrowLeft class="h-4 w-4" />
      <span class="hidden sm:inline">工作区</span>
    </router-link>
    <div class="min-w-0 flex-1 border-l border-border pl-3">
      <h1 class="truncate font-serif text-base font-bold tracking-tight text-ink sm:text-lg">
        {{ title }}
      </h1>
      <p v-if="subtitle" class="truncate font-mono text-[10px] tracking-wide text-faint">
        {{ subtitle }}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <slot />
      <ThemeToggle size="sm" />
    </div>
  </header>
</template>