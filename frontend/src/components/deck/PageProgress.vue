<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  current: number
  total: number
  completed?: number
}>()

const percent = computed(() =>
  props.total > 0 ? Math.round((props.current / props.total) * 100) : 0,
)
</script>

<template>
  <div class="flex items-center gap-2.5">
    <span class="text-xs font-medium tabular-nums text-ink">
      {{ String(current).padStart(2, '0') }}
      <span class="text-faint">/ {{ String(total).padStart(2, '0') }}</span>
    </span>
    <div class="hidden h-1 w-24 overflow-hidden rounded-full bg-raised sm:block">
      <div
        class="h-full rounded-full bg-invert transition-all duration-200"
        :style="{ width: `${percent}%` }"
      />
    </div>
    <span v-if="completed !== undefined" class="hidden text-[11px] text-faint md:inline">
      已读 {{ completed }} 页
    </span>
  </div>
</template>