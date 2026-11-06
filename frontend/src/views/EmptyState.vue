<script setup lang="ts">
import { Plus, FolderOpen, UploadCloud, Sparkles } from 'lucide-vue-next'
import AppButton from '@/components/AppButton.vue'
import { useWorkspaceStore } from '@/stores/workspace'

const wsStore = useWorkspaceStore()

const steps = [
  { icon: FolderOpen, title: '创建工作区', desc: '按科目建立工作区，资料分门别类' },
  { icon: UploadCloud, title: '上传资料', desc: '支持 PDF / Word / PPT / Markdown / TXT' },
  { icon: Sparkles, title: '一键生成', desc: 'AI 并行产出复习大纲与模拟试卷' },
]
</script>

<template>
  <div class="flex min-h-full items-center justify-center px-6 py-16">
    <div class="anim-rise flex w-full max-w-2xl flex-col items-center text-center">
      <!-- 装饰图标 -->
      <div class="relative mb-8">
        <span
          class="absolute inset-0 -z-10 scale-150 rounded-full bg-invert opacity-[0.05] blur-2xl"
        />
        <span
          class="inline-flex h-20 w-20 items-center justify-center rounded-3xl border border-border bg-panel shadow-card"
        >
          <FolderOpen class="h-9 w-9 text-muted" />
        </span>
      </div>

      <h2 class="text-2xl font-bold tracking-tight text-ink sm:text-3xl">还没有工作区</h2>
      <p class="mt-3 max-w-md text-sm leading-relaxed text-muted">
        为每个科目创建一个工作区，上传课件、笔记或历年真题，MockFinal
        会为你生成《期末终极复习》大纲与《模拟考试》试卷。
      </p>

      <AppButton size="lg" class="mt-8" @click="wsStore.openCreate()">
        <template #icon><Plus class="h-4 w-4" /></template>
        新建第一个工作区
      </AppButton>

      <!-- 使用步骤 -->
      <ol class="mt-12 grid w-full gap-3 text-left sm:grid-cols-3">
        <li
          v-for="(s, i) in steps"
          :key="s.title"
          class="rounded-3xl border border-border bg-panel p-4 transition-colors hover:border-border-strong"
        >
          <div class="flex items-center justify-between">
            <span
              class="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-raised text-ink"
            >
              <component :is="s.icon" class="h-4.5 w-4.5" />
            </span>
            <span class="text-xs font-bold text-faint">0{{ i + 1 }}</span>
          </div>
          <p class="mt-3 text-sm font-semibold text-ink">{{ s.title }}</p>
          <p class="mt-1 text-xs leading-relaxed text-muted">{{ s.desc }}</p>
        </li>
      </ol>
    </div>
  </div>
</template>
