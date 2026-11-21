<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Plus, LogOut, ChevronRight } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { ApiError } from '@/api/client'
import ThemeToggle from './ThemeToggle.vue'
import Modal from './Modal.vue'
import AppButton from './AppButton.vue'
import AppInput from './AppInput.vue'

const emit = defineEmits<{ navigate: [] }>()

const route = useRoute()
const router = useRouter()
const wsStore = useWorkspaceStore()
const authStore = useAuthStore()
const toast = useToastStore()

const { workspaces, loading, createOpen } = storeToRefs(wsStore)
const { user } = storeToRefs(authStore)

const currentId = computed(() => {
  const id = route.params.id
  return id ? Number(id) : null
})

const userInitial = computed(() => (user.value?.username?.[0] ?? 'U').toUpperCase())

onMounted(() => {
  wsStore.fetch()
})

function selectWorkspace(id: number) {
  emit('navigate')
  if (currentId.value !== id) router.push({ name: 'workspace', params: { id } })
}

function goHome() {
  emit('navigate')
  if (route.name !== 'home') router.push({ name: 'home' })
}

/* ---------------- 新建工作区 ---------------- */
const creating = ref(false)
const newName = ref('')
const newDesc = ref('')
const nameError = ref<string | null>(null)

// 弹窗打开时（无论从何触发）重置表单
watch(createOpen, (open) => {
  if (open) {
    newName.value = ''
    newDesc.value = ''
    nameError.value = null
  }
})

async function submitCreate() {
  const name = newName.value.trim()
  if (!name) {
    nameError.value = '请输入工作区名称（科目名）'
    return
  }
  nameError.value = null
  creating.value = true
  try {
    const ws = await wsStore.create({
      name,
      description: newDesc.value.trim() || undefined,
    })
    wsStore.closeCreate()
    toast.success(`已创建工作区「${ws.name}」`)
    emit('navigate')
    router.push({ name: 'workspace', params: { id: ws.id } })
  } catch (error) {
    toast.error(error instanceof ApiError ? error.detail : '创建失败，请重试')
  } finally {
    creating.value = false
  }
}

async function logout() {
  // authStore.logout() 内部已收敛 wsStore.reset()，此处不再重复
  authStore.logout()
  emit('navigate')
  await router.replace({ name: 'login' })
}
</script>

