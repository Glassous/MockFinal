<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  ArrowRight,
  Hammer,
  Loader2,
  RotateCcw,
  Trash2,
} from 'lucide-vue-next'
import type { Deck, DeckPageSummary } from '@/types'
import {
  buildDeck,
  deleteDeck,
  getDeck,
  rebuildPage,
} from '@/api/decks'
import { ApiError } from '@/api/client'
import { FEATURES } from '@/lib/features'
import {
  buildRoadmap,
  continuePageId,
  normalizeDeckStyle,
  densityLabel,
  presetLabel,
} from '@/lib/deck'
import { formatRelative } from '@/lib/format'
import { useToastStore } from '@/stores/toast'
import AppButton from '@/components/AppButton.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import Modal from '@/components/Modal.vue'
import DeckTopBar from '@/components/deck/DeckTopBar.vue'
import DeckStatusPill from '@/components/deck/DeckStatusPill.vue'
import DeckRoadmap from '@/components/deck/DeckRoadmap.vue'
import DeckWorkbench from '@/components/deck/DeckWorkbench.vue'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()

const workspaceId = computed(() => Number(route.params.id))
const deckId = computed(() => Number(route.params.deckId))

const deck = ref<Deck | null>(null)
const loading = ref(true)
const notFound = ref(false)

const roadmap = computed(() => (deck.value ? buildRoadmap(deck.value) : []))
const style = computed(() => normalizeDeckStyle(deck.value?.style))
const continueId = computed(() => (deck.value ? continuePageId(deck.value) : null))
const chapterCount = computed(() => roadmap.value.length)

let pollTimer: number | null = null
let disposed = false

function stopPolling() {
  if (pollTimer !== null) {
    window.clearTimeout(pollTimer)
    pollTimer = null
  }
}

function shouldPoll(value: Deck | null): boolean {
  if (!value) return false
  return (
    !!value.active_job_id ||
    value.status === 'planning' ||
    value.status === 'building' ||
    value.pages.some((page) => page.status === 'building' || page.status === 'validating')
  )
}

function schedulePolling() {
  stopPolling()
  if (disposed || !shouldPoll(deck.value)) return
  pollTimer = window.setTimeout(async () => {
    await refresh(false)
    schedulePolling()
  }, 2000)
}

async function refresh(showError = true) {
  try {
    deck.value = await getDeck(deckId.value)
  } catch (error) {
    if (showError && error instanceof ApiError && error.status !== 401) {
      toast.error(error.detail)
    }
  }
}

