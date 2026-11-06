<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Plus, LogOut, FolderOpen, GraduationCap } from 'lucide-vue-next'
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
  <div class="flex h-full flex-col bg-panel">
    <!-- Logo -->
    <button
      type="button"
      class="flex items-center gap-3 px-5 py-5 text-left transition-opacity hover:opacity-80"
      @click="goHome"
    >
      <span
        class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-invert text-invert-ink"
      >
        <GraduationCap class="h-5 w-5" />
      </span>
      <span class="min-w-0">
        <span class="block truncate text-[17px] font-bold tracking-tight text-ink">MockFinal</span>
        <span class="block truncate text-xs text-muted">期末终极复习助手</span>
      </span>
    </button>

    <!-- 新建工作区 -->
    <div class="px-4 pb-3">
      <AppButton variant="secondary" block @click="wsStore.openCreate()">
        <template #icon><Plus class="h-4 w-4" /></template>
        新建工作区
      </AppButton>
    </div>

    <!-- 工作区列表 -->
    <nav class="min-h-0 flex-1 overflow-y-auto px-3 pb-3" aria-label="工作区列表">
      <p class="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-faint">
        我的工作区
      </p>

      <div v-if="loading && workspaces.length === 0" class="space-y-2 px-1 py-2">
        <div
          v-for="i in 3"
          :key="i"
          class="h-11 animate-pulse rounded-2xl bg-raised"
          style="animation-duration: 1.4s"
        />
      </div>

      <p
        v-else-if="workspaces.length === 0"
        class="mx-1 rounded-2xl border border-dashed border-border px-3 py-6 text-center text-xs leading-relaxed text-muted"
      >
        还没有工作区<br />点击上方「新建工作区」开始
      </p>

      <ul v-else class="space-y-1">
        <li v-for="ws in workspaces" :key="ws.id">
          <button
            type="button"
            class="group flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left transition-colors duration-150"
            :class="
              currentId === ws.id
                ? 'bg-invert text-invert-ink'
                : 'text-ink hover:bg-raised'
            "
            @click="selectWorkspace(ws.id)"
          >
            <FolderOpen
              class="h-4 w-4 shrink-0"
              :class="currentId === ws.id ? 'text-invert-ink' : 'text-muted group-hover:text-ink'"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{{ ws.name }}</span>
              <span
                v-if="ws.description"
                class="block truncate text-[11px]"
                :class="currentId === ws.id ? 'text-invert-ink opacity-70' : 'text-faint'"
              >
                {{ ws.description }}
              </span>
            </span>
          </button>
        </li>
      </ul>
    </nav>

    <!-- 底部：主题 / 用户 / 退出 -->
    <footer class="shrink-0 border-t border-border px-4 py-3.5">
      <div class="flex items-center gap-2.5">
        <span
          class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-raised text-sm font-semibold text-ink"
        >
          {{ userInitial }}
        </span>
        <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {{ user?.username ?? '未登录' }}
        </span>
        <ThemeToggle size="sm" />
        <button
          type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink"
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
