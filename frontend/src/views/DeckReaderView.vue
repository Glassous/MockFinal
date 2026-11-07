<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Expand,
  BookOpen,
  Loader2,
  MessageSquareText,
  Minimize,
  RotateCcw,
} from 'lucide-vue-next'
import type { Deck, DeckPageSummary, PageBundle, PageManifest } from '@/types'
import {
  getDeck,
  getPageBundle,
  rebuildPage,
  updateDeckProgress,
} from '@/api/decks'
import { ApiError } from '@/api/client'
import {
  nextPageId,
  prevPageId,
  sortedPages,
} from '@/lib/deck'
import { useThemeStore } from '@/stores/theme'
import { useToastStore } from '@/stores/toast'
import AppButton from '@/components/AppButton.vue'
import Modal from '@/components/Modal.vue'
import PageFrame from '@/components/deck/PageFrame.vue'
import PageProgress from '@/components/deck/PageProgress.vue'
import SelectionAction from '@/components/deck/SelectionAction.vue'
import DeckAssistantDrawer from '@/components/deck/DeckAssistantDrawer.vue'

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()
const toast = useToastStore()

const workspaceId = computed(() => Number(route.params.id))
const deckId = computed(() => Number(route.params.deckId))
const routePageId = computed(() => Number(route.params.pageId))

const deck = ref<Deck | null>(null)
const page = ref<DeckPageSummary | null>(null)
const bundle = ref<PageBundle | null>(null)
const loading = ref(true)
const notFound = ref(false)
const pageError = ref('')
const frameError = ref('')
const runtimeError = ref('')
const frameReady = ref(false)
const frameKey = ref(0)
const stageRef = ref<HTMLElement | null>(null)

const drawerOpen = ref(false)
const assistantQuote = ref('')
const assistantBlock = ref('')

const sourceOpen = ref(false)
const rebuildOpen = ref(false)
const rebuildFeedback = ref('')
const actionBusy = ref(false)

const selection = ref<{
  text: string
  blockText: string
  x: number
  y: number
} | null>(null)

const isFullscreen = ref(false)
const bundleCache = new Map<string, PageBundle>()
let viewStart = 0
let pageLoadToken = 0
const completedSent = new Set<number>()

const pages = computed(() => (deck.value ? sortedPages(deck.value) : []))
const currentIndex = computed(() => (page.value ? page.value.ordinal + 1 : 0))
const totalPages = computed(() => pages.value.length)
const completedCount = computed(() => deck.value?.completed_page_ids.length ?? 0)
const nextId = computed(() =>
  deck.value && page.value ? nextPageId(deck.value, page.value.id) : null,
)
const prevId = computed(() =>
  deck.value && page.value ? prevPageId(deck.value, page.value.id) : null,
)
const manifest = computed<PageManifest>(() => bundle.value?.manifest ?? {})
const pageTitle = computed(
  () =>
    manifest.value.title ||
    page.value?.manifest_title ||
    page.value?.title ||
    '',
)
const sourceRefs = computed(() => manifest.value.source_refs ?? [])
const assistantInfo = computed(() => manifest.value.assistant ?? {})
const theme = computed(() => themeStore.theme)

function cacheKey(pageId: number, version: number): string {
  return `${pageId}:${version}`
}

async function fetchBundle(summary: DeckPageSummary): Promise<PageBundle> {
  const key = cacheKey(summary.id, summary.current_version)
  const cached = bundleCache.get(key)
  if (cached) return cached
  const value = await getPageBundle(deckId.value, summary.id)
  bundleCache.set(key, value)
  return value
}

async function prefetchNeighbors() {
  if (!deck.value || !page.value) return
  for (const offset of [-1, 1]) {
    const index = pages.value.findIndex((item) => item.id === page.value?.id)
    const neighbor = pages.value[index + offset]
    if (!neighbor || neighbor.status !== 'ready' || !neighbor.has_bundle) continue
    const key = cacheKey(neighbor.id, neighbor.current_version)
    if (bundleCache.has(key)) continue
    try {
      const value = await getPageBundle(deckId.value, neighbor.id)
      bundleCache.set(key, value)
    } catch {
      /* 预加载失败不影响当前页 */
    }
  }
}

