<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Plus, ChevronRight, FolderOpen } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAuthStore } from '@/stores/auth'
import { formatRelative } from '@/lib/format'
import EmptyState from './EmptyState.vue'

const router = useRouter()
const wsStore = useWorkspaceStore()
const authStore = useAuthStore()

const { workspaces, loading, loaded } = storeToRefs(wsStore)
const { user } = storeToRefs(authStore)

onMounted(() => {
  wsStore.fetch()
})

function open(id: number) {
  router.push({ name: 'workspace', params: { id } })
}
</script>

<template>
  <!-- 首次加载骨架 -->
  <div v-if="!loaded" class="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
    <div class="h-8 w-48 animate-pulse rounded-2xl bg-raised" />
    <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="i in 3"
        :key="i"
        class="h-36 animate-pulse rounded-3xl bg-raised"
        style="animation-duration: 1.4s"
      />
    </div>
  </div>

  <!-- 空状态 -->
  <EmptyState v-else-if="workspaces.length === 0" />

  <!-- 工作区总览 -->
  <div v-else class="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
    <header class="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-sm text-muted">你好，{{ user?.username ?? '同学' }}</p>
        <h1 class="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          选择要复习的科目
        </h1>
        <p class="mt-2 text-sm text-muted">
          共 {{ workspaces.length }} 个工作区<template v-if="loading"> · 正在刷新…</template>
        </p>
      </div>
      <button
        type="button"
        class="inline-flex h-10 items-center gap-2 rounded-2xl bg-invert px-4 text-sm font-medium text-invert-ink shadow-sm transition-opacity hover:opacity-90 active:scale-[0.97]"
        @click="wsStore.openCreate()"
      >
        <Plus class="h-4 w-4" />
        新建工作区
      </button>
    </header>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="ws in workspaces"
        :key="ws.id"
        type="button"
        class="group flex flex-col rounded-3xl border border-border bg-panel p-5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card"
        @click="open(ws.id)"
      >
        <span
          class="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-raised text-ink transition-colors group-hover:bg-invert group-hover:text-invert-ink"
        >
          <FolderOpen class="h-5 w-5" />
        </span>
        <span class="mt-4 block truncate text-base font-semibold text-ink">{{ ws.name }}</span>
        <span class="mt-1 line-clamp-2 min-h-[2.5em] text-sm leading-relaxed text-muted">
          {{ ws.description || '暂无描述' }}
        </span>
        <span class="mt-4 flex items-center justify-between border-t border-border pt-3">
          <span class="text-xs text-faint">{{ formatRelative(ws.created_at) }}</span>
          <ChevronRight
            class="h-4 w-4 text-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink"
          />
        </span>
      </button>

      <!-- 新建卡片 -->
      <button
        type="button"
        class="flex min-h-[9rem] flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-border-strong text-muted transition-colors hover:border-ink hover:text-ink"
        @click="wsStore.openCreate()"
      >
        <Plus class="h-6 w-6" />
        <span class="text-sm font-medium">新建工作区</span>
      </button>
    </div>
  </div>
</template>
