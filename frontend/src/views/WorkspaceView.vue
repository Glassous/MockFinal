<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Sparkles, Loader2, Trash2, Pencil, Check, Files, BookOpen, ClipboardList, Layers } from 'lucide-vue-next'
import type { ArtifactKind, ArtifactMeta, Deck, Job, Material, Workspace } from '@/types'
import { getWorkspace } from '@/api/workspaces'
import { listMaterials } from '@/api/materials'
import { listArtifacts } from '@/api/artifacts'
import { listDecks } from '@/api/decks'
import { generate, getJob, advanceJob } from '@/api/generation'
import { ApiError } from '@/api/client'
import { FEATURES } from '@/lib/features'
import { useToastStore } from '@/stores/toast'
import { useWorkspaceStore } from '@/stores/workspace'
import AppButton from '@/components/AppButton.vue'
import UploadZone from '@/components/UploadZone.vue'
import MaterialList from '@/components/MaterialList.vue'
import ArtifactPanel from '@/components/ArtifactPanel.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import Modal from '@/components/Modal.vue'
import AppInput from '@/components/AppInput.vue'
import DeckList from '@/components/deck/DeckList.vue'
import DeckCreateModal from '@/components/deck/DeckCreateModal.vue'

type Tab = 'materials' | 'decks' | 'review' | 'exam'

const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const wsStore = useWorkspaceStore()

const workspaceId = computed(() => Number(route.params.id))

const workspace = ref<Workspace | null>(null)
const loadingWorkspace = ref(true)
const notFound = ref(false)

const tab = ref<Tab>('materials')
const materials = ref<Material[]>([])
const artifacts = ref<ArtifactMeta[]>([])
const decks = ref<Deck[]>([])
const decksLoading = ref(false)
const createDeckOpen = ref(false)

const generating = ref(false)
const jobStage = ref('')
const jobId = ref<number | null>(null)

const pendingDeleteWs = ref(false)
const deletingWs = ref(false)

/* ------------------------- 编辑工作区 ------------------------- */
const editOpen = ref(false)
const editName = ref('')
const editDesc = ref('')
const editNameError = ref<string | null>(null)
const savingEdit = ref(false)

const reviewArtifacts = computed(() => artifacts.value.filter((a) => a.kind === 'review'))
const examArtifacts = computed(() => artifacts.value.filter((a) => a.kind === 'exam'))

const tabs = computed(() => [
  { key: 'materials' as Tab, label: '学习资料', icon: Files, count: materials.value.length },
  { key: 'decks' as Tab, label: '复习页', icon: Layers, count: decks.value.length },
  { key: 'review' as Tab, label: '旧版资料', icon: BookOpen, count: reviewArtifacts.value.length },
  { key: 'exam' as Tab, label: '模拟考试', icon: ClipboardList, count: examArtifacts.value.length },
])

/* ------------------------- 数据加载 ------------------------- */
async function refreshMaterials() {
  try {
    materials.value = await listMaterials(workspaceId.value)
  } catch (error) {
    if (error instanceof ApiError && error.status !== 401) toast.error(error.detail)
  }
}

async function refreshArtifacts() {
  try {
    artifacts.value = await listArtifacts(workspaceId.value)
  } catch (error) {
    if (error instanceof ApiError && error.status !== 401) toast.error(error.detail)
  }
}

async function refreshDecks() {
  decksLoading.value = true
  try {
    decks.value = await listDecks(workspaceId.value)
  } catch (error) {
    if (error instanceof ApiError && error.status !== 401) toast.error(error.detail)
  } finally {
    decksLoading.value = false
  }
}

function openDeck(deckId: number) {
  void router.push({
    name: 'deck-overview',
    params: { id: workspaceId.value, deckId },
  })
}

function onDeckCreated(deck: Deck) {
  createDeckOpen.value = false
  void router.push({
    name: FEATURES.deckBuild ? 'deck-build' : 'deck-overview',
    params: { id: workspaceId.value, deckId: deck.id },
  })
}

async function loadAll(id: number) {
  stopMaterialPolling()
  stopJobPolling()
  generating.value = false
  jobId.value = null
  jobStage.value = ''
  workspace.value = null
  materials.value = []
  artifacts.value = []
  decks.value = []
  notFound.value = false
  tab.value = 'materials'

  if (!Number.isFinite(id) || id <= 0) {
    loadingWorkspace.value = false
    notFound.value = true
    return
  }

  loadingWorkspace.value = true
  try {
    workspace.value = await getWorkspace(id)
    await Promise.all([refreshMaterials(), refreshArtifacts(), refreshDecks()])
    scheduleMaterialPolling()
    await resumeJob(id)
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      notFound.value = true
    } else if (error instanceof ApiError && error.status !== 401) {
      toast.error(error.detail)
    }
  } finally {
    loadingWorkspace.value = false
  }
}

