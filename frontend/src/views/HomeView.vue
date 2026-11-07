<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Plus, ChevronRight, FolderOpen, UploadCloud, Sparkles } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAuthStore } from '@/stores/auth'
import { formatRelative } from '@/lib/format'
import AppButton from '@/components/AppButton.vue'

const router = useRouter()
const wsStore = useWorkspaceStore()
const authStore = useAuthStore()

const { workspaces, loading, loaded } = storeToRefs(wsStore)
const { user } = storeToRefs(authStore)

const steps = [
  { icon: FolderOpen, title: '创建工作区', desc: '按科目建立工作区，资料互相独立' },
  { icon: UploadCloud, title: '上传学习资料', desc: '支持 PDF / Word / PPT / Markdown / TXT' },
  { icon: Sparkles, title: '生成并复习', desc: '产出复习页与模拟考试，随时接着读' },
]

onMounted(() => {
  wsStore.fetch()
})

function open(id: number) {
  router.push({ name: 'workspace', params: { id } })
}
</script>

<template>
  <div class="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
    <!-- 引导：没有打开工作区时，先告诉用户从哪里开始 -->
    <section class="anim-rise rounded-3xl border border-border bg-panel p-6 sm:p-8">
      <div class="flex flex-wrap items-start justify-between gap-5">
        <div class="min-w-0">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-faint">开始复习</p>
          <h1 class="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            选择一个工作区继续
          </h1>
          <p class="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            你好，{{ user?.username ?? '同学' }}。每个工作区对应一门科目，上传课件、笔记或真题后，MockFinal
            会为你生成复习页与模拟考试。
          </p>
        </div>
        <AppButton size="lg" class="w-full sm:w-auto" @click="wsStore.openCreate()">
          <template #icon><Plus class="h-4 w-4" /></template>
          新建工作区
        </AppButton>
      </div>

      <ol class="mt-7 grid gap-4 border-t border-border pt-6 sm:grid-cols-3">
        <li v-for="(s, i) in steps" :key="s.title" class="flex gap-3">
          <span
            class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-raised text-ink"
          >
            <component :is="s.icon" class="h-4 w-4" />
          </span>
          <span class="min-w-0">
            <span class="flex items-baseline gap-2">
              <span class="text-xs font-bold text-faint">0{{ i + 1 }}</span>
              <span class="text-sm font-semibold text-ink">{{ s.title }}</span>
            </span>
            <span class="mt-1 block text-xs leading-relaxed text-muted">{{ s.desc }}</span>
          </span>
        </li>
      </ol>
    </section>

    <!-- 工作区选择列表 -->
    <section class="mt-10">
      <div class="mb-3">
        <h2 class="text-lg font-semibold tracking-tight text-ink">我的工作区</h2>
        <p class="mt-1 text-sm text-muted">
          <template v-if="workspaces.length">共 {{ workspaces.length }} 个工作区 · 点击进入</template>
          <template v-else>工作区会按最近创建的顺序列出</template>
          <template v-if="loading && loaded"> · 正在刷新…</template>
        </p>
      </div>

      <!-- 首次加载骨架：与真实列表行同高 -->
      <div v-if="!loaded" class="space-y-2" aria-hidden="true">
        <div
          v-for="i in 3"
          :key="i"
          class="h-[76px] animate-pulse rounded-2xl bg-raised"
          style="animation-duration: 1.4s"
        />
      </div>

      <!-- 没有工作区 -->
      <div
        v-else-if="!workspaces.length"
        class="rounded-2xl border border-dashed border-border bg-panel px-6 py-10 text-center"
      >
        <span
          class="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-raised text-faint"
        >
          <FolderOpen class="h-6 w-6" />
        </span>
        <p class="mt-3 text-sm font-medium text-ink">还没有工作区</p>
        <p class="mt-1 text-sm leading-relaxed text-muted">
          创建第一个工作区，上传资料后即可开始生成复习页。
        </p>
        <AppButton class="mt-5" @click="wsStore.openCreate()">
          <template #icon><Plus class="h-4 w-4" /></template>
          新建第一个工作区
        </AppButton>
      </div>

      <!-- 列表选择 -->
      <ul v-else class="space-y-2" aria-label="工作区列表">
        <li v-for="ws in workspaces" :key="ws.id">
          <button
            type="button"
            class="group flex w-full items-center gap-3 rounded-2xl border border-border bg-panel px-4 py-3.5 text-left transition-all duration-150 hover:border-border-strong hover:shadow-card"
            @click="open(ws.id)"
          >
            <span
              class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-raised text-muted transition-colors group-hover:bg-invert group-hover:text-invert-ink"
            >
              <FolderOpen class="h-5 w-5" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold text-ink">{{ ws.name }}</span>
              <span class="mt-0.5 block truncate text-xs text-muted">
                {{ ws.description || '暂无描述' }}
              </span>
            </span>
            <span class="hidden shrink-0 text-xs text-faint sm:inline">
              {{ formatRelative(ws.created_at) }}
            </span>
            <ChevronRight
              class="h-4 w-4 shrink-0 text-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink"
            />
          </button>
        </li>

        <!-- 新建入口 -->
        <li>
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-2xl border border-dashed border-border-strong px-4 py-3.5 text-left text-muted transition-colors hover:border-ink hover:text-ink"
            @click="wsStore.openCreate()"
          >
            <span
              class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-border-strong"
            >
              <Plus class="h-4 w-4" />
            </span>
            <span class="text-sm font-medium">新建工作区</span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
