<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Plus, ChevronRight, FolderOpen, UploadCloud, Sparkles } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAuthStore } from '@/stores/auth'
import { formatRelative } from '@/lib/format'
import AppButton from '@/components/AppButton.vue'
import BindingThread from '@/components/entry/BindingThread.vue'

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
    <!-- 引导：当前学期总目录 -->
    <section class="anim-rise e-sheet relative overflow-hidden">
      <BindingThread />
      <header
        class="flex items-center justify-between gap-4 border-b border-border py-3.5 pl-12 pr-6 font-mono text-[11px] text-muted"
      >
        <span>复习目录 · 工作区</span>
        <span>{{ workspaces.length ? `共 ${workspaces.length} 个` : '从第一本开始' }}</span>
      </header>

      <div class="px-6 py-7 pl-12 sm:px-9 sm:py-9 sm:pl-14">
        <p class="e-folio">01 / 开始</p>
        <h1 class="mt-2 font-serif text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          选择一个工作区继续
        </h1>
        <p class="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          你好，{{ user?.username ?? '同学' }}。每个工作区对应一门科目，上传课件、笔记或真题后，MockFinal
          会为你生成复习讲义与模拟卷。
        </p>

        <div class="mt-6 flex flex-wrap items-center gap-4">
          <AppButton size="lg" @click="wsStore.openCreate()">
            <template #icon><Plus class="h-4 w-4" /></template>
            新建工作区
          </AppButton>
          <span class="font-mono text-[10px] tracking-wide text-faint">
            资料仅支持 .md / .txt · 单文件 ≤ 8 MiB
          </span>
        </div>

        <ol class="mt-8 grid gap-4 border-t border-border pt-6 sm:grid-cols-3">
          <li v-for="(s, i) in steps" :key="s.title" class="border-t border-pen-line pt-3">
            <div class="flex items-baseline gap-2">
              <span class="font-mono text-[10px] text-pen">0{{ i + 1 }}</span>
              <span class="font-serif text-sm font-bold text-ink">{{ s.title }}</span>
            </div>
            <p class="mt-1.5 text-xs leading-relaxed text-muted">{{ s.desc }}</p>
          </li>
        </ol>
      </div>
    </section>

    <!-- 工作区选择列表 -->
    <section class="mt-10">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="font-mono text-[10px] tracking-wide text-faint">02 / 目录</p>
          <h2 class="mt-1 font-serif text-xl font-bold tracking-tight text-ink">我的工作区</h2>
        </div>
        <p class="text-xs text-muted">
          <template v-if="workspaces.length">
            共 {{ workspaces.length }} 个工作区 · 点击进入
          </template>
          <template v-else>工作区会按最近创建的顺序列出</template>
          <template v-if="loading && loaded"> · 正在刷新…</template>
        </p>
      </div>

      <!-- 首次加载骨架：与真实列表行同高 -->
      <div v-if="!loaded" class="mt-4 space-y-2" aria-hidden="true">
        <div
          v-for="i in 3"
          :key="i"
          class="h-[76px] animate-pulse rounded-sm bg-raised"
          style="animation-duration: 1.4s"
        />
      </div>

      <!-- 没有工作区 -->
      <div
        v-else-if="!workspaces.length"
        class="mt-4 rounded-sm border border-dashed border-border bg-panel px-6 py-10 text-center"
      >
        <span
          class="inline-flex h-12 w-12 items-center justify-center rounded-sm border border-pen/40 bg-pen-soft text-pen"
        >
          <FolderOpen class="h-6 w-6" />
        </span>
        <p class="mt-3 font-serif text-base font-bold text-ink">还没有工作区</p>
        <p class="mt-1 text-sm leading-relaxed text-muted">
          创建第一个工作区，上传资料后即可开始生成复习页。
        </p>
        <AppButton class="mt-5" @click="wsStore.openCreate()">
          <template #icon><Plus class="h-4 w-4" /></template>
          新建第一个工作区
        </AppButton>
      </div>

      <!-- 列表选择 -->
      <ul v-else class="mt-4 border-t border-border" aria-label="工作区列表">
        <li v-for="(ws, index) in workspaces" :key="ws.id">
          <button
            type="button"
            class="group flex w-full items-center gap-4 border-b border-border px-1 py-4 text-left transition-colors duration-150 hover:bg-raised/70"
            @click="open(ws.id)"
          >
            <span class="w-6 shrink-0 font-mono text-[11px] text-faint group-hover:text-pen">
              {{ String(index + 1).padStart(2, '0') }}
            </span>
            <span
              class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-border bg-panel text-muted transition-colors group-hover:border-pen group-hover:text-pen"
            >
              <FolderOpen class="h-4 w-4" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-serif text-base font-bold text-ink">
                {{ ws.name }}
              </span>
              <span class="mt-0.5 block truncate text-xs text-muted">
                {{ ws.description || '暂无描述' }}
              </span>
            </span>
            <span class="hidden shrink-0 font-mono text-[10px] text-faint sm:inline">
              {{ formatRelative(ws.created_at) }}
            </span>
            <ChevronRight
              class="h-4 w-4 shrink-0 text-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-pen"
            />
          </button>
        </li>

        <!-- 新建入口 -->
        <li>
          <button
            type="button"
            class="group flex w-full items-center gap-4 border-b border-dashed border-border px-1 py-4 text-left text-muted transition-colors hover:text-pen"
            @click="wsStore.openCreate()"
          >
            <span class="w-6 shrink-0 font-mono text-[11px]">+</span>
            <span
              class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-dashed border-border-strong transition-colors group-hover:border-pen"
            >
              <Plus class="h-4 w-4" />
            </span>
            <span class="font-serif text-sm font-bold">新建工作区</span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
