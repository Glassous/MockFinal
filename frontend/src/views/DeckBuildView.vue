<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Hammer,
  Loader2,
  RotateCcw,
  XCircle,
} from 'lucide-vue-next'
import type { Deck, DeckEvent, DeckJob, DeckPageSummary, DeckStyle } from '@/types'
import {
  buildDeck,
  cancelDeckBuild,
  getDeck,
  getDeckJob,
  listDeckEvents,
  rebuildPage,
  updateDeck,
} from '@/api/decks'
import { ApiError } from '@/api/client'
import { FEATURES } from '@/lib/features'
import {
  eventText,
  isActiveJob,
  jobProgressText,
  mergeEvents,
  normalizeDeckStyle,
  pageDisplayTitle,
  sortedPages,
  TEACHING_ROLE_LABELS,
} from '@/lib/deck'
import { useToastStore } from '@/stores/toast'
import AppButton from '@/components/AppButton.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import Modal from '@/components/Modal.vue'
import DeckTopBar from '@/components/deck/DeckTopBar.vue'
import DeckStatusPill from '@/components/deck/DeckStatusPill.vue'
import BuildSetupPanel from '@/components/deck/BuildSetupPanel.vue'
import BuildTimeline from '@/components/deck/BuildTimeline.vue'
import BuildConsole from '@/components/deck/BuildConsole.vue'
import BuildPageGrid from '@/components/deck/BuildPageGrid.vue'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()

const workspaceId = computed(() => Number(route.params.id))
const deckId = computed(() => Number(route.params.deckId))

const deck = ref<Deck | null>(null)
const job = ref<DeckJob | null>(null)
const events = ref<DeckEvent[]>([])
const style = ref<DeckStyle>(normalizeDeckStyle(null))
const loading = ref(true)
const notFound = ref(false)
const setupBusy = ref(false)
const cancelOpen = ref(false)
const actionBusy = ref(false)

let jobId: number | null = null
let afterId = 0
let pollTimer: number | null = null
let disposed = false
let pollFailures = 0
let attachToken = 0

