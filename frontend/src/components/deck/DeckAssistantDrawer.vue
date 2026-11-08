<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { AlertCircle, MessageSquareText, RotateCcw, Send, Sparkles, X } from 'lucide-vue-next'
import { ApiError } from '@/api/client'
import {
  listPageMessages,
  streamPageMessage,
  type PageMessageRef,
} from '@/api/decks'
import type { PageChatMessage } from '@/types'
import MarkdownView from '@/components/MarkdownView.vue'

const props = defineProps<{
  open: boolean
  deckId: number
  pageId: number
  pageTitle: string
  quote: string
  blockText: string
  suggestedQuestions?: string[]
}>()

const emit = defineEmits<{ close: [] }>()

const messages = ref<PageChatMessage[]>([])
const loading = ref(false)
const streaming = ref(false)
const error = ref('')
const retryQuestion = ref('')
const draft = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
const closeEl = ref<HTMLButtonElement | null>(null)
const scrollEl = ref<HTMLElement | null>(null)

let controller: AbortController | null = null
let historyToken = 0

const fallbackActions = ['解释这段', '举个例子', '帮我记', '考考我', '和上一页有什么关系']
const quickActions = computed(() =>
  props.suggestedQuestions?.length ? props.suggestedQuestions.slice(0, 5) : fallbackActions,
)
const canSend = computed(() => draft.value.trim().length > 0 && !streaming.value)

