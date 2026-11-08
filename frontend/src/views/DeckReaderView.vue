<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Expand,
  MessageSquareText,
  Minimize,
  PanelRight,
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
import { FEATURES } from '@/lib/features'
import {
  nextPageId,
  prevPageId,
  sortedPages,
} from '@/lib/deck'
import { useThemeStore } from '@/stores/theme'
import { useToastStore } from '@/stores/toast'
import AppButton from '@/components/AppButton.vue'
import AppIconButton from '@/components/AppIconButton.vue'
import ErrorState from '@/components/ErrorState.vue'
import LoadingSkeleton from '@/components/LoadingSkeleton.vue'
import Modal from '@/components/Modal.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import PageFrame from '@/components/deck/PageFrame.vue'
import PageProgress from '@/components/deck/PageProgress.vue'
import SelectionAction from '@/components/deck/SelectionAction.vue'
import DeckAssistantDrawer from '@/components/deck/DeckAssistantDrawer.vue'
import DeckRoleBadge from '@/components/deck/DeckRoleBadge.vue'
import DeckStudyPanel from '@/components/deck/DeckStudyPanel.vue'

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
const pageFrameRef = ref<InstanceType<typeof PageFrame> | null>(null)
const assistantDrawerRef = ref<InstanceType<typeof DeckAssistantDrawer> | null>(null)

const drawerOpen = ref(false)
const assistantQuote = ref('')
const assistantBlock = ref('')

const studyOpen = ref(false)
const frameComplete = ref(false)
const checkDone = ref(false)
const rebuildOpen = ref(false)
const rebuildFeedback = ref('')
const actionBusy = ref(false)
const completing = ref(false)

const selection = ref<{
  text: string
  blockText: string
  x: number
  y: number
} | null>(null)

const isFullscreen = ref(false)
const bundleCache = new Map<string, PageBundle>()
const BUNDLE_CACHE_LIMIT = 6
let pageLoadToken = 0

const pages = computed(() => (deck.value ? sortedPages(deck.value) : []))
const currentIndex = computed(() => (page.value ? page.value.ordinal + 1 : 0))
const totalPages = computed(() => pages.value.length)
const completedCount = computed(() => deck.value?.completed_page_ids.length ?? 0)
const currentCompleted = computed(
  () => !!page.value && (deck.value?.completed_page_ids ?? []).includes(page.value.id),
)
const canComplete = computed(() => frameComplete.value || checkDone.value)
const nextId = computed(() =>
  deck.value && page.value ? nextPageId(deck.value, page.value.id) : null,
)
const prevId = computed(() =>
  deck.value && page.value ? prevPageId(deck.value, page.value.id) : null,
)
const manifest = computed<PageManifest>(() => bundle.value?.manifest ?? {})
const isFlowPage = computed(
  () => manifest.value.design_system === '2.0' && manifest.value.teaching?.scroll === 'flow',
)
const pageTitle = computed(
  () =>
    manifest.value.title ||
    page.value?.manifest_title ||
    page.value?.title ||
    '',
)
const assistantInfo = computed(() => manifest.value.assistant ?? {})
const theme = computed(() => themeStore.theme)

function cacheKey(pageId: number, version: number): string {
  return `${pageId}:${version}`
}

function rememberBundle(key: string, value: PageBundle) {
  if (bundleCache.has(key)) bundleCache.delete(key)
  bundleCache.set(key, value)
  while (bundleCache.size > BUNDLE_CACHE_LIMIT) {
    const oldest = bundleCache.keys().next().value
    if (oldest === undefined) break
    bundleCache.delete(oldest)
  }
}