const active = computed(() => isActiveJob(job.value))
const terminal = computed(
  () => !!job.value && ['done', 'partial', 'failed', 'canceled'].includes(job.value.status),
)
const pages = computed(() => (deck.value ? sortedPages(deck.value) : []))
const failedPages = computed(() => pages.value.filter((page) => page.status === 'failed'))
const roleSummary = computed(() => {
  const counts = new Map<string, number>()
  for (const page of pages.value) {
    if (!page.teaching_role) continue
    counts.set(page.teaching_role, (counts.get(page.teaching_role) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([role, count]) => `${TEACHING_ROLE_LABELS[role as keyof typeof TEACHING_ROLE_LABELS]} ${count}`)
    .join(' · ')
})
const averageTeachingScore = computed(() => {
  const scores = pages.value
    .map((page) => page.teaching_score)
    .filter((score): score is number => typeof score === 'number')
  if (!scores.length) return null
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
})
const jobPercent = computed(() => {
  if (!job.value) return 0
  if (job.value.status === 'done' || job.value.status === 'partial') return 100
  if (!job.value.total_pages) return job.value.progress
  return Math.min(
    99,
    Math.round(
      ((job.value.ready_pages + job.value.failed_pages) / job.value.total_pages) * 100,
    ),
  )
})
const jobErrorText = computed(() => {
  if (!job.value) return ''
  if (job.value.error) return job.value.error
  const lastError = [...events.value].reverse().find((event) => event.type === 'error')
  return lastError ? eventText(lastError) : ''
})

function stopPolling() {
  if (pollTimer !== null) {
    window.clearTimeout(pollTimer)
    pollTimer = null
  }
}

function nextDelay(): number {
  return document.visibilityState === 'hidden' ? 5000 : 1000
}

function schedulePolling() {
  stopPolling()
  if (disposed || !active.value) return
  pollTimer = window.setTimeout(() => void poll(), nextDelay())
}

async function poll() {
  if (!jobId) return
  const currentJobId = jobId
  const token = attachToken
  try {
    const nextJob = await getDeckJob(currentJobId)
    if (token !== attachToken || currentJobId !== jobId) return
    if (nextJob.deck_id !== deckId.value) throw new ApiError(404, '构建任务不属于当前复习页')
    job.value = nextJob
    const incoming = await listDeckEvents(currentJobId, afterId)
    if (token !== attachToken || currentJobId !== jobId) return
    events.value = mergeEvents(events.value, incoming)
    if (incoming.length) afterId = incoming[incoming.length - 1].id
    pollFailures = 0
    if (!isActiveJob(nextJob)) {
      await refreshDeck()
      return
    }
  } catch (error) {
    if (token !== attachToken || currentJobId !== jobId) return
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      stopPolling()
      jobId = null
      job.value = null
      events.value = []
      afterId = 0
      if (route.query.job) {
        const query = { ...route.query }
        delete query.job
        await router.replace({ query })
      }
      await refreshDeck()
      toast.error('构建任务不存在或已失效，请从复习页重新开始构建')
      return
    }
    pollFailures += 1
    if (pollFailures === 3) {
      toast.error(error instanceof ApiError ? error.detail : '构建进度暂时无法获取，正在重试')
    }
  }
  if (token === attachToken && currentJobId === jobId) schedulePolling()
}

async function refreshDeck() {
  try {
    deck.value = await getDeck(deckId.value)
  } catch {
    /* 单次刷新失败不中断构建展示 */
  }
}

async function attachJob(id: number, replaceQuery = true) {
  stopPolling()
  attachToken += 1
  const token = attachToken
  pollFailures = 0
  jobId = id
  afterId = 0
  events.value = []
  try {
    const nextJob = await getDeckJob(id)
    if (token !== attachToken) return
    if (nextJob.deck_id !== deckId.value) {
      throw new ApiError(404, '构建任务不属于当前复习页')
    }
    job.value = nextJob
    const incoming = await listDeckEvents(id, 0)
    if (token !== attachToken) return
    events.value = incoming
    if (incoming.length) afterId = incoming[incoming.length - 1].id
    if (replaceQuery) {
      await router.replace({ query: { ...route.query, job: String(id) } })
    }
    if (isActiveJob(nextJob)) schedulePolling()
    else await refreshDeck()
  } catch (error) {
    if (token === attachToken) {
      jobId = null
      job.value = null
      events.value = []
      afterId = 0
    }
    throw error
  }
}

async function load() {
  loading.value = true
  notFound.value = false
  deck.value = null
  job.value = null
  jobId = null
  events.value = []
  afterId = 0
  attachToken += 1
  stopPolling()
  try {
    const value = await getDeck(deckId.value)
    deck.value = value
    style.value = normalizeDeckStyle(value.style)
    const queryJob = Number(route.query.job)
    const queryId = Number.isFinite(queryJob) && queryJob > 0 ? queryJob : null
    // 活跃任务优先；避免刷新后旧 ?job= 遮住正在运行的任务
    const id = value.active_job_id ?? queryId ?? value.last_job_id
    if (id) {
      try {
        await attachJob(id, false)
      } catch (error) {
        if (!(error instanceof ApiError && (error.status === 404 || error.status === 403))) {
          throw error
        }
        if (queryId === id) {
          const query = { ...route.query }
          delete query.job
          await router.replace({ query })
        }
        const fallback = value.last_job_id
        if (fallback && fallback !== id) {
          try {
            await attachJob(fallback, false)
          } catch {
            /* 最近任务也已失效，保留复习页设置界面 */
          }
        }
        if (!job.value) toast.error('构建任务不存在或已失效，可重新开始构建')
      }
    }
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      notFound.value = true
    } else if (error instanceof ApiError && error.status !== 401) {
      toast.error(error.detail)
    }
  } finally {
    loading.value = false
    schedulePolling()
  }
}

