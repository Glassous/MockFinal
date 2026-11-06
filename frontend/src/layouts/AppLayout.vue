<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Menu, GraduationCap } from 'lucide-vue-next'
import Sidebar from '@/components/Sidebar.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { useAuthStore } from '@/stores/auth'

const drawerOpen = ref(false)
const authStore = useAuthStore()
const { user } = storeToRefs(authStore)

onMounted(async () => {
  // 刷新后 token 仍在但 user 为空时恢复用户信息（401 由全局处理）
  if (authStore.isAuthenticated && !user.value) {
    try {
      await authStore.fetchMe()
    } catch {
      /* 忽略：全局 401 处理会跳转登录 */
    }
  }
})

function closeDrawer() {
  drawerOpen.value = false
}
</script>

<template>
  <div class="flex h-screen w-full overflow-hidden bg-surface">
    <!-- 移动端抽屉遮罩 -->
    <transition name="fade">
      <div
        v-if="drawerOpen"
        class="fixed inset-0 z-70 bg-overlay md:hidden"
        @click="closeDrawer"
      />
    </transition>

    <!-- 侧栏：桌面端固定于左侧，移动端为抽屉（单实例） -->
    <aside
      class="z-80 h-full w-[280px] shrink-0 border-r border-border md:relative md:translate-x-0 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:transition-transform max-md:duration-200 max-md:ease-out"
      :class="drawerOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'"
    >
      <Sidebar @navigate="closeDrawer" />
    </aside>

    <!-- 主区域 -->
    <div class="flex h-full min-w-0 flex-1 flex-col">
      <!-- 移动端顶栏 -->
      <header
        class="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-panel px-3 md:hidden"
      >
        <button
          type="button"
          class="inline-flex h-9 w-9 items-center justify-center rounded-2xl text-ink transition-colors hover:bg-raised"
          aria-label="打开菜单"
          @click="drawerOpen = true"
        >
          <Menu class="h-5 w-5" />
        </button>
        <span class="inline-flex items-center gap-2">
          <span
            class="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-invert text-invert-ink"
          >
            <GraduationCap class="h-3.5 w-3.5" />
          </span>
          <span class="text-sm font-bold tracking-tight text-ink">MockFinal</span>
        </span>
        <span class="ml-auto">
          <ThemeToggle size="sm" />
        </span>
      </header>

      <main class="min-h-0 flex-1 overflow-y-auto">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.16s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
