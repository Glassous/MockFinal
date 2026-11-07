<script setup lang="ts">
import { computed } from 'vue'
import { MessageSquareText } from 'lucide-vue-next'

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  text: string
}>()

const emit = defineEmits<{ ask: [] }>()

const style = computed(() => ({
  left: `${Math.max(8, Math.min(props.x, window.innerWidth - 132))}px`,
  top: `${Math.max(8, Math.min(props.y, window.innerHeight - 48))}px`,
}))
</script>

<template>
  <teleport to="body">
    <transition name="selection-action">
      <button
        v-if="visible"
        type="button"
        class="fixed z-60 inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-panel px-3 py-1.5 text-xs font-medium text-ink shadow-pop"
        :style="style"
        :title="text"
        @mousedown.prevent
        @click="emit('ask')"
      >
        <MessageSquareText class="h-3.5 w-3.5" />
        问 AI
      </button>
    </transition>
  </teleport>
</template>

<style scoped>
.selection-action-enter-active,
.selection-action-leave-active {
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
}
.selection-action-enter-from,
.selection-action-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>