<script setup lang="ts">
import ThemeToggle from './ThemeToggle.vue'
</script>

<template>
  <div class="relative min-h-screen w-full overflow-hidden bg-surface">
    <!-- 装饰背景：单色网格 + 顶部柔光 + 径向遮罩 -->
    <div class="auth-bg pointer-events-none absolute inset-0" aria-hidden="true" />
    <!-- 细颗粒质感 -->
    <div class="grain pointer-events-none absolute inset-0" aria-hidden="true" />

    <!-- 主题切换角标 -->
    <div class="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
      <ThemeToggle />
    </div>

    <!-- 居中内容 -->
    <div class="relative z-10 flex min-h-screen items-center justify-center px-4 py-12">
      <div class="w-full max-w-md">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-bg {
  background-image:
    radial-gradient(
      55rem 38rem at 50% -12%,
      color-mix(in srgb, var(--ink) 7%, transparent),
      transparent 62%
    ),
    linear-gradient(to right, color-mix(in srgb, var(--ink) 4%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in srgb, var(--ink) 4%, transparent) 1px, transparent 1px);
  background-size:
    auto,
    34px 34px,
    34px 34px;
  -webkit-mask-image: radial-gradient(circle at 50% 32%, #000 0%, transparent 80%);
  mask-image: radial-gradient(circle at 50% 32%, #000 0%, transparent 80%);
}
</style>
