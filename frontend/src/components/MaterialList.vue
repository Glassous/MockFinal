<script setup lang="ts">
import { ref } from 'vue'
import {
  FileText,
  File,
  FileType2,
  Presentation,
  Download,
  Trash2,
  Inbox,
} from 'lucide-vue-next'
import type { Material } from '@/types'
import { deleteMaterial, downloadMaterial } from '@/api/materials'
import { saveBlob, ApiError } from '@/api/client'
import { formatBytes, formatRelative } from '@/lib/format'
import { useToastStore } from '@/stores/toast'
import StatusBadge from './StatusBadge.vue'
import ConfirmModal from './ConfirmModal.vue'

defineProps<{ materials: Material[] }>()
const emit = defineEmits<{ changed: [] }>()

const toast = useToastStore()

const downloadingId = ref<number | null>(null)
const pendingDelete = ref<Material | null>(null)
const deleting = ref(false)

function iconFor(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return FileText
  if (ext === 'docx' || ext === 'doc') return FileType2
  if (ext === 'pptx' || ext === 'ppt') return Presentation
  if (ext === 'md' || ext === 'txt') return File
  return File
}

async function onDownload(material: Material) {
  downloadingId.value = material.id
  try {
    const blob = await downloadMaterial(material.id)
    saveBlob(blob, material.filename)
  } catch (error) {
    toast.error(error instanceof ApiError ? error.detail : '下载失败')
  } finally {
    downloadingId.value = null
  }
}

async function confirmDelete() {
  if (!pendingDelete.value) return
  deleting.value = true
  try {
    await deleteMaterial(pendingDelete.value.id)
    toast.success('资料已删除')
    pendingDelete.value = null
    emit('changed')
  } catch (error) {
    toast.error(error instanceof ApiError ? error.detail : '删除失败')
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div>
    <div v-if="materials.length === 0" class="rounded-3xl border border-dashed border-border px-6 py-12 text-center">
      <span class="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-raised text-faint">
        <Inbox class="h-6 w-6" />
      </span>
      <p class="mt-3 text-sm text-muted">还没有学习资料，上传后系统会自动解析并建立索引。</p>
    </div>

    <ul v-else class="space-y-2">
      <li
        v-for="m in materials"
        :key="m.id"
        class="rounded-2xl border border-border bg-panel px-4 py-3 transition-colors hover:border-border-strong"
      >
        <div class="flex items-center gap-3">
          <span
            class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-raised text-muted"
          >
            <component :is="iconFor(m.filename)" class="h-5 w-5" />
          </span>

          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-ink" :title="m.filename">
              {{ m.filename }}
            </p>
            <p class="mt-0.5 truncate text-xs text-muted">
              {{ formatBytes(m.size) }} · {{ formatRelative(m.created_at) }}
              <template v-if="m.status === 'indexed' && m.chunk_count > 0">
                · {{ m.chunk_count }} 个分块
              </template>
            </p>
          </div>

          <StatusBadge :status="m.status" class="hidden sm:inline-flex" />

          <div class="flex shrink-0 items-center gap-1">
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
              aria-label="下载"
              title="下载"
              :disabled="downloadingId === m.id"
              @click="onDownload(m)"
            >
              <Download class="h-4 w-4" :class="downloadingId === m.id ? 'anim-pulse' : ''" />
            </button>
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink"
              aria-label="删除"
              title="删除"
              @click="pendingDelete = m"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- 移动端状态徽章 -->
        <div class="mt-2 sm:hidden">
          <StatusBadge :status="m.status" />
        </div>

        <!-- 失败原因 -->
        <p
          v-if="m.status === 'failed' && m.error"
          class="mt-2 rounded-xl bg-raised px-3 py-2 text-xs leading-relaxed text-muted"
        >
          {{ m.error }}
        </p>
      </li>
    </ul>

    <ConfirmModal
      :open="!!pendingDelete"
      title="删除资料"
      :message="`确定删除「${pendingDelete?.filename ?? ''}」吗？相关的索引分块也会一并移除，此操作不可撤销。`"
      confirm-text="删除"
      cancel-text="取消"
      :loading="deleting"
      @close="pendingDelete = null"
      @confirm="confirmDelete"
    />
  </div>
</template>
