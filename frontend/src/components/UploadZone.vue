<script setup lang="ts">
import { onBeforeUnmount, reactive, ref } from 'vue'
import {
  UploadCloud,
  FileText,
  X,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-vue-next'
import { uploadFile, validateFile, ALLOWED_EXTENSIONS } from '@/lib/oss'
import { formatBytes } from '@/lib/format'
import { useToastStore } from '@/stores/toast'
import { ApiError } from '@/api/client'

const props = defineProps<{ workspaceId: number }>()
const emit = defineEmits<{ uploaded: [] }>()

const toast = useToastStore()

type QueueStatus = 'uploading' | 'registering' | 'done' | 'error'

interface QueueItem {
  id: number
  file: File
  percent: number
  status: QueueStatus
  error: string | null
}

const inputRef = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
const items = ref<QueueItem[]>([])
let dragDepth = 0
let seed = 0

/** 每个上传项对应的 AbortController，用于组件卸载时中止进行中的 XHR */
const controllers = new Map<number, AbortController>()

const acceptAttr = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')

function openFileDialog() {
  inputRef.value?.click()
}

function onInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files && input.files.length) addFiles(Array.from(input.files))
  input.value = '' // 允许重复选择同一文件
}

function onDrop(event: DragEvent) {
  dragging.value = false
  dragDepth = 0
  const files = event.dataTransfer?.files
  if (files && files.length) addFiles(Array.from(files))
}

function onDragEnter() {
  dragDepth++
  dragging.value = true
}

function onDragLeave() {
  dragDepth--
  if (dragDepth <= 0) dragging.value = false
}

function addFiles(files: File[]) {
  for (const file of files) {
    const problem = validateFile(file)
    if (problem) {
      toast.error(problem)
      continue
    }
    const item = reactive<QueueItem>({
      id: ++seed,
      file,
      percent: 0,
      status: 'uploading',
      error: null,
    })
    items.value.push(item)
    // push 后从数组取回 reactive proxy，确保 percent/status/error 赋值触发渲染
    void runUpload(items.value[items.value.length - 1]!)
  }
}

async function runUpload(item: QueueItem) {
  const controller = new AbortController()
  controllers.set(item.id, controller)
  item.status = 'uploading'
  item.percent = 0
  item.error = null
  try {
    await uploadFile(
      props.workspaceId,
      item.file,
      (percent) => {
        item.percent = percent
        if (percent >= 100) item.status = 'registering'
      },
      controller.signal,
    )
    item.status = 'done'
    item.percent = 100
    emit('uploaded')
    // 成功后短暂展示，再自动移除（资料已出现在下方列表）
    setTimeout(() => removeItem(item.id), 1800)
  } catch (error) {
    // 组件卸载主动取消：静默处理，不展示错误也不弹 toast
    if (controller.signal.aborted) return
    item.status = 'error'
    item.error = error instanceof ApiError ? error.detail : '上传失败，请重试'
    toast.error(`「${item.file.name}」上传失败`)
  } finally {
    controllers.delete(item.id)
  }
}

function retry(item: QueueItem) {
  void runUpload(item)
}

function removeItem(id: number) {
  items.value = items.value.filter((i) => i.id !== id)
}

// 组件卸载时中止所有进行中的上传，避免泄露的 XHR 与失效回调
onBeforeUnmount(() => {
  for (const controller of controllers.values()) controller.abort()
  controllers.clear()
})

function statusText(item: QueueItem): string {
  switch (item.status) {
    case 'registering':
      return '登记中…'
    case 'done':
      return '已上传'
    case 'error':
      return item.error ?? '失败'
    default:
      return `上传中 ${item.percent}%`
  }
}
</script>

<template>
  <div>
    <!-- 拖拽/点击上传区 -->
    <div
      role="button"
      tabindex="0"
      class="group relative flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-all duration-150"
      :class="
        dragging
          ? 'border-ink bg-raised'
          : 'border-border-strong bg-panel hover:border-ink hover:bg-raised'
      "
      @click="openFileDialog"
      @keydown.enter.prevent="openFileDialog"
      @keydown.space.prevent="openFileDialog"
      @dragenter.prevent="onDragEnter"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <span
        class="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl transition-transform duration-200"
        :class="dragging ? 'scale-110 bg-invert text-invert-ink' : 'bg-raised text-muted group-hover:text-ink'"
      >
        <UploadCloud class="h-7 w-7" />
      </span>
      <p class="text-sm font-medium text-ink">
        <span v-if="dragging">松开鼠标即可上传</span>
        <span v-else>拖拽文件到此处，或 <span class="underline underline-offset-4">点击选择</span></span>
      </p>
      <p class="mt-1.5 text-xs text-muted">
        支持 {{ ALLOWED_EXTENSIONS.join(' / ').toUpperCase() }} · 单个文件 ≤ 50MB · 可多选
      </p>
      <input
        ref="inputRef"
        type="file"
        multiple
        :accept="acceptAttr"
        class="hidden"
        @change="onInputChange"
      />
    </div>

    <!-- 上传队列 -->
    <ul v-if="items.length" class="mt-3 space-y-2">
      <li
        v-for="item in items"
        :key="item.id"
        class="anim-fade rounded-2xl border border-border bg-panel px-4 py-3"
      >
        <div class="flex items-center gap-3">
          <span class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-raised text-muted">
            <FileText class="h-4 w-4" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-ink">{{ item.file.name }}</p>
            <p class="mt-0.5 flex items-center gap-1.5 text-xs"
               :class="item.status === 'error' ? 'text-ink' : 'text-muted'">
              <component
                :is="
                  item.status === 'done'
                    ? CheckCircle2
                    : item.status === 'error'
                      ? AlertCircle
                      : Loader2
                "
                class="h-3.5 w-3.5"
                :class="item.status === 'uploading' || item.status === 'registering' ? 'spin' : ''"
              />
              <span class="truncate">{{ statusText(item) }}</span>
              <span class="shrink-0 text-faint">· {{ formatBytes(item.file.size) }}</span>
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <button
              v-if="item.status === 'error'"
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink"
              aria-label="重试"
              title="重试"
              @click="retry(item)"
            >
              <RefreshCw class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-ink"
              aria-label="移除"
              title="移除"
              @click="removeItem(item.id)"
            >
              <X class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- 进度条 -->
        <div
          v-if="item.status === 'uploading' || item.status === 'registering'"
          class="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-raised"
        >
          <div
            class="h-full rounded-full bg-invert transition-[width] duration-200 ease-out"
            :style="{ width: item.percent + '%' }"
          />
        </div>
      </li>
    </ul>
  </div>
</template>