/* ------------------------- 资料解析轮询（2s） ------------------------- */
let materialTimer: number | null = null

function hasPendingMaterials() {
  return materials.value.some((m) => m.status === 'uploaded' || m.status === 'indexing')
}

function stopMaterialPolling() {
  if (materialTimer !== null) {
    window.clearInterval(materialTimer)
    materialTimer = null
  }
}

function scheduleMaterialPolling() {
  if (materialTimer !== null || !hasPendingMaterials()) return
  materialTimer = window.setInterval(async () => {
    await refreshMaterials()
    if (!hasPendingMaterials()) stopMaterialPolling()
  }, 2000)
}

function onUploaded() {
  void refreshMaterials().then(scheduleMaterialPolling)
}

/* ------------------------- 生成任务推进（前端驱动 advance） ------------------------- */
let advanceTimer: number | null = null
let jobFallbackTimer: number | null = null
let advancing = false

const JOB_KEY_PREFIX = 'mockfinal_job_'

function jobStorageKey(id: number): string {
  return `${JOB_KEY_PREFIX}${id}`
}

function rememberJob(workspaceIdValue: number, id: number | null): void {
  try {
    if (id === null) localStorage.removeItem(jobStorageKey(workspaceIdValue))
    else localStorage.setItem(jobStorageKey(workspaceIdValue), String(id))
  } catch {
    /* 隐私模式下 localStorage 可能不可用 */
  }
}

function forgetJob(workspaceIdValue: number): void {
  rememberJob(workspaceIdValue, null)
}

function stopJobPolling() {
  if (advanceTimer !== null) {
    window.clearTimeout(advanceTimer)
    advanceTimer = null
  }
  if (jobFallbackTimer !== null) {
    window.clearInterval(jobFallbackTimer)
    jobFallbackTimer = null
  }
  advancing = false
}

/** 应用一次任务快照；返回 true 表示已进入终态 */
function applyJob(job: Job): boolean {
  if (job.stage) jobStage.value = job.stage
  if (job.status === 'done') {
    stopJobPolling()
    generating.value = false
    jobId.value = null
    forgetJob(workspaceId.value)
    toast.success('生成完成，已为你切换到「终极复习」')
    void refreshArtifacts()
    tab.value = 'review'
    return true
  }
  if (job.status === 'failed') {
    stopJobPolling()
    generating.value = false
    jobId.value = null
    forgetJob(workspaceId.value)
    toast.error(job.error || '生成失败，请重试')
    return true
  }
  return false
}

function scheduleAdvance(delay: number) {
  if (advanceTimer !== null) window.clearTimeout(advanceTimer)
  advanceTimer = window.setTimeout(() => {
    advanceTimer = null
    void advanceLoop()
  }, delay)
}

async function advanceLoop() {
  if (jobId.value == null) return
  advancing = true
  try {
    const job = await advanceJob(jobId.value)
    advancing = false
    if (applyJob(job)) return
    scheduleAdvance(400)
  } catch (error) {
    advancing = false
    if (error instanceof ApiError && error.status === 401) return
    // 429 / 502 / 网络抖动：退避后继续推进，任务状态由后端 cursor 保证可续
    const retryable = error instanceof ApiError && (error.status === 429 || error.status === 502 || error.status === 0)
    scheduleAdvance(retryable ? 3000 : 1200)
  }
}

function startJobPolling() {
  stopJobPolling()
  scheduleAdvance(0)
  jobFallbackTimer = window.setInterval(async () => {
    if (jobId.value == null || advancing) return
    try {
      applyJob(await getJob(jobId.value))
    } catch {
      /* 单次兜底读取失败不中断 */
    }
  }, 2000)
}

/** 重新进入页面时恢复未完成的生成任务 */
async function resumeJob(id: number) {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(jobStorageKey(id))
  } catch {
    return
  }
  const cached = Number(stored)
  if (!Number.isSafeInteger(cached) || cached <= 0) return
  try {
    const job = await getJob(cached)
    if (job.status === 'pending' || job.status === 'running') {
      jobId.value = job.id
      generating.value = true
      if (job.stage) jobStage.value = job.stage
      startJobPolling()
    } else {
      forgetJob(id)
    }
  } catch {
    forgetJob(id)
  }
}