async function load() {
  loading.value = true
  notFound.value = false
  deck.value = null
  try {
    deck.value = await getDeck(deckId.value)
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

function openPage(pageId: number) {
  void router.push({
    name: 'deck-reader',
    params: { id: workspaceId.value, deckId: deckId.value, pageId },
  })
}

function goBuild() {
  void router.push({
    name: 'deck-build',
    params: { id: workspaceId.value, deckId: deckId.value },
  })
}

function goContinue() {
  if (continueId.value) openPage(continueId.value)
  else goBuild()
}

/* ------------------------- 重建 ------------------------- */
const rebuildOpen = ref(false)
const replanOpen = ref(false)
const deleteOpen = ref(false)
const actionBusy = ref(false)

async function startRebuild() {
  actionBusy.value = true
  try {
    const result = await buildDeck(deckId.value, { rebuildAll: true })
    rebuildOpen.value = false
    toast.success('已开始整册重建，旧页面在新版本就绪前仍可阅读')
    await goBuildJob(result.job_id)
  } catch (error) {
    toast.error(error instanceof ApiError ? error.detail : '重建失败，请重试')
  } finally {
    actionBusy.value = false
  }
}

async function startReplan() {
  actionBusy.value = true
  try {
    const result = await buildDeck(deckId.value, { replan: true })
    replanOpen.value = false
    toast.success('已开始重新规划')
    await goBuildJob(result.job_id)
  } catch (error) {
    toast.error(error instanceof ApiError ? error.detail : '重新规划失败，请重试')
  } finally {
    actionBusy.value = false
  }
}

async function goBuildJob(jobId: number) {
  await router.push({
    name: 'deck-build',
    params: { id: workspaceId.value, deckId: deckId.value },
    query: { job: String(jobId) },
  })
}

async function confirmDelete() {
  actionBusy.value = true
  try {
    await deleteDeck(deckId.value)
    deleteOpen.value = false
    toast.success('复习页已删除')
    await router.replace({ name: 'workspace', params: { id: workspaceId.value } })
  } catch (error) {
    toast.error(error instanceof ApiError ? error.detail : '删除失败，请重试')
  } finally {
    actionBusy.value = false
  }
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
  if (!retryPage.value) return
  actionBusy.value = true
  try {
    const result = await rebuildPage(
      deckId.value,
      retryPage.value.id,
      retryFeedback.value.trim() || undefined,
    )
    retryOpen.value = false
    toast.success('已开始重做该页，旧版本在新版本就绪前仍可阅读')
    await goBuildJob(result.job_id)
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
      :subtitle="deck ? `${presetLabel(style.preset)} · ${densityLabel(style.density)}` : undefined"
    >
      <AppButton v-if="deck && !deck.pages.length && FEATURES.deckBuild" size="sm" @click="goBuild">
        <template #icon><Hammer class="h-4 w-4" /></template>
        开始构建
      </AppButton>
      <button
        v-if="deck"
        type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-2xl text-muted transition-colors hover:bg-raised hover:text-ink"
        aria-label="删除复习页"
        title="删除复习页"
        @click="deleteOpen = true"
      >
        <Trash2 class="h-4 w-4" />
      </button>
    </DeckTopBar>

    <main class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 lg:overflow-hidden">
      <div v-if="loading" class="mx-auto max-w-[1440px] space-y-4">
        <div class="h-24 animate-pulse rounded-3xl bg-raised" />
        <div class="h-72 animate-pulse rounded-3xl bg-raised" style="animation-duration: 1.3s" />
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

      <div
        v-else-if="deck"
        class="mx-auto flex h-full min-h-0 max-w-[1440px] flex-col gap-4 lg:flex-row"
      >
        <section class="min-w-0 flex-1 lg:overflow-y-auto lg:pr-1">
          <div class="rounded-3xl border border-border bg-panel p-5 sm:p-6">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-[11px] font-semibold uppercase tracking-wider text-faint">
                  复习页总览
                </p>
                <h2 class="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                  {{ deck.title }}
                </h2>
                <p class="mt-1.5 text-sm text-muted">
                  {{ chapterCount }} 章 ·
                  {{ deck.total_pages || '—' }} 页 ·
                  更新于 {{ formatRelative(deck.updated_at) }}
                </p>
              </div>
              <DeckStatusPill kind="deck" :status="deck.status" />
            </div>

            <div v-if="deck.active_job_id && FEATURES.deckBuild" class="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border-strong bg-raised px-3.5 py-3">
              <Loader2 class="h-4 w-4 shrink-0 spin text-ink" />
              <p class="min-w-0 flex-1 text-sm text-muted">
                构建任务正在进行，页面会在完成后逐页出现；可以离开，稍后回来继续查看。
              </p>
              <AppButton size="sm" variant="secondary" @click="goBuild">查看进度</AppButton>
            </div>

            <div v-else-if="deck.source_changed" class="mt-4 flex items-start gap-2 rounded-2xl border border-border-strong bg-raised px-3.5 py-3">
              <AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-ink" />
              <p class="text-sm leading-relaxed text-muted">
                资料在构建后发生了变化。建议整册重建，让页面引用与最新资料一致。
              </p>
            </div>

            <div v-if="continueId && !deck.active_job_id" class="mt-4 flex flex-wrap items-center gap-2">
              <AppButton @click="goContinue">
                <template #icon><ArrowRight class="h-4 w-4" /></template>
                继续阅读
              </AppButton>
              <AppButton v-if="deck.pages.length && FEATURES.deckBuild" variant="secondary" @click="rebuildOpen = true">
                <template #icon><RotateCcw class="h-4 w-4" /></template>
                整册重建
              </AppButton>
            </div>
          </div>

          <div class="mt-4 rounded-3xl border border-border bg-panel p-5 sm:p-6">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 class="text-base font-semibold tracking-tight text-ink">知识点路线图</h2>
                <p class="mt-1 text-xs text-muted">
                  节点状态来自页面计划；点击已就绪节点直接进入阅读。
                </p>
              </div>
              <span class="text-[11px] text-faint">{{ chapterCount }} 章</span>
            </div>

            <div v-if="roadmap.length" class="mt-4">
              <DeckRoadmap :chapters="roadmap" @open="openPage" />
            </div>
            <div v-else class="mt-4 rounded-2xl border border-dashed border-border px-4 py-10 text-center">
              <Hammer class="mx-auto h-6 w-6 text-faint" />
              <p class="mt-2 text-sm font-medium text-ink">尚未规划知识点</p>
              <p class="mt-1 text-xs leading-relaxed text-muted">
                <template v-if="FEATURES.deckBuild">
                  选择风格与密度后开始构建，系统会先规划大纲，再逐页生成。
                </template>
                <template v-else>当前 Serverless 版本暂不提供页面构建服务。</template>
              </p>
              <AppButton v-if="FEATURES.deckBuild" class="mt-4" size="sm" @click="goBuild">
                去构建工作台
              </AppButton>
            </div>
          </div>
        </section>

        <div class="w-full lg:h-full lg:w-[380px] lg:shrink-0">
          <DeckWorkbench
            :deck="deck"
            :build-enabled="FEATURES.deckBuild"
            @continue="openPage"
            @open="openPage"
            @build="goBuild"
            @rebuild-all="rebuildOpen = true"
            @replan="replanOpen = true"
            @retry="openRetry"
          />
        </div>
      </div>
    </main>

    <ConfirmModal
      :open="deleteOpen"
      title="删除复习页"
      :message="`确定删除「${deck?.title ?? ''}」吗？页面、构建记录与聊天记录都会被永久删除，此操作不可撤销。`"
      confirm-text="删除"
      :loading="actionBusy"
      @close="deleteOpen = false"
      @confirm="confirmDelete"
    />

    <ConfirmModal
      :open="rebuildOpen"
      title="整册重建"
      message="将按现有页面计划逐页重新构建，不会重新规划知识点。旧版本在新页面就绪前保持可读。"
      confirm-text="开始重建"
      :danger="false"
      :loading="actionBusy"
      @close="rebuildOpen = false"
      @confirm="startRebuild"
    />

    <ConfirmModal
      :open="replanOpen"
      title="重新规划"
      message="将重新生成大纲与页面计划，旧页面会被替换。仅在全部页面失败时建议使用。"
      confirm-text="重新规划"
      :loading="actionBusy"
      @close="replanOpen = false"
      @confirm="startReplan"
    />

    <Modal
      :open="retryOpen"
      title="重做这一页"
      :description="retryPage ? `当前页面：${retryPage.manifest_title || retryPage.title}` : ''"
      size="md"
      :close-on-overlay="!actionBusy"
      @close="retryOpen = false"
    >
      <label class="block text-sm font-medium text-ink" for="retry-feedback">
        想调整什么？<span class="font-normal text-faint">（选填）</span>
      </label>
      <textarea
        id="retry-feedback"
        v-model="retryFeedback"
        rows="4"
        maxlength="2000"
        placeholder="例如：动画太快，请放慢；公式推导再细一点；换一个例子。"
        class="mt-2 w-full resize-none rounded-2xl border border-border bg-panel px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-border-strong focus:outline-none"
      />
      <p class="mt-1.5 text-[11px] text-faint">
        反馈只作为该页重建的偏好，不会覆盖页面安全约束；旧版本在新版本就绪前仍可阅读。
      </p>
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