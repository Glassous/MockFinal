<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { UserPlus, AlertCircle } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { ApiError } from '@/api/client'
import AuthShell from '@/components/AuthShell.vue'
import AppInput from '@/components/AppInput.vue'
import AppButton from '@/components/AppButton.vue'
import type { SelectOption } from '@/components/AppInput.vue'

const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()

const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const securityAnswer = ref('')

const CUSTOM = '__custom__'
const presetQuestions: SelectOption[] = [
  { label: '你的出生地是哪里？', value: '你的出生地是哪里？' },
  { label: '你母亲的姓名是？', value: '你母亲的姓名是？' },
  { label: '你第一所学校的名称是？', value: '你第一所学校的名称是？' },
  { label: '你最喜欢的食物是什么？', value: '你最喜欢的食物是什么？' },
  { label: '你童年时的昵称是？', value: '你童年时的昵称是？' },
  { label: '你最好朋友的名字是？', value: '你最好朋友的名字是？' },
  { label: '自定义问题…', value: CUSTOM },
]
const questionSelect = ref('')
const customQuestion = ref('')

const questionOptions = computed<SelectOption[]>(() => [
  { label: '请选择密保问题', value: '' },
  ...presetQuestions,
])

const securityQuestion = computed(() =>
  questionSelect.value === CUSTOM ? customQuestion.value.trim() : questionSelect.value,
)

const loading = ref(false)
const formError = ref<string | null>(null)
const fieldErrors = ref<Record<string, string | null>>({})

function validate(): boolean {
  const errors: Record<string, string | null> = {}
  if (username.value.trim().length < 3) errors.username = '用户名至少 3 个字符'
  if (password.value.length < 6) errors.password = '密码至少 6 位'
  if (confirmPassword.value !== password.value) errors.confirm = '两次输入的密码不一致'
  if (!securityQuestion.value) errors.question = '请选择或填写密保问题'
  if (!securityAnswer.value.trim()) errors.answer = '请填写密保答案'
  fieldErrors.value = errors
  return Object.keys(errors).length === 0
}

async function onSubmit() {
  formError.value = null
  if (!validate()) return
  loading.value = true
  try {
    await auth.register({
      username: username.value.trim(),
      password: password.value,
      security_question: securityQuestion.value,
      security_answer: securityAnswer.value.trim(),
    })
    toast.success('注册成功，已自动登录')
    await router.replace({ name: 'home' })
  } catch (error) {
    formError.value = error instanceof ApiError ? error.detail : '注册失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthShell label="签到表 · 注册" size="lg">
    <div class="anim-rise">
      <p class="font-mono text-[11px] tracking-wide text-pen">创建账号</p>
      <h1 class="mt-1 font-serif text-2xl font-bold tracking-tight text-ink">
        开始你的复习本。
      </h1>
      <p class="mt-1.5 text-sm leading-relaxed text-muted">
        注册后，资料、复习讲义与模拟卷都会归到你的工作区。
      </p>

      <form class="mt-6 space-y-4" @submit.prevent="onSubmit">
        <AppInput
          v-model="username"
          label="用户名"
          placeholder="至少 3 个字符"
          autocomplete="username"
          :maxlength="32"
          :error="fieldErrors.username"
          name="username"
        />
        <AppInput
          v-model="password"
          type="password"
          label="密码"
          placeholder="至少 6 位"
          autocomplete="new-password"
          :maxlength="72"
          :error="fieldErrors.password"
          name="password"
        />
        <AppInput
          v-model="confirmPassword"
          type="password"
          label="确认密码"
          placeholder="再次输入密码"
          autocomplete="new-password"
          :maxlength="72"
          :error="fieldErrors.confirm"
          name="confirm-password"
        />

        <div class="border-l-2 border-pen bg-raised px-4 py-4">
          <p class="mb-3 font-mono text-[10px] tracking-wide text-muted">
            密保问题用于找回密码，请牢记答案
          </p>
          <div class="space-y-4">
            <AppInput
              v-model="questionSelect"
              type="select"
              label="密保问题"
              :options="questionOptions"
              :error="fieldErrors.question"
              name="security-question"
            />
            <AppInput
              v-if="questionSelect === CUSTOM"
              v-model="customQuestion"
              label="自定义密保问题"
              placeholder="请输入你的密保问题"
              :maxlength="60"
              name="custom-question"
            />
            <AppInput
              v-model="securityAnswer"
              label="密保答案"
              placeholder="请输入密保答案"
              :error="fieldErrors.answer"
              :maxlength="60"
              autocomplete="off"
              name="security-answer"
            />
          </div>
        </div>

        <div
          v-if="formError"
          class="flex items-start gap-2 border-l-2 border-pen bg-pen-soft px-3.5 py-2.5 text-sm text-ink"
        >
          <AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-pen" />
          <span>{{ formError }}</span>
        </div>

        <AppButton type="submit" block size="lg" :loading="loading">
          <template #icon><UserPlus class="h-4 w-4" /></template>
          注册
        </AppButton>
      </form>

      <div class="mt-6 flex items-center justify-between gap-4 border-t border-border pt-4 text-sm text-muted">
        <span>已有账号？</span>
        <router-link :to="{ name: 'login' }" class="e-link">
          返回登录
        </router-link>
      </div>
    </div>
  </AuthShell>
</template>