<template>
  <div class="sidebar relative flex h-full flex-col bg-panel">
    <span class="sidebar__binding" aria-hidden="true">
      <i /><i /><i />
    </span>

    <!-- Logo -->
    <button
      type="button"
      class="relative flex items-center gap-3 px-5 py-5 text-left transition-opacity hover:opacity-85"
      @click="goHome"
    >
      <span
        class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-invert font-serif text-lg font-bold text-invert-ink"
      >
        M
      </span>
      <span class="min-w-0">
        <span class="block truncate font-serif text-lg font-bold tracking-tight text-ink">
          MockFinal
        </span>
        <span class="mt-0.5 block truncate font-mono text-[10px] tracking-wide text-faint">
          期末终极复习助手
        </span>
      </span>
    </button>

    <!-- 新建工作区 -->
    <div class="relative px-4 pb-4">
      <AppButton block @click="wsStore.openCreate()">
        <template #icon><Plus class="h-4 w-4" /></template>
        新建工作区
      </AppButton>
    </div>

    <!-- 工作区列表 -->
    <nav class="relative min-h-0 flex-1 overflow-y-auto px-3 pb-3" aria-label="工作区列表">
      <div class="flex items-center gap-3 px-2 pb-3 pt-1">
        <p class="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
          我的工作区
        </p>
        <span class="h-px flex-1 bg-border" />
      </div>

      <div v-if="loading && workspaces.length === 0" class="space-y-2 px-1 py-2">
        <div
          v-for="i in 3"
          :key="i"
          class="h-11 animate-pulse rounded-sm bg-raised"
          style="animation-duration: 1.4s"
        />
      </div>

      <p
        v-else-if="workspaces.length === 0"
        class="mx-1 rounded-sm border border-dashed border-border px-3 py-6 text-center text-xs leading-relaxed text-muted"
      >
        还没有工作区<br />点击上方「新建工作区」开始
      </p>

      <ul v-else class="space-y-0.5">
        <li v-for="(ws, index) in workspaces" :key="ws.id">
          <button
            type="button"
            class="group flex w-full items-center gap-3 border-l-2 px-3 py-2.5 text-left transition-colors duration-150"
            :class="
              currentId === ws.id
                ? 'border-pen bg-raised text-ink'
                : 'border-transparent text-ink hover:border-border-strong hover:bg-raised'
            "
            @click="selectWorkspace(ws.id)"
          >
            <span
              class="w-5 shrink-0 font-mono text-[10px]"
              :class="currentId === ws.id ? 'text-pen' : 'text-faint'"
            >
              {{ String(index + 1).padStart(2, '0') }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-serif text-sm font-bold">{{ ws.name }}</span>
              <span
                v-if="ws.description"
                class="mt-0.5 block truncate text-[11px]"
                :class="currentId === ws.id ? 'text-muted' : 'text-faint'"
              >
                {{ ws.description }}
              </span>
            </span>
            <ChevronRight
              class="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5"
              :class="currentId === ws.id ? 'text-pen' : 'text-faint'"
            />
          </button>
        </li>
      </ul>
    </nav>

    <!-- 底部：主题 / 用户 / 退出 -->
    <footer class="relative shrink-0 border-t border-border px-4 py-3.5">
      <div class="flex items-center gap-2.5">
        <span
          class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-pen/40 bg-pen-soft font-hand text-base font-bold text-pen"
        >
          {{ userInitial }}
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium text-ink">
            {{ user?.username ?? '未登录' }}
          </span>
          <span class="block font-mono text-[10px] tracking-wide text-faint">已登录</span>
        </span>
        <ThemeToggle size="sm" />
        <button
          type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted transition-colors hover:bg-raised hover:text-pen"
          aria-label="退出登录"
          title="退出登录"
          @click="logout"
        >
          <LogOut class="h-4 w-4" />
        </button>
      </div>
    </footer>

    <!-- 新建工作区弹窗 -->
    <Modal
      :open="createOpen"
      title="新建工作区"
      description="为每个科目创建一个工作区，上传资料后即可生成复习大纲与模拟试卷。"
      size="md"
      :close-on-overlay="!creating"
      @close="wsStore.closeCreate()"
    >
      <form class="space-y-4" @submit.prevent="submitCreate">
        <AppInput
          v-model="newName"
          label="工作区名称"
          placeholder="例如：高等数学、大学物理"
          required
          :error="nameError"
          :maxlength="60"
          autocomplete="off"
        />
        <AppInput
          v-model="newDesc"
          type="textarea"
          label="描述"
          placeholder="选填，例如考试范围、重点章节等"
          :rows="3"
          :maxlength="200"
        />
      </form>

      <template #footer>
        <div class="flex justify-end gap-2">
          <AppButton variant="secondary" :disabled="creating" @click="wsStore.closeCreate()">
            取消
          </AppButton>
          <AppButton :loading="creating" @click="submitCreate">
            <template #icon><Plus class="h-4 w-4" /></template>
            创建
          </AppButton>
        </div>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.sidebar__binding {
  position: absolute;
  left: 14px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--pen-line);
  opacity: 0.55;
  pointer-events: none;
}

.sidebar__binding i {
  position: absolute;
  left: 50%;
  width: 7px;
  height: 7px;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--panel);
  transform: translateX(-50%);
}

.sidebar__binding i:nth-child(1) {
  top: 22%;
}

.sidebar__binding i:nth-child(2) {
  top: 50%;
}

.sidebar__binding i:nth-child(3) {
  top: 78%;
}
</style>
