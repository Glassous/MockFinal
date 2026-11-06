<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { KeyRound, ArrowRight, ArrowLeft, Check, AlertCircle, ShieldCheck } from 'lucide-vue-next'
import * as authApi from '@/api/auth'
import { ApiError } from '@/api/client'
import { useToastStore } from '@/stores/toast'
import AuthShell from '@/components/AuthShell.vue'
import AppInput from '@/components/AppInput.vue'
import AppButton from '@/components/AppButton.vue'

const router = useRouter()
const toast = useToastStore()

const steps = [
  { n: 1, label: '验证身份' },
  { n: 2, label: '回答密保' },
  { n: 3, label: '重置密码' },
]

const step = ref(1)
const loading = ref(false)
const error = ref<string | null>(null)

const username = ref('')
const question = ref('')
const answer = ref('')
const resetToken = ref('')
const newPassword = ref('')
const confirmPassword = ref('')

function dotClass(n: number): string {
  if (step.value > n) return 'border-transparent bg-invert text-invert-ink'
  if (step.value === n) return 'border-ink bg-panel text-ink'
  return 'border-border bg-panel text-faint'
}

async function submitUsername() {
  error.value = null
  if (!username.value.trim()) {
    error.value = '请输入用户名'
    return
  }
  loading.value = true
  try {
    const res = await authApi.getSecurityQuestion(username.value.trim())
    question.value = res.question
    step.value = 2
  } catch (e) {
    error.value = e instanceof ApiError ? e.detail : '获取密保问题失败，请检查用户名'
  } finally {
    loading.value = false
  }
}

async function submitAnswer() {
  error.value = null
  if (!answer.value.trim()) {
    error.value = '请输入密保答案'
    return
  }
  loading.value = true
  try {
    const res = await authApi.verifyAnswer({
      username: username.value.trim(),
      answer: answer.value.trim(),
    })
    resetToken.value = res.reset_token
    step.value = 3
  } catch (e) {
    error.value = e instanceof ApiError ? e.detail : '密保答案不正确'
  } finally {
    loading.value = false
  }
}

async function submitReset() {
  error.value = null
  if (newPassword.value.length < 6) {
    error.value = '新密码至少 6 位'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return
  }
  loading.value = true
  try {
    await authApi.resetPassword({
      reset_token: resetToken.value,
      new_password: newPassword.value,
    })
    toast.success('密码已重置，请使用新密码登录')
    await router.replace({ name: 'login' })
  } catch (e) {
    error.value = e instanceof ApiError ? e.detail : '重置密码失败，请重试'
  } finally {
    loading.value = false
  }
}

function back() {
  error.value = null
  if (step.value === 2) {
    step.value = 1
    answer.value = ''
  } else if (step.value === 3) {
    step.value = 2
    newPassword.value = ''
    confirmPassword.value = ''
  }
}
</script>

