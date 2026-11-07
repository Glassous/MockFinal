<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PageBundle, PageSelection } from '@/types'
import { buildPageShell, describeShellError } from '@/lib/pageShell'

const props = defineProps<{
  bundle: PageBundle
  theme: 'light' | 'dark'
}>()

const emit = defineEmits<{
  ready: []
  selection: [payload: PageSelection]
  requestNext: []
  requestPrev: []
  requestAssistant: [quote: string]
  complete: []
  interaction: [payload: Record<string, unknown>]
  runtimeError: [message: string]
  error: [message: string]
}>()

const MAX_SELECTION_CHARS = 2000
const MAX_BLOCK_CHARS = 3000
const MAX_QUOTE_CHARS = 2000

const iframe = ref<HTMLIFrameElement | null>(null)
const html = ref('')
const channel = ref('')
let readyTimer: number | null = null
let ready = false
let accepting = false

function clip(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.slice(0, limit) : ''
}

function onFrameLoad() {
  if (!ready) return
  // srcdoc 就绪后再次 load 只可能是页面自我导航；立即销毁内容并停止后续消息
  ready = false
  accepting = false
  clearReadyTimer()
  channel.value = ''
  html.value = ''
  emit('error', '页面尝试跳转到外部地址，已被安全终止')
}

function clearReadyTimer() {
  if (readyTimer !== null) {
    window.clearTimeout(readyTimer)
    readyTimer = null
  }
}

function scheduleReadyTimeout() {
  clearReadyTimer()
  readyTimer = window.setTimeout(() => {
    if (!ready) emit('error', '页面加载超时（8 秒），请重试')
  }, 8000)
}

function build() {
  clearReadyTimer()
  ready = false
  accepting = false
  try {
    const shell = buildPageShell(props.bundle, props.theme)
    html.value = shell.html
    channel.value = shell.channel
    accepting = true
    void nextTick(scheduleReadyTimeout)
  } catch (error) {
    html.value = ''
    channel.value = ''
    emit('error', describeShellError(error))
  }
}

function post(type: string, payload: Record<string, unknown> = {}) {
  if (!accepting || !channel.value) return
  iframe.value?.contentWindow?.postMessage(
    { channel: channel.value, type, payload },
    '*',
  )
}

function sendTheme() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  post('theme', { mode: props.theme, reducedMotion })
}

function onMessage(event: MessageEvent) {
  const frame = iframe.value
  if (!frame || event.source !== frame.contentWindow) return
  // sandbox 无 allow-same-origin 时 origin 为 "null"；同源仅用于本地非沙箱预览
  if (event.origin !== 'null' && event.origin !== window.location.origin) return
  if (!accepting || !channel.value) return
  const data = event.data
  if (
    !data ||
    typeof data !== 'object' ||
    typeof data.channel !== 'string' ||
    !data.channel ||
    data.channel !== channel.value
  ) {
    return
  }

  switch (data.type) {
    case 'ready':
      ready = true
      clearReadyTimer()
      sendTheme()
      emit('ready')
      break
    case 'selection': {
      const payload = (data.payload ?? {}) as Partial<PageSelection>
      emit('selection', {
        text: clip(payload.text, MAX_SELECTION_CHARS),
        blockText: clip(payload.blockText, MAX_BLOCK_CHARS),
        rect: payload.rect ?? null,
      })
      break
    }
    case 'request_next':
      emit('requestNext')
      break
    case 'request_prev':
      emit('requestPrev')
      break
    case 'request_assistant': {
      const quote = (data.payload ?? {}).quote
      emit('requestAssistant', clip(quote, MAX_QUOTE_CHARS))
      break
    }
    case 'event': {
      const eventPayload = (data.payload ?? {}) as Record<string, unknown>
      const type = eventPayload.type
      if (type === 'complete') emit('complete')
      else if (type === 'interaction') emit('interaction', eventPayload)
      break
    }
    case 'runtime_error': {
      const payload = data.payload ?? {}
      const message = typeof payload.message === 'string' ? payload.message : '页面运行出错'
      emit('runtimeError', message)
      break
    }
    default:
      break
  }
}

watch(
  () => props.bundle,
  () => build(),
  { immediate: true },
)

watch(
  () => props.theme,
  () => {
    if (ready) sendTheme()
  },
)

onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => {
  accepting = false
  clearReadyTimer()
  window.removeEventListener('message', onMessage)
})
</script>

<template>
  <iframe
    ref="iframe"
    :srcdoc="html"
    sandbox="allow-scripts"
    referrerpolicy="no-referrer"
    class="h-full w-full border-0 bg-panel"
    :title="bundle.manifest.title || '复习页'"
    @load="onFrameLoad"
  />
</template>