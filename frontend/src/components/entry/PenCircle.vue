<script setup lang="ts">
const props = withDefaults(defineProps<{ delay?: 0 | 1 | 2 | 3 | 4 }>(), { delay: 0 })
</script>

<template>
  <svg
    class="e-pen-mark"
    :class="props.delay ? `e-delay-${props.delay}` : undefined"
    viewBox="0 0 420 120"
    fill="none"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <path
      class="e-draw"
      d="M28 62 C 40 20, 160 8, 300 14 C 390 18, 410 50, 396 82 C 380 112, 250 116, 120 110 C 48 106, 18 88, 30 50"
      pathLength="1"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
    <path
      class="e-draw e-delay-1"
      d="M24 70 C 60 100, 200 108, 330 100 C 370 97, 400 88, 404 76"
      pathLength="1"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
      opacity="0.55"
    />
  </svg>
</template>