<template>
  <AuthShell>
    <div class="anim-rise">
      <div class="mb-7 flex flex-col items-center text-center">
        <span
          class="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-3xl bg-invert text-invert-ink shadow-card"
        >
          <KeyRound class="h-7 w-7" />
        </span>
        <h1 class="text-2xl font-bold tracking-tight text-ink">找回密码</h1>
        <p class="mt-1 text-sm text-muted">通过密保问题重置你的登录密码</p>
      </div>

      <div class="rounded-3xl border border-border bg-panel p-6 shadow-card sm:p-8">
        <!-- 步骤指示器 -->
        <div class="relative mb-8">
          <div class="absolute left-[16.66%] right-[50%] top-[18px] h-0.5 -z-10 rounded-full transition-colors duration-300"
               :class="step > 1 ? 'bg-invert' : 'bg-border'" />
          <div class="absolute left-[50%] right-[16.66%] top-[18px] h-0.5 -z-10 rounded-full transition-colors duration-300"
               :class="step > 2 ? 'bg-invert' : 'bg-border'" />
          <div class="grid grid-cols-3">
            <div v-for="s in steps" :key="s.n" class="flex flex-col items-center gap-2">
              <span
                class="flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors duration-200"
                :class="dotClass(s.n)"
              >
                <Check v-if="step > s.n" class="h-4 w-4" />
                <template v-else>{{ s.n }}</template>
              </span>
              <span
                class="text-xs transition-colors"
                :class="step === s.n ? 'font-medium text-ink' : 'text-muted'"
              >
                {{ s.label }}
              </span>
            </div>
          </div>
        </div>

        <transition name="step" mode="out-in">
          <!-- 步骤 1：用户名 -->
          <form v-if="step === 1" key="s1" class="space-y-4" @submit.prevent="submitUsername">
            <AppInput
              v-model="username"
              label="用户名"
              placeholder="请输入你的注册用户名"
              autocomplete="username"
              :maxlength="32"
              name="username"
            />
            <div
              v-if="error"
              class="flex items-start gap-2 rounded-2xl border border-border-strong bg-raised px-3.5 py-2.5 text-sm text-ink"
            >
              <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
              <span>{{ error }}</span>
            </div>
            <AppButton type="submit" block size="lg" :loading="loading">
              下一步
              <template #icon><ArrowRight class="h-4 w-4" /></template>
            </AppButton>
          </form>

          <!-- 步骤 2：密保问题 -->
          <form v-else-if="step === 2" key="s2" class="space-y-4" @submit.prevent="submitAnswer">
            <div class="rounded-2xl border border-border bg-raised p-4">
              <p class="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
                <ShieldCheck class="h-3.5 w-3.5" />
                你的密保问题
              </p>
              <p class="text-sm font-medium leading-relaxed text-ink">{{ question }}</p>
            </div>
            <AppInput
              v-model="answer"
              label="密保答案"
              placeholder="请输入注册时填写的答案"
              autocomplete="off"
              :maxlength="60"
              name="answer"
            />
            <div
              v-if="error"
              class="flex items-start gap-2 rounded-2xl border border-border-strong bg-raised px-3.5 py-2.5 text-sm text-ink"
            >
              <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
              <span>{{ error }}</span>
            </div>
            <div class="flex gap-2">
              <AppButton variant="secondary" size="lg" :disabled="loading" @click="back">
                <template #icon><ArrowLeft class="h-4 w-4" /></template>
                上一步
              </AppButton>
              <AppButton type="submit" block size="lg" :loading="loading">
                验证答案
              </AppButton>
            </div>
          </form>

          <!-- 步骤 3：新密码 -->
          <form v-else key="s3" class="space-y-4" @submit.prevent="submitReset">
            <AppInput
              v-model="newPassword"
              type="password"
              label="新密码"
              placeholder="至少 6 位"
              autocomplete="new-password"
              :maxlength="72"
              name="new-password"
            />
            <AppInput
              v-model="confirmPassword"
              type="password"
              label="确认新密码"
              placeholder="再次输入新密码"
              autocomplete="new-password"
              :maxlength="72"
              name="confirm-new-password"
            />
            <div
              v-if="error"
              class="flex items-start gap-2 rounded-2xl border border-border-strong bg-raised px-3.5 py-2.5 text-sm text-ink"
            >
              <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
              <span>{{ error }}</span>
            </div>
            <div class="flex gap-2">
              <AppButton variant="secondary" size="lg" :disabled="loading" @click="back">
                <template #icon><ArrowLeft class="h-4 w-4" /></template>
                上一步
              </AppButton>
              <AppButton type="submit" block size="lg" :loading="loading">
                <template #icon><Check class="h-4 w-4" /></template>
                重置密码
              </AppButton>
            </div>
          </form>
        </transition>

        <div class="mt-6 text-center text-sm text-muted">
          想起密码了？
          <router-link
            :to="{ name: 'login' }"
            class="font-medium text-ink underline-offset-4 transition-colors hover:underline"
          >
            返回登录
          </router-link>
        </div>
      </div>
    </div>
  </AuthShell>
</template>

<style scoped>
.step-enter-active,
.step-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.step-enter-from {
  opacity: 0;
  transform: translateX(12px);
}
.step-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}
</style>
