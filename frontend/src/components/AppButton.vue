<script setup lang="ts">
import { computed } from 'vue'
import { Loader2 } from 'lucide-vue-next'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    size?: Size
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    loading?: boolean
    block?: boolean
    /** 仅图标按钮（正方形） */
    iconOnly?: boolean
    ariaLabel?: string
  }>(),
  {
    variant: 'primary',
    size: 'md',
    type: 'button',
    disabled: false,
    loading: false,
    block: false,
    iconOnly: false,
    ariaLabel: undefined,
  },
)

const emit = defineEmits<{ click: [event: MouseEvent] }>()

const base =
  'relative inline-flex items-center justify-center gap-2 font-medium select-none ' +
  'transition-all duration-150 ease-out disabled:opacity-45 disabled:pointer-events-none ' +
  'active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2'

const variantClass = computed(() => {
  switch (props.variant) {
    case 'primary':
      return 'bg-invert text-invert-ink hover:opacity-90 shadow-sm rounded-2xl'
    case 'danger':
      return 'bg-invert text-invert-ink hover:opacity-90 shadow-sm rounded-2xl'
    case 'secondary':
      return 'bg-panel text-ink border border-border hover:bg-raised hover:border-border-strong rounded-2xl'
    case 'outline':
      return 'bg-transparent text-ink border border-border-strong hover:bg-raised rounded-2xl'
    case 'ghost':
      return 'bg-transparent text-muted hover:text-ink hover:bg-raised rounded-2xl'
    default:
      return ''
  }
})

const sizeClass = computed(() => {
  if (props.iconOnly) {
    return props.size === 'sm' ? 'h-9 w-9' : props.size === 'lg' ? 'h-12 w-12' : 'h-10 w-10'
  }
  switch (props.size) {
    case 'sm':
      return 'h-9 px-3.5 text-sm'
    case 'lg':
      return 'h-12 px-6 text-base'
    default:
      return 'h-10 px-4.5 text-sm'
  }
})

const isDisabled = computed(() => props.disabled || props.loading)

function onClick(event: MouseEvent) {
  if (isDisabled.value) return
  emit('click', event)
}
</script>

<template>
  <button
    :type="type"
    :class="[base, variantClass, sizeClass, block ? 'w-full' : '']"
    :disabled="isDisabled"
    :aria-label="ariaLabel"
    :aria-busy="loading || undefined"
    @click="onClick"
  >
    <Loader2 v-if="loading" class="h-4 w-4 spin" />
    <slot v-else name="icon" />
    <span v-if="$slots.default" :class="loading ? 'opacity-90' : ''">
      <slot />
    </span>
  </button>
</template>
