<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    active?: boolean
    disabled?: boolean
    size?: 'sm' | 'md'
    type?: 'button' | 'submit'
  }>(),
  { active: false, disabled: false, size: 'md', type: 'button' },
)

const emit = defineEmits<{ click: [event: MouseEvent] }>()

const sizeClass = computed(() => (props.size === 'sm' ? 'h-8 w-8' : 'h-9 w-9'))

function onClick(event: MouseEvent) {
  if (!props.disabled) emit('click', event)
}
</script>

<template>
  <button
    :type="type"
    :class="[
      'inline-flex shrink-0 items-center justify-center rounded-2xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-35',
      sizeClass,
      active ? 'bg-raised text-ink' : 'text-muted hover:bg-raised hover:text-ink',
    ]"
    :disabled="disabled"
    :aria-label="label"
    :aria-pressed="active || undefined"
    :title="label"
    @click="onClick"
  >
    <slot />
  </button>
</template>