async function loadPage() {
  const token = ++pageLoadToken
  loading.value = true
  notFound.value = false
  pageError.value = ''
  frameError.value = ''
  runtimeError.value = ''
  frameReady.value = false
  bundle.value = null
  page.value = null
  selection.value = null
  drawerOpen.value = false
  assistantQuote.value = ''
  assistantBlock.value = ''

  const pageId = routePageId.value
  if (!Number.isFinite(pageId) || pageId <= 0) {
    notFound.value = true
    loading.value = false
    return
  }

  try {
    if (!deck.value || deck.value.id !== deckId.value) {
      const loadedDeck = await getDeck(deckId.value)
      if (token !== pageLoadToken) return
      deck.value = loadedDeck
    }
    const summary = deck.value.pages.find((item) => item.id === pageId) ?? null
    if (!summary) {
      if (token === pageLoadToken) {
        notFound.value = true
        loading.value = false
      }
      return
    }
    if (summary.status !== 'ready' || !summary.has_bundle) {
      if (token === pageLoadToken) {
        page.value = summary
        pageError.value = '页面尚未构建完成，暂时无法阅读。'
        loading.value = false
      }
      return
    }
    const loadedBundle = await fetchBundle(summary)
    if (token !== pageLoadToken) return
    page.value = summary
    bundle.value = loadedBundle
    viewStart = Date.now()
    void touchLastPage(summary.id)
    void prefetchNeighbors()
  } catch (error) {
    if (token !== pageLoadToken) return
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      if (error.status === 403) notFound.value = true
      else pageError.value = error.detail || '页面数据不存在或已被替换，请回到总览刷新。'
    } else if (error instanceof ApiError && error.status !== 401) {
      pageError.value = error.detail
    } else if (!(error instanceof ApiError)) {
      pageError.value = '页面加载失败，请检查网络后重试。'
    }
  } finally {
    if (token === pageLoadToken) loading.value = false
  }
}

async function touchLastPage(pageId: number) {
  try {
    await updateDeckProgress(deckId.value, { last_page_id: pageId })
    if (deck.value) deck.value.last_page_id = pageId
  } catch {
    /* 进度上报失败不阻断阅读 */
  }
}

function completeIfNeeded(force = false) {
  const current = page.value
  if (!current || current.status !== 'ready') return
  if (completedSent.has(current.id)) return
  if (!force && Date.now() - viewStart < 3000) return
  completedSent.add(current.id)
  void updateDeckProgress(deckId.value, {
    last_page_id: current.id,
    completed_page_ids: [current.id],
  })
    .then((progress) => {
      if (deck.value) {
        deck.value.last_page_id = progress.last_page_id
        deck.value.completed_page_ids = progress.completed_page_ids
      }
    })
    .catch(() => {
      completedSent.delete(current.id)
    })
}

async function goTo(pageId: number | null) {
  if (!pageId || pageId === page.value?.id) return
  completeIfNeeded()
  selection.value = null
  await router.push({
    name: 'deck-reader',
    params: { id: workspaceId.value, deckId: deckId.value, pageId },
  })
}

function retryFrame() {
  frameError.value = ''
  runtimeError.value = ''
  frameReady.value = false
  frameKey.value += 1
}

function onFrameError(message: string) {
  frameError.value = message
  frameReady.value = false
}

function openAssistant(quote = '', blockText = '') {
  assistantQuote.value = quote
  assistantBlock.value = blockText
  selection.value = null
  drawerOpen.value = true
}