async function startBuild() {
  if (!deck.value || setupBusy.value) return
  setupBusy.value = true
  try {
    await updateDeck(deckId.value, { style: style.value })
    const result = await buildDeck(deckId.value)
    toast.success('构建已开始，可以离开页面，稍后回来继续查看')
    await router.replace({ query: { ...route.query, job: String(result.job_id) } })
    await attachJob(result.job_id, false)
    loading.value = false
  } catch (error) {
    if (error instanceof ApiError) {
      toast.error(error.detail)
    } else {
      toast.error('启动构建失败，请重试')
    }
  } finally {
    setupBusy.value = false
  }
}

async function confirmCancel() {
  actionBusy.value = true
  try {
    const canceledJob = await cancelDeckBuild(deckId.value)
    attachToken += 1
    stopPolling()
    job.value = canceledJob
    cancelOpen.value = false
    toast.success('已请求取消，已完成的页面会保留')
  } catch (error) {
    toast.error(error instanceof ApiError ? error.detail : '取消失败，请重试')
  } finally {
    actionBusy.value = false
  }
}

function openPage(pageId: number) {
  void router.push({
    name: 'deck-reader',
    params: { id: workspaceId.value, deckId: deckId.value, pageId },
  })
}

function goOverview() {
  void router.push({
    name: 'deck-overview',
    params: { id: workspaceId.value, deckId: deckId.value },
  })
}

/* ------------------------- 单页重做 ------------------------- */
const retryPage = ref<DeckPageSummary | null>(null)
const retryFeedback = ref('')
const retryOpen = ref(false)

function openRetry(pageId: number) {
  const page = deck.value?.pages.find((item) => item.id === pageId) ?? null
  if (!page) return
  retryPage.value = page
  retryFeedback.value = ''
  retryOpen.value = true
}

async function submitRetry() {
  if (!retryPage.value || actionBusy.value) return
  actionBusy.value = true
  try {
    const result = await rebuildPage(
      deckId.value,
      retryPage.value.id,
      retryFeedback.value.trim() || undefined,
    )
    retryOpen.value = false
    toast.success('已开始重做该页')
    await router.replace({ query: { ...route.query, job: String(result.job_id) } })
    await attachJob(result.job_id, false)
  } catch (error) {
    toast.error(error instanceof ApiError ? error.detail : '重做失败，请重试')
  } finally {
    actionBusy.value = false
  }
}