async function onGenerate() {
  if (generating.value) return
  try {
    const res = await generate(workspaceId.value)
    jobId.value = res.job_id
    rememberJob(workspaceId.value, res.job_id)
    generating.value = true
    jobStage.value = '任务已提交，正在启动…'
    startJobPolling()
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 400) {
        toast.error(error.detail || '没有可用资料，请先上传并等待解析完成')
      } else if (error.status === 409) {
        toast.error(error.detail || '已有正在进行的生成任务，请稍候')
        await resumeJob(workspaceId.value)
      } else {
        toast.error(error.detail)
      }
    } else {
      toast.error('生成失败，请重试')
    }
  }
}

/* ------------------------- 编辑工作区 ------------------------- */
function openEdit() {
  if (!workspace.value) return
  editName.value = workspace.value.name
  editDesc.value = workspace.value.description ?? ''
  editNameError.value = null
  editOpen.value = true
}

function closeEdit() {
  if (savingEdit.value) return
  editOpen.value = false
}

async function submitEdit() {
  const name = editName.value.trim()
  if (!name) {
    editNameError.value = '请输入工作区名称（科目名）'
    return
  }
  editNameError.value = null
  savingEdit.value = true
  try {
    const updated = await wsStore.update(workspaceId.value, {
      name,
      description: editDesc.value.trim(),
    })
    workspace.value = updated
    editOpen.value = false
    toast.success('工作区已更新')
  } catch (error) {
    toast.error(error instanceof ApiError ? error.detail : '保存失败，请重试')
  } finally {
    savingEdit.value = false
  }
}

/* ------------------------- 删除工作区 ------------------------- */
async function confirmDeleteWorkspace() {
  deletingWs.value = true
  try {
    await wsStore.remove(workspaceId.value)
    toast.success('工作区已删除')
    pendingDeleteWs.value = false
    await router.replace({ name: 'home' })
  } catch (error) {
    toast.error(error instanceof ApiError ? error.detail : '删除失败')
  } finally {
    deletingWs.value = false
  }
}

/* ------------------------- 生命周期 ------------------------- */
onMounted(() => {
  void loadAll(workspaceId.value)
})

watch(
  () => route.params.id,
  (id) => {
    if (route.name === 'workspace' && id) void loadAll(Number(id))
  },
)

onBeforeUnmount(() => {
  stopMaterialPolling()
  stopJobPolling()
})
</script>

