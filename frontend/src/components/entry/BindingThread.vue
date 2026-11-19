<script setup lang="ts">
withDefaults(
  defineProps<{
    holes?: string[]
  }>(),
  {
    holes: () => ['22%', '50%', '78%'],
  },
)
</script>

<template>
  <span class="e-binding" aria-hidden="true">
    <span v-for="top in holes" :key="top" class="e-binding__hole" :style="{ top }" />
  </span>
</template>
