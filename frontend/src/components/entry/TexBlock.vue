<script setup lang="ts">
import { computed } from 'vue'
import katex from 'katex'

const props = withDefaults(defineProps<{ tex: string; display?: boolean }>(), {
  display: false,
})

const html = computed(() =>
  katex.renderToString(props.tex, {
    displayMode: props.display,
    throwOnError: false,
    strict: 'ignore',
  }),
)
</script>

<template>
  <span class="e-tex" :class="{ 'e-tex--display': display }" v-html="html" />
</template>

<style scoped>
.e-tex {
  display: inline-block;
  max-width: 100%;
  color: inherit;
}

.e-tex--display {
  display: block;
}

.e-tex--display :deep(.katex-display) {
  margin: 0;
}

.e-tex :deep(.katex) {
  color: inherit;
}
</style>
