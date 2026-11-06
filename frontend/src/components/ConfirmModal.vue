<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'
import Modal from './Modal.vue'
import AppButton from './AppButton.vue'

withDefaults(
  defineProps<{
    open: boolean
    title?: string
    message?: string
    confirmText?: string
    cancelText?: string
    loading?: boolean
    danger?: boolean
  }>(),
  {
    title: '确认操作',
    message: '',
    confirmText: '确认',
    cancelText: '取消',
    loading: false,
    danger: true,
  },
)

const emit = defineEmits<{ close: []; confirm: [] }>()
</script>

<template>
  <Modal :open="open" size="sm" :show-close="false" :close-on-overlay="!loading" @close="emit('close')">
    <div class="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left">
      <span
        class="mb-4 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-raised text-ink sm:mb-0 sm:mr-4"
      >
        <AlertTriangle class="h-5 w-5" />
      </span>
      <div class="min-w-0">
        <h3 class="text-base font-semibold tracking-tight text-ink">{{ title }}</h3>
        <p class="mt-1.5 text-sm leading-relaxed text-muted break-words">{{ message }}</p>
      </div>
    </div>

    <template #footer>
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <AppButton variant="secondary" :disabled="loading" @click="emit('close')">
          {{ cancelText }}
        </AppButton>
        <AppButton
          :variant="danger ? 'danger' : 'primary'"
          :loading="loading"
          @click="emit('confirm')"
        >
          {{ confirmText }}
        </AppButton>
      </div>
    </template>
  </Modal>
</template>