function onSelection(payload: {
  text: string
  blockText: string
  rect: { x: number; y: number; width: number; height: number } | null
}) {
  if (!payload.text) {
    selection.value = null
    return
  }
  const stage = stageRef.value?.getBoundingClientRect()
  if (!stage || !payload.rect) {
    selection.value = null
    return
  }
  const centerX = stage.left + payload.rect.x + payload.rect.width / 2
  const aboveY = stage.top + payload.rect.y - 40
  selection.value = {
    text: payload.text,
    blockText: payload.blockText,
    x: centerX - 52,
    y: aboveY < stage.top + 4 ? stage.top + payload.rect.y + payload.rect.height + 10 : aboveY,
  }
}

function onFrameComplete() {
  completeIfNeeded(true)
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      // 抽屉/弹窗通过 teleport 挂在 body 上，必须全屏整个文档根才能保持可见
      await document.documentElement.requestFullscreen()
    }
  } catch {
    toast.error('当前浏览器不支持全屏显示')
  }
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName?.toLowerCase()
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    element.isContentEditable
  )
}

function isControlTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  return !!element.closest('button, a, [role="button"]')
}

function onKeydown(event: KeyboardEvent) {
  if (drawerOpen.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      drawerOpen.value = false
    }
    return
  }
  if (sourceOpen.value || rebuildOpen.value) return
  if (isTypingTarget(event.target)) return
  if (event.key === ' ' && isControlTarget(event.target)) return

  if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'PageDown') {
    event.preventDefault()
    void goTo(nextId.value)
  } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
    event.preventDefault()
    void goTo(prevId.value)
  } else if (event.key === 'Escape') {
    if (document.fullscreenElement) void document.exitFullscreen()
    selection.value = null
  }
}

async function submitRebuild() {
  if (!page.value || actionBusy.value) return
  actionBusy.value = true
  try {
    const result = await rebuildPage(
      deckId.value,
      page.value.id,
      rebuildFeedback.value.trim() || undefined,
    )
    rebuildOpen.value = false
    toast.success('已开始重做该页，旧版本在新版本就绪前仍可阅读')
    await router.push({
      name: 'deck-build',
      params: { id: workspaceId.value, deckId: deckId.value },
      query: { job: String(result.job_id) },
    })
  } catch (error) {
    toast.error(error instanceof ApiError ? error.detail : '重做失败，请重试')
  } finally {
    actionBusy.value = false
  }
}

function goOverview() {
  completeIfNeeded()
  void router.push({
    name: 'deck-overview',
    params: { id: workspaceId.value, deckId: deckId.value },
  })
}

watch(
  () => routePageId.value,
  () => void loadPage(),
)

watch(
  () => pageTitle.value,
  (title) => {
    if (title && deck.value) {
      document.title = `${title} · ${deck.value.title} · MockFinal`
    }
  },
)

onMounted(() => {
  void loadPage()
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('fullscreenchange', onFullscreenChange)
})

