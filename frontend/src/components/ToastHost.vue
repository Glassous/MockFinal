<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-vue-next'
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()
const { toasts } = storeToRefs(toastStore)
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 top-5 z-toast flex flex-col items-center gap-2 px-4"
    role="region"
    aria-live="polite"
  >
    <transition-group name="toast" tag="div" class="flex w-full max-w-sm flex-col items-center gap-2">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto flex w-full items-start gap-3 rounded-2xl border bg-panel px-4 py-3 shadow-pop"
        :class="t.type === 'error' ? 'border-border-strong' : 'border-border'"
      >
        <span class="mt-0.5 shrink-0">
          <CheckCircle2 v-if="t.type === 'success'" class="h-[18px] w-[18px] text-ink" />
          <AlertCircle v-else-if="t.type === 'error'" class="h-[18px] w-[18px] text-ink" />
          <Info v-else class="h-[18px] w-[18px] text-muted" />
        </span>
        <p class="flex-1 break-words text-sm leading-relaxed text-ink">{{ t.message }}</p>
        <button
          type="button"
          class="shrink-0 text-faint transition-colors hover:text-ink"
          aria-label="关闭提示"
          @click="toastStore.dismiss(t.id)"
        >
          <X class="h-4 w-4" />
        </button>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-enter-active {
  transition: all 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}
.toast-leave-active {
  transition: all 0.18s ease;
  position: absolute;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(-14px) scale(0.96);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
.toast-move {
  transition: transform 0.24s ease;
}
</style>
