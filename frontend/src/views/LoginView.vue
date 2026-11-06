<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { GraduationCap, LogIn, AlertCircle } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { ApiError } from '@/api/client'
import AuthShell from '@/components/AuthShell.vue'
import AppInput from '@/components/AppInput.vue'
import AppButton from '@/components/AppButton.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()

const username = ref('')
const password = ref('')
const loading = ref(false)
const formError = ref<string | null>(null)

async function onSubmit() {
  if (!username.value.trim() || !password.value) {
    formError.value = '请输入用户名和密码'
    return
  }
  formError.value = null
  loading.value = true
  try {
    await auth.login(username.value.trim(), password.value)
    toast.success('登录成功，欢迎回来')
    const redirect = route.query.redirect
    // 仅接受站内绝对路径（以 / 开头且非 // 协议相对），否则回落首页，防止开放重定向
    const safeRedirect =
      typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')
        ? redirect
        : null
    await router.replace(safeRedirect ?? { name: 'home' })
  } catch (error) {
    formError.value = error instanceof ApiError ? error.detail : '登录失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthShell>
    <div class="anim-rise">
      <!-- 品牌 -->
      <div class="mb-7 flex flex-col items-center text-center">
        <span
          class="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-3xl bg-invert text-invert-ink shadow-card"
        >
          <GraduationCap class="h-7 w-7" />
        </span>
        <h1 class="text-2xl font-bold tracking-tight text-ink">MockFinal</h1>
        <p class="mt-1 text-sm text-muted">期末终极复习助手</p>
      </div>

      <!-- 卡片 -->
      <div class="rounded-3xl border border-border bg-panel p-6 shadow-card sm:p-8">
        <h2 class="text-lg font-semibold tracking-tight text-ink">登录</h2>
        <p class="mt-1 text-sm text-muted">欢迎回来，继续你的复习计划。</p>

        <form class="mt-6 space-y-4" @submit.prevent="onSubmit">
          <AppInput
            v-model="username"
            label="用户名"
            placeholder="请输入用户名"
            autocomplete="username"
            :maxlength="32"
            name="username"
          />
          <AppInput
            v-model="password"
            type="password"
            label="密码"
            placeholder="请输入密码"
            autocomplete="current-password"
            :maxlength="72"
            name="password"
          />

          <div
            v-if="formError"
            class="flex items-start gap-2 rounded-2xl border border-border-strong bg-raised px-3.5 py-2.5 text-sm text-ink"
          >
            <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
            <span>{{ formError }}</span>
          </div>

          <AppButton type="submit" block size="lg" :loading="loading">
            <template #icon><LogIn class="h-4 w-4" /></template>
            登录
          </AppButton>
        </form>

        <div class="mt-6 flex items-center justify-between text-sm">
          <router-link
            :to="{ name: 'forgot' }"
            class="text-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
          >
            忘记密码？
          </router-link>
          <router-link
            :to="{ name: 'register' }"
            class="font-medium text-ink underline-offset-4 transition-colors hover:underline"
          >
            注册新账号
          </router-link>
        </div>
      </div>
    </div>
  </AuthShell>
</template>
