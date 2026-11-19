<script setup lang="ts">
import ThemeToggle from './ThemeToggle.vue'

withDefaults(
  defineProps<{
    label?: string
    size?: 'md' | 'lg'
  }>(),
  {
    label: '签到表 · 账号',
    size: 'md',
  },
)
</script>

<template>
  <div class="min-h-screen w-full bg-surface">
    <div class="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-6 sm:px-8 sm:py-8">
      <header class="flex items-center justify-between gap-4 pb-6">
        <router-link :to="{ name: 'landing' }" class="flex items-center gap-3">
          <span
            class="inline-flex h-9 w-9 items-center justify-center rounded-sm bg-invert font-serif text-base font-bold text-invert-ink"
          >
            M
          </span>
          <span class="font-serif text-lg font-bold tracking-tight text-ink">MockFinal</span>
        </router-link>
        <div class="flex items-center gap-4">
          <router-link :to="{ name: 'login' }" class="text-sm text-muted transition-colors hover:text-pen">
            返回登录
          </router-link>
          <ThemeToggle size="sm" />
        </div>
      </header>

      <main class="flex flex-1 items-start justify-center pb-10 pt-2 sm:items-center sm:pb-16">
        <div class="w-full" :class="size === 'lg' ? 'max-w-xl' : 'max-w-md'">
          <article
            class="auth-sheet relative overflow-hidden border border-border bg-panel shadow-card"
          >
            <span class="auth-binding" aria-hidden="true">
              <i /><i /><i />
            </span>
            <header
              class="flex items-baseline justify-between gap-4 border-b border-border py-3.5 pl-12 pr-6 font-mono text-[11px] text-muted"
            >
              <span>{{ label }}</span>
              <span>MockFinal</span>
            </header>
            <div class="px-6 py-7 pl-12 sm:px-8 sm:pl-12">
              <slot />
            </div>
          </article>
          <p class="mt-4 text-center font-mono text-[10px] tracking-wide text-faint">
            资料仅支持 .md / .txt · 单文件 ≤ 8 MiB
          </p>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.auth-binding {
  position: absolute;
  left: 14px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--pen-line);
  opacity: 0.55;
  pointer-events: none;
}

.auth-binding i {
  position: absolute;
  left: 50%;
  width: 7px;
  height: 7px;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--panel);
  transform: translateX(-50%);
}

.auth-binding i:nth-child(1) {
  top: 20%;
}

.auth-binding i:nth-child(2) {
  top: 50%;
}

.auth-binding i:nth-child(3) {
  top: 80%;
}
</style>
