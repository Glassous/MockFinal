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

const fieldClass = computed(() => ({
  'field--error': !!props.error,
  'field--disabled': props.disabled,
}))

const inputType = computed(() =>
  props.type === 'password' && showPassword.value ? 'text' : props.type,
)
</script>

<template>
  <div class="w-full">
    <label
      v-if="label"
      :for="uid"
      class="mb-1.5 flex items-center gap-1 text-xs font-semibold text-muted"
    >
      {{ label }}
      <span v-if="required" class="text-pen">*</span>
    </label>

    <div class="field" :class="fieldClass">
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
        class="field__control h-11"
        :class="type === 'password' ? 'pr-10' : ''"
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
        class="field__control field__control--area"
      />

      <!-- 下拉选择 -->
      <select
        v-else
        :id="uid"
        v-model="value"
        :name="name"
        :disabled="disabled"
        :required="required"
        class="field__control field__control--select h-11"
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
        class="field__toggle"
        :aria-label="showPassword ? '隐藏密码' : '显示密码'"
        @click="showPassword = !showPassword"
      >
        <EyeOff v-if="showPassword" class="h-4 w-4" />
        <Eye v-else class="h-4 w-4" />
      </button>

      <!-- 下拉箭头 -->
      <span v-if="type === 'select'" class="field__arrow">
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>

      <span class="field__line" aria-hidden="true" />
    </div>

    <p v-if="error" class="field__message field__message--error">
      <AlertCircle class="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{{ error }}</span>
    </p>
    <p v-else-if="hint" class="field__message">{{ hint }}</p>
  </div>
</template>

<style scoped>
.field {
  position: relative;
}

.field__control {
  width: 100%;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--border-strong);
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  font-size: 0.9375rem;
  transition: border-color 160ms ease;
}

.field__control::placeholder {
  color: var(--faint);
}

.field__control:focus {
  outline: none;
  border-bottom-color: transparent;
}

.field__control:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.field--error .field__control {
  border-bottom-color: transparent;
}

.field__control--area {
  min-height: 88px;
  padding-top: 0.3rem;
  line-height: 1.7;
  resize: vertical;
}

.field__control--select {
  appearance: none;
  padding-right: 1.75rem;
  cursor: pointer;
}

.field__toggle {
  position: absolute;
  right: 0;
  bottom: 0.75rem;
  color: var(--muted);
  transition: color 160ms ease;
}

.field__toggle:hover {
  color: var(--pen);
}

.field__arrow {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  color: var(--muted);
  pointer-events: none;
}

.field__line {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1.5px;
  background: var(--pen);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 280ms cubic-bezier(0.22, 0.8, 0.24, 1);
  pointer-events: none;
}

.field:focus-within .field__line,
.field--error .field__line {
  transform: scaleX(1);
}

.field__message {
  margin: 0.4rem 0 0;
  color: var(--muted);
  font-size: 0.75rem;
  line-height: 1.5;
}

.field__message--error {
  display: flex;
  align-items: flex-start;
  gap: 0.35rem;
  color: var(--pen);
}
</style>
