<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  BookOpen,
  ClipboardList,
  Download,
  Trash2,
  Loader2,
  Sparkles,
  Clock,
} from 'lucide-vue-next'
import type { Artifact, ArtifactKind, ArtifactMeta } from '@/types'
import { deleteArtifact, getArtifact } from '@/api/artifacts'
import { saveBlob, ApiError } from '@/api/client'
import { formatDateTime } from '@/lib/format'
import { useToastStore } from '@/stores/toast'
import MarkdownView from './MarkdownView.vue'
import ConfirmModal from './ConfirmModal.vue'

const props = defineProps<{ artifacts: ArtifactMeta[]; kind: ArtifactKind }>()
const emit = defineEmits<{ changed: [] }>()

const toast = useToastStore()

const selectedId = ref<number | null>(null)
const selected = ref<Artifact | null>(null)
const loadingContent = ref(false)
const pendingDelete = ref<ArtifactMeta | null>(null)
const deleting = ref(false)

const emptyText = computed(() =>
  props.kind === 'review'
    ? '还没有生成《期末终极复习》。上传资料后点击右上角「生成」即可。'
    : '还没有生成《期末模拟考试》。上传资料后点击右上角「生成」即可。',
)

const KindIcon = computed(() => (props.kind === 'review' ? BookOpen : ClipboardList))

async function select(meta: ArtifactMeta) {
  if (selectedId.value === meta.id && selected.value) return
  selectedId.value = meta.id
  selected.value = null
  loadingContent.value = true
  try {
    selected.value = await getArtifact(meta.id)
  } catch (error) {
    toast.error(error instanceof ApiError ? error.detail : '加载内容失败')
  } finally {
    loadingContent.value = false
  }
}

function download() {
  if (!selected.value) return
  const blob = new Blob([selected.value.content], { type: 'text/markdown;charset=utf-8' })
  const safeName = selected.value.title.replace(/[\\/:*?"<>|]/g, '_')
  saveBlob(blob, `${safeName}.md`)
}

function deleteSelected() {
  if (selected.value) pendingDelete.value = selected.value
}

async function confirmDelete() {
  if (!pendingDelete.value) return
  deleting.value = true
  try {
    await deleteArtifact(pendingDelete.value.id)
    toast.success('已删除')
    const wasSelected = pendingDelete.value.id === selectedId.value
    pendingDelete.value = null
    if (wasSelected) {
      selectedId.value = null
      selected.value = null
    }
    emit('changed')
  } catch (error) {
    toast.error(error instanceof ApiError ? error.detail : '删除失败')
  } finally {
    deleting.value = false
  }
}

// 列表变化时自动选中首个（或修正失效选中项）
watch(
  () => props.artifacts,
  (list) => {
    if (list.length === 0) {
      selectedId.value = null
      selected.value = null
      return
    }
    if (!list.some((a) => a.id === selectedId.value)) {
      void select(list[0])
    }
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="artifacts.length === 0" class="rounded-3xl border border-dashed border-border px-6 py-16 text-center">
    <span class="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-raised text-faint">
      <Sparkles class="h-6 w-6" />
    </span>
    <p class="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted">{{ emptyText }}</p>
  </div>

  <div v-else class="flex flex-col gap-4 lg:flex-row">
    <!-- 工件列表 -->
    <aside
      class="flex shrink-0 gap-2 overflow-x-auto pb-1 lg:w-72 lg:flex-col lg:overflow-visible lg:pb-0"
    >
      <div
        v-for="a in artifacts"
        :key="a.id"
        class="group relative shrink-0 lg:w-full"
      >
        <button
          type="button"
          class="flex w-full flex-col rounded-2xl border px-4 py-3 text-left transition-colors duration-150"
          :class="
            selectedId === a.id
              ? 'border-transparent bg-invert text-invert-ink'
              : 'border-border bg-panel text-ink hover:border-border-strong hover:bg-raised'
          "
          @click="select(a)"
        >
          <span class="flex items-center gap-2">
            <component
              :is="KindIcon"
              class="h-4 w-4 shrink-0"
              :class="selectedId === a.id ? 'text-invert-ink' : 'text-muted'"
            />
            <span class="truncate text-sm font-medium">{{ a.title }}</span>
          </span>
          <span
            class="mt-1 hidden items-center gap-1 text-xs lg:flex"
            :class="selectedId === a.id ? 'text-invert-ink opacity-70' : 'text-faint'"
          >
            <Clock class="h-3 w-3" />
            {{ formatDateTime(a.created_at) }}
          </span>
        </button>
        <button
          type="button"
          class="absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-full text-faint transition-colors hover:bg-overlay hover:text-ink group-hover:flex"
          aria-label="删除该工件"
          title="删除"
          @click.stop="pendingDelete = a"
        >
          <Trash2 class="h-3.5 w-3.5" />
        </button>
      </div>
    </aside>

    <!-- 内容查看 -->
    <section class="min-w-0 flex-1">
      <div class="overflow-hidden rounded-3xl border border-border bg-panel">
        <header
          class="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-7"
        >
          <div class="min-w-0">
            <h2 class="truncate text-base font-semibold tracking-tight text-ink">
              {{ selected?.title ?? '加载中…' }}
            </h2>
            <p v-if="selected" class="mt-0.5 text-xs text-muted">
              生成于 {{ formatDateTime(selected.created_at) }}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="inline-flex h-9 items-center gap-2 rounded-2xl border border-border px-3.5 text-sm font-medium text-ink transition-colors hover:bg-raised disabled:opacity-40"
              :disabled="!selected"
              @click="download"
            >
              <Download class="h-4 w-4" />
              下载 .md
            </button>
            <button
              type="button"
              class="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-border text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
              :disabled="!selected"
              aria-label="删除当前工件"
              title="删除"
              @click="deleteSelected"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </div>
        </header>

        <div class="px-5 py-6 sm:px-7 sm:py-8">
          <div v-if="loadingContent" class="flex items-center justify-center py-20 text-muted">
            <Loader2 class="h-5 w-5 spin" />
            <span class="ml-2 text-sm">加载内容中…</span>
          </div>
          <MarkdownView v-else-if="selected" :content="selected.content" />
          <p v-else class="py-20 text-center text-sm text-muted">请选择左侧的工件查看内容</p>
        </div>
      </div>
    </section>
  </div>

  <ConfirmModal
    :open="!!pendingDelete"
    title="删除工件"
    :message="`确定删除「${pendingDelete?.title ?? ''}」吗？此操作不可撤销。`"
    confirm-text="删除"
    cancel-text="取消"
    :loading="deleting"
    @close="pendingDelete = null"
    @confirm="confirmDelete"
  />
</template>