function scrollToBottom() {
  void nextTick(() => {
    const el = scrollEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

async function loadHistory() {
  const token = ++historyToken
  loading.value = true
  error.value = ''
  try {
    const history = await listPageMessages(props.deckId, props.pageId)
    if (token !== historyToken) return
    messages.value = history
  } catch {
    if (token === historyToken) messages.value = []
  } finally {
    if (token === historyToken) {
      loading.value = false
      scrollToBottom()
      await nextTick()
      closeEl.value?.focus()
    }
  }
}

watch(
  () => [props.open, props.pageId] as const,
  ([open], previous) => {
    const pageChanged = Boolean(previous && previous[1] !== props.pageId)
    if (!open) {
      historyToken += 1
      controller?.abort()
      controller = null
      streaming.value = false
      return
    }
    if (pageChanged) {
      historyToken += 1
      controller?.abort()
      controller = null
      streaming.value = false
      messages.value = []
      draft.value = ''
      error.value = ''
      retryQuestion.value = ''
    }
    void loadHistory()
  },
  { immediate: true },
)

function insertQuickAction(text: string) {
  draft.value = text
  inputEl.value?.focus()
}

function setDraft(text: string) {
  draft.value = text
  void nextTick(() => inputEl.value?.focus())
}

function refsOf(message: PageChatMessage): PageMessageRef[] {
  return (message.context_refs ?? []) as unknown as PageMessageRef[]
}

function uniqueRefLabels(refs: PageMessageRef[]): string[] {
  const labels: string[] = []
  for (const ref of refs) {
    const label = [ref.material_name, ref.heading].filter(Boolean).join(' · ')
    if (label && !labels.includes(label)) labels.push(label)
  }
  return labels
}

async function send(text?: string) {
  const question = (text ?? draft.value).trim()
  if (!question || streaming.value || !props.open) return

  controller?.abort()
  const active = new AbortController()
  controller = active
  // 历史请求若在发送后才返回，不得覆盖乐观消息与流式回答
  historyToken += 1
  loading.value = false

  error.value = ''
  retryQuestion.value = ''
  draft.value = ''

  const now = new Date().toISOString()
  const userTempId = -Date.now()
  const assistantTempId = userTempId - 1
  messages.value.push(
    {
      id: userTempId,
      deck_id: props.deckId,
      page_id: props.pageId,
      role: 'user',
      status: 'done',
      content: question,
      quote: props.quote.trim() || null,
      context_refs: [],
      created_at: now,
    },
    {
      id: assistantTempId,
      deck_id: props.deckId,
      page_id: props.pageId,
      role: 'assistant',
      status: 'streaming',
      content: '',
      quote: null,
      context_refs: [],
      created_at: now,
    },
  )
  streaming.value = true
  scrollToBottom()

  const finishWithError = (detail: string) => {
    error.value = detail
    retryQuestion.value = question
    const target = messages.value.find((item) => item.id === assistantTempId)
    if (target) target.status = 'failed'
  }

  const discardOptimistic = () => {
    messages.value = messages.value.filter(
      (item) => item.id !== userTempId && item.id !== assistantTempId,
    )
    draft.value = question
  }

  try {
    await streamPageMessage(
      props.deckId,
      props.pageId,
      {
        content: question,
        quote: props.quote.trim() || null,
        block_text: props.blockText.trim() || null,
      },
      {
        onDelta: (delta) => {
          const target = messages.value.find((item) => item.id === assistantTempId)
          if (!target) return
          target.content += delta
          scrollToBottom()
        },
        onDone: ({ message_id, refs }) => {
          const target = messages.value.find((item) => item.id === assistantTempId)
          if (!target) return
          target.id = message_id || assistantTempId
          target.status = 'done'
          target.context_refs = refs as unknown as Record<string, unknown>[]
          scrollToBottom()
        },
        onError: (detail) => finishWithError(detail),
      },
      active.signal,
    )
    const target = messages.value.find(
      (item) => item.id === assistantTempId && item.status === 'streaming',
    )
    if (!active.signal.aborted && target) {
      finishWithError('连接已中断，回答可能不完整，请重试')
    }
  } catch (err) {
    if (active.signal.aborted) {
      const target = messages.value.find((item) => item.id === assistantTempId)
      if (target) target.status = 'failed'
    } else if (err instanceof ApiError) {
      // HTTP 层拒绝（503/429/400）时后端未保存消息，撤回乐观气泡并回填问题
      discardOptimistic()
      error.value = err.detail
      retryQuestion.value = question
    } else if (err instanceof Error && err.name === 'AbortError') {
      const target = messages.value.find((item) => item.id === assistantTempId)
      if (target) target.status = 'failed'
    } else {
      finishWithError('页面助手暂时不可用，请稍后重试')
    }
  } finally {
    if (controller === active) {
      controller = null
      streaming.value = false
    }
    if (!active.signal.aborted) scrollToBottom()
  }
}

function retry() {
  const question = retryQuestion.value
  retryQuestion.value = ''
  error.value = ''
  if (question) void send(question)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  if (canSend.value) void send()
}

defineExpose({ send, setDraft })
</script>

<template>
  <teleport to="body">
    <transition name="drawer">
      <div v-if="open" class="fixed inset-0 z-drawer">
        <div class="absolute inset-0 bg-overlay" @click="emit('close')" />
        <aside
          class="absolute inset-y-0 right-0 flex w-full max-w-[420px] flex-col border-l border-border bg-panel shadow-pop"
          role="dialog"
          aria-modal="true"
          aria-label="页面 AI 助手"
        >
          <header class="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <Sparkles class="h-4 w-4 text-muted" />
                <h2 class="text-sm font-semibold text-ink">页面 AI 助手</h2>
                <span
                  v-if="streaming"
                  class="rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted"
                >
                  回答中
                </span>
              </div>
              <p class="mt-0.5 truncate text-xs text-muted">{{ pageTitle }}</p>
            </div>
            <button
              ref="closeEl"
              type="button"
              class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-ink"
              aria-label="关闭助手"
              @click="emit('close')"
            >
              <X class="h-4 w-4" />
            </button>
          </header>

          <div
            v-if="quote || blockText"
            class="shrink-0 border-b border-border bg-raised px-5 py-3"
          >
            <p class="text-[11px] font-semibold uppercase tracking-wider text-faint">引用上下文</p>
            <blockquote class="mt-1.5 line-clamp-4 border-l-2 border-border-strong pl-2.5 text-sm leading-relaxed text-ink">
              {{ quote || blockText }}
            </blockquote>
          </div>

          <div
            ref="scrollEl"
            class="min-h-0 flex-1 overflow-y-auto px-5 py-4"
            aria-live="polite"
            :aria-busy="streaming"
          >
            <div v-if="loading" class="text-xs text-muted">正在加载对话…</div>
            <template v-else>
              <div v-if="messages.length" class="space-y-4">
                <div
                  v-for="message in messages"
                  :key="message.id"
                  class="flex"
                  :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
                >
                  <div
                    v-if="message.role === 'user'"
                    class="max-w-[85%] rounded-2xl border border-transparent bg-invert px-3.5 py-2.5 text-sm leading-relaxed text-invert-ink"
                  >
                    <p class="whitespace-pre-wrap break-words">{{ message.content }}</p>
                  </div>
                  <div
                    v-else
                    class="max-w-[92%] rounded-2xl border px-3.5 py-2.5 text-sm leading-relaxed"
                    :class="
                      message.status === 'failed'
                        ? 'border-danger/40 bg-danger-soft text-ink'
                        : 'border-border bg-panel text-ink'
                    "
                  >
                    <MarkdownView v-if="message.content" :content="message.content" />
                    <p v-else-if="message.status === 'streaming'" class="text-xs text-muted">
                      正在组织回答…
                    </p>
                    <p v-else class="text-xs text-muted">
                      {{ message.status === 'failed' ? '回答失败' : '（无内容）' }}
                    </p>
                    <span
                      v-if="message.status === 'streaming' && message.content"
                      class="ml-0.5 inline-block h-3.5 w-1 translate-y-0.5 rounded-sm bg-muted motion-safe:animate-pulse"
                      aria-hidden="true"
                    />
                    <div
                      v-if="uniqueRefLabels(refsOf(message)).length"
                      class="mt-2 flex flex-wrap gap-1 border-t border-border pt-2"
                    >
                      <span
                        v-for="label in uniqueRefLabels(refsOf(message))"
                        :key="label"
                        class="rounded-full bg-raised px-2 py-0.5 text-[11px] text-muted"
                      >
                        {{ label }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else class="flex flex-col items-center px-4 py-12 text-center">
                <MessageSquareText class="h-7 w-7 text-faint" />
                <p class="mt-3 text-sm font-medium text-ink">选中页面中的文字，或直接提问</p>
                <p class="mt-1 text-xs leading-relaxed text-muted">
                  助手只依据当前页面、选中内容与来源段落回答；资料未覆盖时会明确说明。
                </p>
              </div>
            </template>
          </div>

          <div v-if="error" class="shrink-0 border-t border-border bg-danger-soft px-5 py-2.5">
            <div class="flex items-start gap-2 text-xs leading-relaxed text-ink">
              <AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p class="min-w-0 flex-1 break-words">{{ error }}</p>
              <button
                v-if="retryQuestion"
                type="button"
                class="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-panel px-2 py-0.5 text-[11px] text-ink transition-colors hover:border-border-strong"
                @click="retry"
              >
                <RotateCcw class="h-3 w-3" />
                重试
              </button>
            </div>
          </div>

          <div class="shrink-0 border-t border-border px-5 py-3">
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="action in quickActions"
                :key="action"
                type="button"
                class="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-border-strong hover:text-ink"
                @click="insertQuickAction(action)"
              >
                {{ action }}
              </button>
            </div>
            <div class="mt-2.5 flex items-end gap-2">
              <textarea
                ref="inputEl"
                v-model="draft"
                rows="2"
                placeholder="就当前页面提问，Enter 发送，Shift+Enter 换行"
                class="min-h-11 flex-1 resize-none rounded-2xl border border-border bg-raised px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-border-strong focus:outline-none"
                @keydown="onKeydown"
              />
              <button
                type="button"
                :disabled="!canSend"
                class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-invert text-invert-ink transition-opacity disabled:opacity-45"
                :aria-label="streaming ? '正在回答' : '发送问题'"
                @click="send()"
              >
                <Send class="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.18s ease;
}
.drawer-enter-active aside,
.drawer-leave-active aside {
  transition: transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-from aside,
.drawer-leave-to aside {
  transform: translateX(24px);
}
</style>