<script setup lang="ts">
withDefaults(
  defineProps<{
    text: string
    rotate?: number
    delay?: number
    animate?: boolean
  }>(),
  {
    rotate: -7,
    delay: 0,
    animate: true,
  },
)
</script>

<template>
  <span
    class="e-stamp"
    :class="{ 'e-stamp--animate': animate }"
    :style="{
      '--e-stamp-rotate': `${rotate}deg`,
      '--e-stamp-delay': `${delay}s`,
    }"
  >
    {{ text }}
  </span>
</template>
