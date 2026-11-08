<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  actionLabel?: string
  icon?: boolean
}>()

const emit = defineEmits<{ action: [] }>()
</script>

<template>
  <div class="flex flex-col items-center justify-center px-6 py-12 text-center">
    <span
      v-if="icon"
      class="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-raised text-faint"
      aria-hidden="true"
    >
      <slot name="icon" />
    </span>
    <p class="text-sm font-semibold text-ink">{{ title }}</p>
    <p v-if="description" class="mt-1 max-w-sm text-xs leading-relaxed text-muted">
      {{ description }}
    </p>
    <button
      v-if="actionLabel"
      type="button"
      class="mt-4 inline-flex h-9 items-center rounded-2xl border border-border bg-panel px-3.5 text-sm font-medium text-ink transition-colors hover:border-border-strong hover:bg-raised"
      @click="emit('action')"
    >
      {{ actionLabel }}
    </button>
    <slot />
  </div>
</template>
