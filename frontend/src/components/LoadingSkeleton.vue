<script setup lang="ts">
withDefaults(
  defineProps<{
    lines?: number
    label?: string
  }>(),
  { lines: 3, label: '正在加载…' },
)
</script>

<template>
  <div class="w-full space-y-2.5" role="status" :aria-label="label">
    <span class="sr-only">{{ label }}</span>
    <span
      v-for="index in lines"
      :key="index"
      class="block h-3 rounded-full bg-raised motion-safe:animate-pulse"
      :style="{ width: index === lines ? '62%' : `${100 - index * 7}%` }"
      aria-hidden="true"
    />
  </div>
</template>