<template>
  <div class="min-h-full">
    <!-- 加载骨架 -->
    <div v-if="loadingWorkspace" class="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
      <div class="h-8 w-56 animate-pulse rounded-2xl bg-raised" />
      <div class="mt-3 h-4 w-72 animate-pulse rounded-xl bg-raised" />
      <div class="mt-8 h-40 animate-pulse rounded-3xl bg-raised" style="animation-duration: 1.4s" />
    </div>

    <!-- 工作区不存在 -->
    <div
      v-else-if="notFound"
      class="mx-auto flex w-full max-w-md flex-col items-center px-5 py-24 text-center"
    >
      <span class="inline-flex h-14 w-14 items-center justify-center rounded-3xl bg-raised text-muted">
        <Files class="h-7 w-7" />
      </span>
      <h2 class="mt-5 text-xl font-bold text-ink">工作区不存在</h2>
      <p class="mt-2 text-sm text-muted">它可能已被删除，或你没有访问权限。</p>
      <AppButton class="mt-6" @click="router.replace({ name: 'home' })">返回工作区列表</AppButton>
    </div>

    <template v-else>
      <!-- 头部 -->
      <header class="border-b border-border bg-panel">
        <div class="mx-auto w-full max-w-5xl px-5 py-5 sm:px-8 sm:py-6">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="text-xs font-medium uppercase tracking-wider text-faint">工作区</p>
              <h1 class="mt-1 truncate text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                {{ workspace?.name }}
              </h1>
              <p class="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">
                {{ workspace?.description || '暂无描述' }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <AppButton :loading="generating" :disabled="generating" @click="onGenerate">
                <template #icon>
                  <Sparkles v-if="!generating" class="h-4 w-4" />
                </template>
                {{ generating ? '生成中' : '生成' }}
              </AppButton>
              <button
                type="button"
                class="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border text-muted transition-colors hover:bg-raised hover:text-ink"
                aria-label="编辑工作区"
                title="编辑工作区"
                @click="openEdit"
              >
                <Pencil class="h-4 w-4" />
              </button>
              <button
                type="button"
                class="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border text-muted transition-colors hover:bg-raised hover:text-ink"
                aria-label="删除工作区"
                title="删除工作区"
                @click="pendingDeleteWs = true"
              >
                <Trash2 class="h-4 w-4" />
              </button>
            </div>
          </div>

          <!-- 生成进度 -->
          <transition name="fade">
            <div v-if="generating" class="mt-5">
              <div class="flex items-center gap-2 text-xs text-muted">
                <Loader2 class="h-3.5 w-3.5 spin" />
                <span class="truncate">{{ jobStage || '正在生成…' }}</span>
              </div>
              <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-raised">
                <div class="anim-indeterminate h-full w-1/3 rounded-full bg-invert" />
              </div>
            </div>
          </transition>
        </div>

        <!-- 标签页 -->
        <div class="mx-auto w-full max-w-5xl px-5 sm:px-8">
          <div class="flex gap-1 overflow-x-auto">
            <button
              v-for="t in tabs"
              :key="t.key"
              type="button"
              class="relative flex items-center gap-2 whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors"
              :class="tab === t.key ? 'text-ink' : 'text-muted hover:text-ink'"
              @click="tab = t.key"
            >
              <component :is="t.icon" class="h-4 w-4" />
              {{ t.label }}
              <span
                v-if="t.count > 0"
                class="rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none"
                :class="tab === t.key ? 'bg-invert text-invert-ink' : 'bg-raised text-muted'"
              >
                {{ t.count }}
              </span>
              <span
                v-if="tab === t.key"
                class="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-invert"
              />
            </button>
          </div>
        </div>
      </header>

      <!-- 内容 -->
      <main class="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8">
        <div v-if="tab === 'materials'" class="space-y-5">
          <UploadZone :workspace-id="workspaceId" @uploaded="onUploaded" />
          <MaterialList :materials="materials" @changed="refreshMaterials" />
        </div>
        <DeckList
          v-else-if="tab === 'decks'"
          :decks="decks"
          :loading="decksLoading"
          @create="createDeckOpen = true"
          @open="openDeck"
        />
        <ArtifactPanel
          v-else-if="tab === 'review'"
          key="review"
          :artifacts="reviewArtifacts"
          :kind="'review' as ArtifactKind"
          @changed="refreshArtifacts"
        />
        <ArtifactPanel
          v-else
          key="exam"
          :artifacts="examArtifacts"
          :kind="'exam' as ArtifactKind"
          @changed="refreshArtifacts"
        />
      </main>
    </template>

    <ConfirmModal
      :open="pendingDeleteWs"
      title="删除工作区"
      :message="`确定删除工作区「${workspace?.name ?? ''}」吗？其中的资料、分节与生成的工件都会被永久删除，此操作不可撤销。`"
      confirm-text="删除"
      cancel-text="取消"
      :loading="deletingWs"
      @close="pendingDeleteWs = false"
      @confirm="confirmDeleteWorkspace"
    />

    <DeckCreateModal
      :open="createDeckOpen"
      :workspace-id="workspaceId"
      @close="createDeckOpen = false"
      @created="onDeckCreated"
    />

    <!-- 编辑工作区弹窗 -->
    <Modal
      :open="editOpen"
      title="编辑工作区"
      description="修改科目名称或描述。"
      size="md"
      :close-on-overlay="!savingEdit"
      @close="closeEdit"
    >
      <form class="space-y-4" @submit.prevent="submitEdit">
        <AppInput
          v-model="editName"
          label="工作区名称"
          placeholder="例如：高等数学、大学物理"
          required
          :error="editNameError"
          :maxlength="60"
          autocomplete="off"
        />
        <AppInput
          v-model="editDesc"
          type="textarea"
          label="描述"
          placeholder="选填，例如考试范围、重点章节等"
          :rows="3"
          :maxlength="200"
        />
      </form>

      <template #footer>
        <div class="flex justify-end gap-2">
          <AppButton variant="secondary" :disabled="savingEdit" @click="closeEdit">
            取消
          </AppButton>
          <AppButton :loading="savingEdit" @click="submitEdit">
            <template #icon><Check class="h-4 w-4" /></template>
            保存
          </AppButton>
        </div>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
@keyframes indeterminate {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(400%);
  }
}
.anim-indeterminate {
  animation: indeterminate 1.3s ease-in-out infinite;
}
</style>