async function fetchBundle(summary: DeckPageSummary): Promise<PageBundle> {
  const key = cacheKey(summary.id, summary.current_version)
  const cached = bundleCache.get(key)
  if (cached) return cached
  const value = await getPageBundle(deckId.value, summary.id)
  rememberBundle(key, value)
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
      rememberBundle(key, value)
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
  frameComplete.value = false
  checkDone.value = false
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

async function markComplete() {
  const current = page.value
  if (!current || current.status !== 'ready' || currentCompleted.value || completing.value) return
  completing.value = true
  try {
    const progress = await updateDeckProgress(deckId.value, {
      last_page_id: current.id,
      completed_page_ids: [current.id],
    })
    if (deck.value) {
      deck.value.last_page_id = progress.last_page_id
      deck.value.completed_page_ids = progress.completed_page_ids
    }
    toast.success('已标记学完本页')
  } catch (error) {
    toast.error(error instanceof ApiError ? error.detail : '标记失败，请重试')
  } finally {
    completing.value = false
  }
}

async function goTo(pageId: number | null) {
  if (!pageId || pageId === page.value?.id) return
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

function openAssistantQuestion(question: string) {
  openAssistant()
  if (question) {
    void nextTick(() => assistantDrawerRef.value?.setDraft(question))
  }
}

function focusBlock(blockId: string) {
  pageFrameRef.value?.focusBlock(blockId)
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
  frameComplete.value = true
  toast.info('页面交互已完成，可以标记“学完本页”')
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
  if (studyOpen.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      studyOpen.value = false
    }
    return
  }
  if (drawerOpen.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      drawerOpen.value = false
    }
    return
  }
  if (rebuildOpen.value) return
  if (isTypingTarget(event.target)) return
  if (event.key === ' ' && isControlTarget(event.target)) return

  if (isFlowPage.value) {
    // flow 页由 iframe 自己纵向滚动：只保留左右翻页，Space/PageDown/ArrowUp/Down 交给浏览器
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      void goTo(nextId.value)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      void goTo(prevId.value)
    } else if (event.key === 'Escape') {
      if (document.fullscreenElement) void document.exitFullscreen()
      selection.value = null
    }
    return
  }

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
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header class="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-panel px-2 sm:px-4">
      <AppIconButton label="返回复习页总览" @click="goOverview">
        <ArrowLeft class="h-4 w-4" />
      </AppIconButton>
      <div class="hidden min-w-0 sm:block">
        <div class="flex min-w-0 items-center gap-2">
          <p class="truncate text-sm font-semibold text-ink">{{ deck?.title || '复习页' }}</p>
          <DeckRoleBadge
            :role="page?.teaching_role"
            :checks="page?.check_count"
            :minutes="page?.estimated_minutes"
            :score="page?.teaching_score"
            compact
          />
        </div>
        <p class="truncate text-[11px] text-muted">{{ pageTitle || '加载中…' }}</p>
      </div>

      <div class="mx-auto flex items-center gap-2">
        <AppIconButton
          label="上一页"
          size="sm"
          :disabled="!prevId"
          @click="goTo(prevId)"
        >
          <ChevronLeft class="h-4 w-4" />
        </AppIconButton>
        <PageProgress
          :current="currentIndex"
          :total="totalPages"
          :completed="completedCount"
          :ready="deck?.ready_pages"
        />
        <AppIconButton
          label="下一页"
          size="sm"
          :disabled="!nextId"
          @click="goTo(nextId)"
        >
          <ChevronRight class="h-4 w-4" />
        </AppIconButton>
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <button
          v-if="canComplete && !currentCompleted"
          type="button"
          class="hidden h-9 items-center gap-1.5 rounded-2xl bg-invert px-3 text-xs font-medium text-invert-ink transition-opacity hover:opacity-90 disabled:opacity-45 sm:inline-flex"
          :disabled="completing"
          @click="markComplete"
        >
          <Check class="h-3.5 w-3.5" />
          学完本页
        </button>
        <span
          v-else-if="currentCompleted"
          class="hidden items-center gap-1 text-xs text-muted sm:inline-flex"
        >
          <Check class="h-3.5 w-3.5" />
          已学完
        </span>
        <AppIconButton
          label="学习面板"
          :active="studyOpen"
          @click="studyOpen = !studyOpen"
        >
          <PanelRight class="h-4 w-4" />
        </AppIconButton>
        <AppIconButton v-if="FEATURES.deckChat" label="打开 AI 助手" @click="openAssistant()">
          <MessageSquareText class="h-4 w-4" />
        </AppIconButton>
        <div class="hidden md:block">
          <ThemeToggle size="sm" />
        </div>
        <div class="hidden md:block">
          <AppIconButton
            :label="isFullscreen ? '退出全屏' : '全屏阅读'"
            @click="toggleFullscreen"
          >
            <Minimize v-if="isFullscreen" class="h-4 w-4" />
            <Expand v-else class="h-4 w-4" />
          </AppIconButton>
        </div>
        <AppIconButton v-if="FEATURES.deckBuild" label="重做这一页" @click="rebuildOpen = true">
          <RotateCcw class="h-4 w-4" />
        </AppIconButton>
      </div>
    </header>

    <main class="relative flex min-h-0 flex-1 items-center justify-center bg-surface p-2 sm:p-3">
      <div
        ref="stageRef"
        class="relative flex h-full w-full max-w-[1600px] items-center justify-center overflow-hidden rounded-2xl border border-border bg-panel shadow-sm"
      >
        <transition name="page-switch" mode="out-in">
          <PageFrame
            v-if="bundle && !frameError"
            ref="pageFrameRef"
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
        </transition>

        <div
          v-if="loading"
          class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-panel px-8"
        >
          <LoadingSkeleton :lines="4" label="正在加载页面" />
          <p class="text-sm text-muted">正在加载页面…</p>
        </div>

        <div
          v-else-if="bundle && !frameReady && !frameError"
          class="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-panel"
        >
          <LoadingSkeleton :lines="2" label="正在准备页面运行时" class="max-w-xs" />
          <p class="text-sm text-muted">正在准备页面运行时…</p>
        </div>

        <div
          v-if="!loading && (notFound || pageError || frameError)"
          class="absolute inset-0 z-20 flex flex-col items-center justify-center bg-panel"
        >
          <ErrorState
            :title="notFound ? '页面不存在' : '页面暂时无法阅读'"
            :message="notFound ? '它可能已被删除，或你没有访问权限。' : pageError || frameError"
            :retry="!notFound"
            @retry="frameError ? retryFrame() : loadPage()"
          >
            <button
              type="button"
              class="inline-flex h-9 items-center rounded-2xl border border-border bg-panel px-3.5 text-sm font-medium text-ink transition-colors hover:border-border-strong hover:bg-raised"
              @click="goOverview"
            >
              返回总览
            </button>
          </ErrorState>
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
        :visible="FEATURES.deckChat && !!selection && !drawerOpen"
        :x="selection?.x ?? 0"
        :y="selection?.y ?? 0"
        :text="selection?.text ?? ''"
        @ask="openAssistant(selection?.text ?? '', selection?.blockText ?? '')"
      />
    </main>

    <DeckAssistantDrawer
      ref="assistantDrawerRef"
      :open="drawerOpen"
      :deck-id="deckId"
      :page-id="routePageId"
      :page-title="pageTitle"
      :quote="assistantQuote"
      :block-text="assistantBlock"
      :suggested-questions="assistantInfo.suggested_questions ?? []"
      @close="drawerOpen = false"
    />

    <DeckStudyPanel
      :open="studyOpen"
      :manifest="manifest"
      :page-title="pageTitle"
      :completed="currentCompleted"
      :can-complete="canComplete"
      :check-count="page?.check_count"
      :minutes="page?.estimated_minutes"
      :score="page?.teaching_score"
      :suggested-questions="assistantInfo.suggested_questions ?? []"
      @close="studyOpen = false"
      @focus-block="focusBlock"
      @complete="markComplete"
      @checked="checkDone = true"
      @ask="openAssistantQuestion"
    />

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

<style scoped>
.page-switch-enter-active,
.page-switch-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.page-switch-enter-from {
  opacity: 0;
  transform: translateX(6px);
}
.page-switch-leave-to {
  opacity: 0;
  transform: translateX(-6px);
}
@media (prefers-reduced-motion: reduce) {
  .page-switch-enter-active,
  .page-switch-leave-active {
    transition: none;
  }
}
</style>