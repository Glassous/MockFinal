<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '@/lib/markdown'

const props = defineProps<{ content: string }>()

const html = computed(() => renderMarkdown(props.content ?? ''))
</script>

<template>
  <!-- 已在 lib/markdown 中经 DOMPurify 清洗，可安全 v-html -->
  <div class="markdown-body" v-html="html" />
</template>
