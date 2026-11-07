<script setup lang="ts">
import { computed } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import type { DeckDensity, DeckPreset, DeckStyle } from '@/types'
import {
  DECK_CONTENT_OPTIONS,
  DECK_DENSITIES,
  DECK_PRESETS,
  estimatePageRange,
} from '@/lib/deck'
import AppButton from '@/components/AppButton.vue'

const props = withDefaults(
  defineProps<{
    modelValue: DeckStyle
    busy?: boolean
    submitLabel?: string
    showSubmit?: boolean
  }>(),
  {
    busy: false,
    submitLabel: '开始构建',
    showSubmit: true,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: DeckStyle]
  submit: []
}>()

const presetHint = computed(
  () => DECK_PRESETS.find((item) => item.value === props.modelValue.preset)?.hint ?? '',
)

function update(patch: Partial<DeckStyle>) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function setPreset(preset: DeckPreset) {
  update({ preset })
}

function setDensity(density: DeckDensity) {
  update({ density })
}

function toggleContent(item: string) {
  const exists = props.modelValue.content.includes(item)
  update({
    content: exists
      ? props.modelValue.content.filter((value) => value !== item)
      : [...props.modelValue.content, item],
  })
}

function onPromptInput(event: Event) {
  update({ custom_prompt: (event.target as HTMLTextAreaElement).value })
}
</script>

<template>
  <div class="space-y-5">
    <section>
      <div class="flex items-baseline justify-between gap-2">
        <h3 class="text-sm font-semibold text-ink">风格预设</h3>
        <span class="text-xs text-faint">{{ presetHint }}</span>
      </div>
      <div class="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button
          v-for="preset in DECK_PRESETS"
          :key="preset.value"
          type="button"
          class="rounded-2xl border px-3 py-2.5 text-left transition-colors"
          :class="
            modelValue.preset === preset.value
              ? 'border-transparent bg-invert text-invert-ink'
              : 'border-border bg-panel text-ink hover:border-border-strong'
          "
          @click="setPreset(preset.value)"
        >
          <span class="block text-sm font-semibold">{{ preset.label }}</span>
          <span
            class="mt-0.5 block text-[11px] leading-snug"
            :class="modelValue.preset === preset.value ? 'text-invert-ink/70' : 'text-faint'"
          >
            {{ preset.hint }}
          </span>
        </button>
      </div>
    </section>

    <section>
      <h3 class="text-sm font-semibold text-ink">内容偏好</h3>
      <p class="mt-0.5 text-xs text-muted">可多选，作为内容与表达的偏好，不覆盖页面安全约束。</p>
      <div class="mt-2.5 flex flex-wrap gap-2">
        <button
          v-for="item in DECK_CONTENT_OPTIONS"
          :key="item"
          type="button"
          class="rounded-full border px-3 py-1 text-xs transition-colors"
          :class="
            modelValue.content.includes(item)
              ? 'border-transparent bg-invert text-invert-ink'
              : 'border-border bg-panel text-muted hover:border-border-strong hover:text-ink'
          "
          :aria-pressed="modelValue.content.includes(item)"
          @click="toggleContent(item)"
        >
          {{ item }}
        </button>
      </div>
    </section>

    <section>
      <h3 class="text-sm font-semibold text-ink">页面密度</h3>
      <div class="mt-2.5 grid grid-cols-3 gap-2">
        <button
          v-for="density in DECK_DENSITIES"
          :key="density.value"
          type="button"
          class="rounded-2xl border px-3 py-2 text-left transition-colors"
          :class="
            modelValue.density === density.value
              ? 'border-transparent bg-invert text-invert-ink'
              : 'border-border bg-panel text-ink hover:border-border-strong'
          "
          @click="setDensity(density.value)"
        >
          <span class="block text-sm font-medium">{{ density.label }}</span>
          <span
            class="block text-[11px]"
            :class="modelValue.density === density.value ? 'text-invert-ink/70' : 'text-faint'"
          >
            {{ density.range }}
          </span>
        </button>
      </div>
    </section>

    <section>
      <div class="flex items-baseline justify-between gap-2">
        <h3 class="text-sm font-semibold text-ink">自定义提示词</h3>
        <span class="text-[11px] text-faint">{{ modelValue.custom_prompt.length }} / 500</span>
      </div>
      <textarea
        :value="modelValue.custom_prompt"
        rows="3"
        maxlength="500"
        placeholder="例如：多用生活类比；公式推导要一步步来。"
        class="mt-2 w-full resize-none rounded-2xl border border-border bg-panel px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-border-strong focus:outline-none"
        @input="onPromptInput"
      />
    </section>

    <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <p class="text-xs text-muted">
        预计 {{ estimatePageRange(modelValue.density) }}；构建过程可离开，完成后逐页出现。
      </p>
      <AppButton v-if="showSubmit" :loading="busy" :disabled="busy" @click="emit('submit')">
        <template #icon><Sparkles class="h-4 w-4" /></template>
        {{ submitLabel }}
      </AppButton>
    </div>
  </div>
</template>