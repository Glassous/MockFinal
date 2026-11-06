<script setup lang="ts">
import { computed, useId, ref } from 'vue'
import { AlertCircle, Eye, EyeOff } from 'lucide-vue-next'

export interface SelectOption {
  label: string
  value: string
}

const props = withDefaults(
  defineProps<{
    modelValue?: string
    type?: 'text' | 'password' | 'email' | 'textarea' | 'select'
    label?: string
    placeholder?: string
    hint?: string
    error?: string | null
    required?: boolean
    disabled?: boolean
    autocomplete?: string
    options?: SelectOption[]
    rows?: number
    maxlength?: number
    name?: string
  }>(),
  {
    modelValue: '',
    type: 'text',
    label: '',
    placeholder: '',
    hint: '',
    error: null,
    required: false,
    disabled: false,
    autocomplete: undefined,
    options: () => [],
    rows: 4,
    maxlength: undefined,
    name: undefined,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const uid = useId()
const showPassword = ref(false)

const value = computed({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', v),
})

const fieldClass = computed(() => {
  const common =
    'w-full bg-panel text-ink placeholder:text-faint rounded-2xl border transition-colors duration-150 ' +
    'focus:outline-none focus:border-ink disabled:opacity-50 disabled:cursor-not-allowed'
  const border = props.error ? 'border-border-strong' : 'border-border'
  return `${common} ${border}`
})

const inputType = computed(() =>
  props.type === 'password' && showPassword.value ? 'text' : props.type,
)
</script>

<template>
  <div class="w-full">
    <label
      v-if="label"
      :for="uid"
      class="mb-1.5 flex items-center gap-1 text-sm font-medium text-ink"
    >
      {{ label }}
      <span v-if="required" class="text-muted">*</span>
    </label>

    <div class="relative">
      <!-- 文本 / 密码 / 邮箱 -->
      <input
        v-if="type !== 'textarea' && type !== 'select'"
        :id="uid"
        v-model="value"
        :type="inputType"
        :name="name"
        :placeholder="placeholder"
        :disabled="disabled"
        :autocomplete="autocomplete"
        :maxlength="maxlength"
        :required="required"
        :class="[fieldClass, 'h-11', type === 'password' ? 'px-4 pr-11' : 'px-4']"
      />

      <!-- 多行文本 -->
      <textarea
        v-else-if="type === 'textarea'"
        :id="uid"
        v-model="value"
        :name="name"
        :placeholder="placeholder"
        :disabled="disabled"
        :rows="rows"
        :maxlength="maxlength"
        :required="required"
        :class="[fieldClass, 'px-4 py-3 resize-y leading-relaxed']"
      />

      <!-- 下拉选择 -->
      <select
        v-else
        :id="uid"
        v-model="value"
        :name="name"
        :disabled="disabled"
        :required="required"
        :class="[fieldClass, 'h-11 px-4 pr-10 appearance-none cursor-pointer']"
      >
        <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
        <option v-for="opt in options" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>

      <!-- 密码可见性切换 -->
      <button
        v-if="type === 'password'"
        type="button"
        class="absolute right-3 top-1/2 -translate-y-1/2 text-faint transition-colors hover:text-ink"
        :aria-label="showPassword ? '隐藏密码' : '显示密码'"
        @click="showPassword = !showPassword"
      >
        <EyeOff v-if="showPassword" class="h-4.5 w-4.5" />
        <Eye v-else class="h-4.5 w-4.5" />
      </button>

      <!-- 下拉箭头 -->
      <span
        v-if="type === 'select'"
        class="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    </div>

    <p v-if="error" class="mt-1.5 flex items-start gap-1.5 text-xs text-ink">
      <AlertCircle class="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{{ error }}</span>
    </p>
    <p v-else-if="hint" class="mt-1.5 text-xs text-muted">{{ hint }}</p>
  </div>
</template>