onMounted(() => void load())
onBeforeUnmount(() => {
  disposed = true
  stopPolling()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <DeckTopBar
      :workspace-id="workspaceId"
      :title="deck?.title ?? '复习页'"
      subtitle="构建工作台"
    >
      <AppButton
        v-if="active"
        size="sm"
        variant="secondary"
        @click="cancelOpen = true"
      >
        <template #icon><XCircle class="h-4 w-4" /></template>
        取消构建
      </AppButton>
      <AppButton size="sm" variant="ghost" @click="goOverview">
        <template #icon><ArrowLeft class="h-4 w-4" /></template>
        总览
      </AppButton>
    </DeckTopBar>

    <main class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
      <div v-if="loading" class="mx-auto max-w-5xl space-y-4">
        <div class="h-24 animate-pulse rounded-3xl bg-raised" />
        <div class="h-64 animate-pulse rounded-3xl bg-raised" style="animation-duration: 1.3s" />
      </div>

      <div
        v-else-if="notFound"
        class="mx-auto flex max-w-md flex-col items-center px-5 py-24 text-center"
      >
        <span class="inline-flex h-14 w-14 items-center justify-center rounded-3xl bg-raised text-muted">
          <AlertCircle class="h-7 w-7" />
        </span>
        <h2 class="mt-5 text-xl font-bold text-ink">复习页不存在</h2>
        <p class="mt-2 text-sm text-muted">它可能已被删除，或你没有访问权限。</p>
        <AppButton
          class="mt-6"
          @click="router.replace({ name: 'workspace', params: { id: workspaceId } })"
        >
          返回工作区
        </AppButton>
      </div>

      <template v-else-if="deck">
        <!-- Serverless 版本：构建服务未部署 -->
        <div v-if="!FEATURES.deckBuild" class="mx-auto max-w-2xl">
          <div class="rounded-3xl border border-border bg-panel p-6 text-center">
            <span class="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-raised text-muted">
              <Hammer class="h-6 w-6" />
            </span>
            <h2 class="mt-4 text-xl font-bold tracking-tight text-ink">复习页构建暂不可用</h2>
            <p class="mt-2 text-sm leading-relaxed text-muted">
              当前 Serverless 版本暂不提供页面构建与单页重建服务；已有页面仍可正常阅读。
            </p>
            <AppButton class="mt-5" @click="goOverview">
              <template #icon><ArrowLeft class="h-4 w-4" /></template>
              返回总览
            </AppButton>
          </div>
        </div>

        <template v-else>
        <!-- 新建 Deck：构建设置 -->
        <div v-if="!job && !pages.length" class="mx-auto max-w-3xl">
          <div class="rounded-3xl border border-border bg-panel p-5 sm:p-7">
            <div class="flex items-start gap-3">
              <span class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-raised text-ink">
                <Hammer class="h-5 w-5" />
              </span>
              <div>
                <h2 class="text-xl font-bold tracking-tight text-ink">开始构建复习页</h2>
                <p class="mt-1 text-sm leading-relaxed text-muted">
                  先规划知识点，再逐页生成可交互页面。所有页面都要通过校验才会出现在阅读器中。
                </p>
              </div>
            </div>

            <div class="mt-5 border-t border-border pt-5">
              <BuildSetupPanel
                v-model="style"
                :busy="setupBusy"
                submit-label="开始构建"
                @submit="startBuild"
              />
            </div>
          </div>
        </div>

        <!-- 没有活跃任务但已有页面 -->
        <div v-else-if="!job" class="mx-auto max-w-2xl">
          <div class="rounded-3xl border border-border bg-panel p-6 text-center">
            <CheckCircle2 class="mx-auto h-8 w-8 text-muted" />
            <h2 class="mt-3 text-lg font-semibold text-ink">当前没有进行中的构建</h2>
            <p class="mt-1.5 text-sm text-muted">
              已有 {{ pages.length }} 个页面计划。可以回到总览继续阅读，或发起整册重建。
            </p>
            <div class="mt-5 flex flex-wrap justify-center gap-2">
              <AppButton @click="goOverview">返回总览</AppButton>
            </div>
          </div>
        </div>

        <!-- 构建中 / 构建结束 -->
        <div v-else class="mx-auto max-w-6xl space-y-4">
          <section class="rounded-3xl border border-border bg-panel p-5">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-lg font-bold tracking-tight text-ink">
                    {{ job.target_page_id ? '单页重建' : '构建任务' }}
                  </h2>
                  <DeckStatusPill kind="job" :status="job.status" />
                </div>
                <p class="mt-1 text-sm text-muted">
                  {{ job.stage || '正在准备…' }}
                </p>
              </div>
              <div class="flex shrink-0 flex-wrap gap-2">
                <AppButton v-if="terminal" size="sm" @click="goOverview">
                  <template #icon><ArrowLeft class="h-4 w-4" /></template>
                  返回总览
                </AppButton>
                <AppButton
                  v-if="!active && failedPages.length"
                  size="sm"
                  variant="secondary"
                  @click="openRetry(failedPages[0].id)"
                >
                  <template #icon><RotateCcw class="h-4 w-4" /></template>
                  重试首个失败页
                </AppButton>
              </div>
            </div>

            <div class="mt-4">
              <div class="flex items-center justify-between text-xs text-muted">
                <span>{{ jobProgressText(job) }}</span>
                <span>{{ jobPercent }}%</span>
              </div>
              <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-raised">
                <div
                  class="h-full rounded-full bg-invert transition-all duration-300"
                  :class="active && !job.total_pages ? 'anim-indeterminate w-1/3' : ''"
                  :style="job.total_pages ? { width: `${jobPercent}%` } : undefined"
                />
              </div>
            </div>

            <div class="mt-4">
              <BuildTimeline :job="job" />
            </div>

            <div
              v-if="jobErrorText"
              class="mt-4 flex items-start gap-2 rounded-2xl border border-border-strong bg-raised px-3.5 py-3"
            >
              <AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-ink" />
              <p class="text-sm leading-relaxed text-muted">{{ jobErrorText }}</p>
            </div>

            <div
              v-if="terminal && job.status === 'done'"
              class="mt-4 flex items-center gap-2 rounded-2xl border border-border bg-raised px-3.5 py-3"
            >
              <CheckCircle2 class="h-4 w-4 text-ink" />
              <p class="text-sm text-muted">全部页面已就绪并完成校验，可以开始阅读。</p>
            </div>
          </section>

          <div class="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            <div class="flex h-72 flex-col lg:h-[520px]">
              <BuildConsole :events="events" :deck="deck" />
            </div>
            <div class="min-w-0">
              <div class="mb-2 flex items-center justify-between">
                <h3 class="text-sm font-semibold text-ink">页面</h3>
                <span class="text-[11px] text-faint">
                  {{ job.ready_pages }} 就绪 · {{ job.failed_pages }} 失败
                </span>
              </div>
              <p v-if="roleSummary" class="mb-2 text-[11px] text-faint">
                {{ roleSummary }}
                <template v-if="averageTeachingScore !== null">
                  · 平均教学分 {{ averageTeachingScore }}
                </template>
              </p>
              <BuildPageGrid :deck="deck" @open="openPage" @retry="openRetry" />
              <div v-if="active" class="mt-3 flex items-center gap-2 text-xs text-muted">
                <Loader2 class="h-3.5 w-3.5 spin" />
                页面完成后会自动出现，可以提前打开已就绪页面。
              </div>
              <div v-if="!active && failedPages.length" class="mt-4 space-y-2">
                <h4 class="text-xs font-semibold text-ink">失败页面</h4>
                <p class="text-[11px] leading-relaxed text-muted">
                  可先查看构建输出中的失败码；常见原因是资料不足、布局溢出或校验超时。修正资料或重试仍失败时，建议整册重新规划。
                </p>
                <div
                  v-for="page in failedPages"
                  :key="page.id"
                  class="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-panel px-3 py-2.5"
                >
                  <span class="text-[11px] text-faint">
                    {{ String(page.ordinal + 1).padStart(2, '0') }}
                  </span>
                  <span class="min-w-0 flex-1 truncate text-sm text-ink">
                    {{ pageDisplayTitle(page) }}
                  </span>
                  <AppButton size="sm" variant="secondary" @click="openRetry(page.id)">
                    重试
                  </AppButton>
                </div>
              </div>
            </div>
          </div>
        </div>
        </template>
      </template>
    </main>

    <ConfirmModal
      :open="cancelOpen"
      title="取消构建"
      message="已完成的页面会保留并继续可读；未完成的页面会停止构建。确定取消吗？"
      confirm-text="取消构建"
      cancel-text="继续构建"
      :loading="actionBusy"
      @close="cancelOpen = false"
      @confirm="confirmCancel"
    />

    <Modal
      :open="retryOpen"
      title="重做这一页"
      :description="retryPage ? `当前页面：${pageDisplayTitle(retryPage)}` : ''"
      size="md"
      :close-on-overlay="!actionBusy"
      @close="retryOpen = false"
    >
      <label class="block text-sm font-medium text-ink" for="build-retry-feedback">
        想调整什么？<span class="font-normal text-faint">（选填）</span>
      </label>
      <textarea
        id="build-retry-feedback"
        v-model="retryFeedback"
        rows="4"
        maxlength="2000"
        placeholder="例如：动画太快，请放慢；公式推导再细一点；换一个例子。"
        class="mt-2 w-full resize-none rounded-2xl border border-border bg-panel px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-border-strong focus:outline-none"
      />
      <template #footer>
        <div class="flex justify-end gap-2">
          <AppButton variant="secondary" :disabled="actionBusy" @click="retryOpen = false">
            取消
          </AppButton>
          <AppButton :loading="actionBusy" @click="submitRetry">开始重做</AppButton>
        </div>
      </template>
    </Modal>
  </div>
</template>