onBeforeUnmount(() => {
  pageLoadToken += 1
  completeIfNeeded()
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header class="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-panel px-2 sm:px-4">
      <button
        type="button"
        class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-muted transition-colors hover:bg-raised hover:text-ink"
        aria-label="返回复习页总览"
        title="返回总览"
        @click="goOverview"
      >
        <ArrowLeft class="h-4 w-4" />
      </button>
      <div class="hidden min-w-0 sm:block">
        <p class="truncate text-sm font-semibold text-ink">{{ deck?.title || '复习页' }}</p>
        <p class="truncate text-[11px] text-muted">{{ pageTitle || '加载中…' }}</p>
      </div>

      <div class="mx-auto flex items-center gap-2">
        <button
          type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-35"
          :disabled="!prevId"
          aria-label="上一页"
          @click="goTo(prevId)"
        >
          <ChevronLeft class="h-4 w-4" />
        </button>
        <PageProgress
          :current="currentIndex"
          :total="totalPages"
          :completed="completedCount"
        />
        <button
          type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-35"
          :disabled="!nextId"
          aria-label="下一页"
          @click="goTo(nextId)"
        >
          <ChevronRight class="h-4 w-4" />
        </button>
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="inline-flex h-9 w-9 items-center justify-center rounded-2xl text-muted transition-colors hover:bg-raised hover:text-ink"
          aria-label="查看依据资料"
          title="依据资料"
          @click="sourceOpen = true"
        >
          <BookOpen class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="inline-flex h-9 w-9 items-center justify-center rounded-2xl text-muted transition-colors hover:bg-raised hover:text-ink"
          aria-label="打开 AI 助手"
          title="AI 助手"
          @click="openAssistant()"
        >
          <MessageSquareText class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="hidden h-9 w-9 items-center justify-center rounded-2xl text-muted transition-colors hover:bg-raised hover:text-ink md:inline-flex"
          :aria-label="isFullscreen ? '退出全屏' : '全屏阅读'"
          :title="isFullscreen ? '退出全屏' : '全屏'"
          @click="toggleFullscreen"
        >
          <Minimize v-if="isFullscreen" class="h-4 w-4" />
          <Expand v-else class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="inline-flex h-9 w-9 items-center justify-center rounded-2xl text-muted transition-colors hover:bg-raised hover:text-ink"
          aria-label="重做这一页"
          title="这一页需要调整"
          @click="rebuildOpen = true"
        >
          <RotateCcw class="h-4 w-4" />
        </button>
      </div>
    </header>

    <main class="relative flex min-h-0 flex-1 items-center justify-center bg-surface p-2 sm:p-3">
      <div
        ref="stageRef"
        class="relative flex h-full w-full max-w-[1600px] items-center justify-center overflow-hidden rounded-2xl border border-border bg-panel shadow-sm"
      >
        <PageFrame
          v-if="bundle && !frameError"
          :key="`${page?.id}-${frameKey}`"
          :bundle="bundle"
          :theme="theme"
          @ready="frameReady = true"
          @selection="onSelection"
          @request-next="goTo(nextId)"
          @request-prev="goTo(prevId)"
          @request-assistant="(quote) => openAssistant(quote, '')"
          @complete="onFrameComplete"
          @runtime-error="(message) => (runtimeError = message)"
          @error="onFrameError"
        />

        <div
          v-if="loading"
          class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-panel"
        >
          <Loader2 class="h-5 w-5 spin text-muted" />
          <p class="text-sm text-muted">正在加载页面…</p>
        </div>

        <div
          v-else-if="bundle && !frameReady && !frameError"
          class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-panel"
        >
          <div class="flex flex-col items-center gap-2 text-muted">
            <Loader2 class="h-5 w-5 spin" />
            <p class="text-sm">正在准备页面运行时…</p>
          </div>
        </div>

        <div
          v-if="!loading && (notFound || pageError || frameError)"
          class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-panel px-6 text-center"
        >
          <span class="inline-flex h-12 w-12 items-center justify-center rounded-full bg-raised text-ink">
            <AlertCircle class="h-5 w-5" />
          </span>
          <h2 class="text-lg font-semibold text-ink">
            {{ notFound ? '页面不存在' : '页面暂时无法阅读' }}
          </h2>
          <p class="max-w-md text-sm leading-relaxed text-muted">
            {{ notFound ? '它可能已被删除，或你没有访问权限。' : pageError || frameError }}
          </p>
          <div class="mt-2 flex flex-wrap justify-center gap-2">
            <AppButton variant="secondary" @click="goOverview">返回总览</AppButton>
            <AppButton v-if="!notFound" @click="frameError ? retryFrame() : loadPage()">
              重试
            </AppButton>
          </div>
        </div>

        <div
          v-if="runtimeError && !frameError"
          class="absolute bottom-3 left-1/2 z-20 flex max-w-[92%] -translate-x-1/2 items-start gap-2 rounded-2xl border border-border-strong bg-panel px-3 py-2 shadow-card"
          role="status"
        >
          <AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink" />
          <p class="min-w-0 break-words text-[11px] leading-relaxed text-muted">
            页面运行提示：{{ runtimeError }}
          </p>
          <button
            type="button"
            class="shrink-0 text-[11px] text-faint hover:text-ink"
            @click="runtimeError = ''"
          >
            关闭
          </button>
        </div>
      </div>

      <SelectionAction
        :visible="!!selection && !drawerOpen"
        :x="selection?.x ?? 0"
        :y="selection?.y ?? 0"
        :text="selection?.text ?? ''"
        @ask="openAssistant(selection?.text ?? '', selection?.blockText ?? '')"
      />
    </main>

    <DeckAssistantDrawer
      :open="drawerOpen"
      :deck-id="deckId"
      :page-id="routePageId"
      :page-title="pageTitle"
      :quote="assistantQuote"
      :block-text="assistantBlock"
      :suggested-questions="assistantInfo.suggested_questions ?? []"
      @close="drawerOpen = false"
    />

    <Modal
      :open="sourceOpen"
      title="依据资料"
      :description="pageTitle"
      size="lg"
      @close="sourceOpen = false"
    >
      <div v-if="assistantInfo.summary" class="rounded-2xl border border-border bg-raised px-3.5 py-3">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-faint">页面摘要</p>
        <p class="mt-1.5 text-sm leading-relaxed text-ink">{{ assistantInfo.summary }}</p>
        <ul v-if="assistantInfo.key_facts?.length" class="mt-2 space-y-1">
          <li
            v-for="fact in assistantInfo.key_facts"
            :key="fact"
            class="flex gap-1.5 text-xs leading-relaxed text-muted"
          >
            <span class="text-faint">·</span>
            <span>{{ fact }}</span>
          </li>
        </ul>
      </div>

      <div v-if="sourceRefs.length" class="mt-4 space-y-2.5">
        <div
          v-for="(ref, index) in sourceRefs"
          :key="`${ref.section_id}-${index}`"
          class="rounded-2xl border border-border bg-panel px-3.5 py-3"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-faint">
              来源 {{ index + 1 }}
            </span>
            <span v-if="ref.heading" class="text-sm font-medium text-ink">{{ ref.heading }}</span>
            <span
              v-if="ref.unverified"
              class="rounded-full border border-border-strong px-2 py-0.5 text-[10px] text-muted"
            >
              待核对
            </span>
          </div>
          <blockquote
            v-if="ref.quote"
            class="mt-2 border-l-2 border-border-strong pl-2.5 text-sm leading-relaxed text-muted"
          >
            {{ ref.quote }}
          </blockquote>
        </div>
      </div>
      <p v-else class="mt-4 text-sm text-muted">本页未引用资料段落。</p>
    </Modal>

    <Modal
      :open="rebuildOpen"
      title="重做这一页"
      :description="pageTitle"
      size="md"
      :close-on-overlay="!actionBusy"
      @close="rebuildOpen = false"
    >
      <label class="block text-sm font-medium text-ink" for="reader-rebuild-feedback">
        想调整什么？<span class="font-normal text-faint">（选填）</span>
      </label>
      <textarea
        id="reader-rebuild-feedback"
        v-model="rebuildFeedback"
        rows="4"
        maxlength="2000"
        placeholder="例如：动画太快，请放慢；公式推导再细一点；换一个例子。"
        class="mt-2 w-full resize-none rounded-2xl border border-border bg-panel px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-border-strong focus:outline-none"
      />
      <p class="mt-1.5 text-[11px] leading-relaxed text-faint">
        重做不会中断当前阅读；新版本通过校验后才会替换这一页。
      </p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <AppButton variant="secondary" :disabled="actionBusy" @click="rebuildOpen = false">
            取消
          </AppButton>
          <AppButton :loading="actionBusy" @click="submitRebuild">开始重做</AppButton>
        </div>
      </template>
    </Modal>
  </div>
</template>