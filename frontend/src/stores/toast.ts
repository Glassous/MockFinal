import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastType = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  type: ToastType
  message: string
}

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<ToastItem[]>([])
  let seed = 0

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function push(type: ToastType, message: string, duration = 3200): number {
    const id = ++seed
    toasts.value.push({ id, type, message })
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }
    return id
  }

  function success(message: string): number {
    return push('success', message)
  }
  function error(message: string): number {
    return push('error', message, 4500)
  }
  function info(message: string): number {
    return push('info', message)
  }

  return { toasts, push, dismiss, success, error, info }
})
