<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { X } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    description?: string
    size?: 'sm' | 'md' | 'lg' | 'xl'
    closeOnOverlay?: boolean
    showClose?: boolean
  }>(),
  {
    title: '',
    description: '',
    size: 'md',
    closeOnOverlay: true,
    showClose: true,
  },
)

const emit = defineEmits<{ close: [] }>()

const sizeClass = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'max-w-sm'
    case 'lg':
      return 'max-w-2xl'
    case 'xl':
      return 'max-w-4xl'
    default:
      return 'max-w-md'
  }
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) emit('close')
}

function lockScroll(locked: boolean) {
  document.body.style.overflow = locked ? 'hidden' : ''
}

watch(
  () => props.open,
  (open) => {
    lockScroll(open)
    if (open) window.addEventListener('keydown', onKeydown)
    else window.removeEventListener('keydown', onKeydown)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  lockScroll(false)
})
</script>

<template>
  <teleport to="body">
    <transition name="modal">
      <div
        v-if="open"
        class="fixed inset-0 z-modal flex items-end justify-center p-0 sm:items-center sm:p-4"
      >
        <div
          class="absolute inset-0 bg-overlay"
          @click="closeOnOverlay && emit('close')"
        />
        <div
          role="dialog"
          aria-modal="true"
          :aria-label="title || undefined"
          class="anim-pop relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-panel shadow-pop sm:rounded-3xl"
          :class="sizeClass"
        >
          <header
            v-if="title || showClose"
            class="flex shrink-0 items-start justify-between gap-4 px-6 pt-6"
          >
            <div class="min-w-0">
              <h2 v-if="title" class="text-lg font-semibold tracking-tight text-ink">
                {{ title }}
              </h2>
              <p v-if="description" class="mt-1 text-sm leading-relaxed text-muted">
                {{ description }}
              </p>
            </div>
            <button
              v-if="showClose"
              type="button"
              class="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-ink"
              aria-label="关闭"
              @click="emit('close')"
            >
              <X class="h-4.5 w-4.5" />
            </button>
          </header>

          <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <slot />
          </div>

          <footer v-if="$slots.footer" class="shrink-0 px-6 pb-6 pt-1">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
