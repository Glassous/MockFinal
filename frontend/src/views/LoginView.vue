<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import { ApiError } from '@/api/client'
import BindingThread from '@/components/entry/BindingThread.vue'
import EntryHeader from '@/components/entry/EntryHeader.vue'
import PenCheck from '@/components/entry/PenCheck.vue'
import PenCross from '@/components/entry/PenCross.vue'
import PenUnderline from '@/components/entry/PenUnderline.vue'
import StampMark from '@/components/entry/StampMark.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const coverContents = [
  { no: '01', title: '考纲与优先级', page: '03' },
  { no: '02', title: '概念、公式与例题', page: '05' },
  { no: '03', title: '易错点与检查', page: '09' },
  { no: '04', title: '模拟卷', page: '12' },
  { no: '05', title: '答案与解析', page: '附册', key: true },
]

const username = ref('')
const password = ref('')
const showPassword = ref(false)
const loading = ref(false)
const success = ref(false)
const formError = ref<string | null>(null)
const ready = ref(false)
const coverDrawn = ref(false)
const usernameEl = ref<HTMLInputElement | null>(null)

watch([username, password], () => {
  if (formError.value) formError.value = null
})

onMounted(() => {
  requestAnimationFrame(() => {
    ready.value = true
    requestAnimationFrame(() => {
      coverDrawn.value = true
    })
  })
})

async function onSubmit() {
  if (loading.value) return

  if (!username.value.trim() || !password.value) {
    formError.value = '请输入用户名和密码'
    await nextTick()
    usernameEl.value?.focus()
    return
  }

  formError.value = null
  loading.value = true
  try {
    await auth.login(username.value.trim(), password.value)
    success.value = true

    const redirect = route.query.redirect
    const safeRedirect =
      typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')
        ? redirect
        : null
    const target =
      safeRedirect && safeRedirect !== '/' ? safeRedirect : ({ name: 'home' } as const)

    await new Promise((resolve) => window.setTimeout(resolve, 260))
    await router.replace(target)
  } catch (error) {
    formError.value = error instanceof ApiError ? error.detail : '登录失败，请重试'
    await nextTick()
    usernameEl.value?.focus()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="entry-v3 auth" :class="{ 'is-ready': ready }">
    <EntryHeader variant="auth" />

    <main class="e-container auth__main">
      <div class="auth__cover-wrap">
        <article class="auth-cover e-sheet e-animate" :class="{ 'is-drawn': coverDrawn }">
          <BindingThread />
          <header class="auth-cover__head">
            <span>期末复习 · 装订本</span>
            <span>封面 · 共 2 册</span>
          </header>
          <div class="auth-cover__body">
            <p class="auth-cover__eyebrow">任意科目 · 一份资料</p>
            <p class="auth-cover__title">
              把资料，<span class="auth-cover__title-line"
                >装订成<span class="auth-cover__title-mark">复习本<PenUnderline
                    class="auth-cover__underline" /></span>。</span
              >
            </p>
            <p class="auth-cover__lede">
              讲义在前，模拟卷在后；答案与解析单独成册，不混进题目。
            </p>

            <div class="auth-cover__toc">
              <div class="auth-cover__toc-head">
                <span>本册目录</span>
                <span>共 12 页 · 答案附册</span>
              </div>
              <ol>
                <li
                  v-for="item in coverContents"
                  :key="item.no"
                  :class="{ 'is-key': item.key }"
                >
                  <span class="auth-cover__toc-no">{{ item.no }}</span>
                  <span class="auth-cover__toc-title">{{ item.title }}</span>
                  <span class="auth-cover__toc-dots" aria-hidden="true" />
                  <span class="auth-cover__toc-page">{{ item.page }}</span>
                </li>
              </ol>
            </div>

            <p class="auth-cover__hand e-hand">先看目录，再翻错题。</p>

            <footer class="auth-cover__foot">
              <span class="e-check"><PenCheck /> 封面检查 1/1 · 可装订</span>
            </footer>
          </div>
          <StampMark class="auth-cover__stamp" text="已装订" :delay="0.7" />
        </article>
      </div>

      <div class="auth__form-wrap">
        <article class="auth-form e-sheet">
          <header class="auth-form__head">
            <span>签到表 · 登录</span>
            <span>MockFinal</span>
          </header>

          <div class="auth-form__body">
            <p class="e-folio">继续复习</p>
            <h1 class="auth-form__title">回到你的工作区。</h1>
            <p class="auth-form__lede">登录后接着上次的讲义与模拟卷。</p>

            <form class="auth-form__form" novalidate @submit.prevent="onSubmit">
              <div class="auth-field">
                <label for="login-username">用户名</label>
                <input
                  id="login-username"
                  ref="usernameEl"
                  v-model="username"
                  type="text"
                  name="username"
                  autocomplete="username"
                  :maxlength="32"
                  placeholder="请输入用户名"
                  :aria-invalid="formError ? 'true' : undefined"
                  :aria-describedby="formError ? 'login-error' : undefined"
                  :disabled="loading"
                />
              </div>

              <div class="auth-field">
                <label for="login-password">密码</label>
                <div class="auth-field__row">
                  <input
                    id="login-password"
                    v-model="password"
                    :type="showPassword ? 'text' : 'password'"
                    name="password"
                    autocomplete="current-password"
                    :maxlength="72"
                    placeholder="请输入密码"
                    :aria-invalid="formError ? 'true' : undefined"
                    :aria-describedby="formError ? 'login-error' : undefined"
                    :disabled="loading"
                  />
                  <button
                    type="button"
                    class="auth-field__toggle"
                    :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                    @click="showPassword = !showPassword"
                  >
                    {{ showPassword ? '隐藏' : '显示' }}
                  </button>
                </div>
              </div>

              <p v-if="formError" id="login-error" class="auth-error e-animate is-drawn" role="alert">
                <span class="auth-error__icon"><PenCross /></span>
                <span>{{ formError }}</span>
              </p>

              <button
                type="submit"
                class="e-btn e-btn--pen auth-submit"
                :class="{ 'is-success': success, 'e-animate': success, 'is-drawn': success }"
                :disabled="loading || success"
                :aria-busy="loading || undefined"
              >
                <template v-if="success">
                  <PenCheck class="auth-submit__icon" />
                  已登录
                </template>
                <template v-else-if="loading">
                  <span class="auth-submit__stitch" aria-hidden="true" />
                  正在登录
                </template>
                <template v-else>
                  登录
                  <ArrowRight :size="16" :stroke-width="1.8" />
                </template>
              </button>
            </form>

            <div class="auth-form__links">
              <router-link :to="{ name: 'forgot' }" class="e-link">忘记密码？</router-link>
              <router-link :to="{ name: 'register' }" class="e-link e-link--pen">
                注册新账号
              </router-link>
            </div>

            <p class="auth-form__note">资料仅支持 .md / .txt · 单文件 ≤ 8 MiB</p>
          </div>
        </article>
      </div>
    </main>
  </div>
</template>

<style scoped>
.auth {
  min-height: 100dvh;
}

.auth main {
  overflow-x: clip;
}

.auth__main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 480px);
  gap: clamp(32px, 5vw, 80px);
  align-items: center;
  min-height: calc(100dvh - 72px);
  padding-block: clamp(36px, 6vw, 72px);
}

.auth__cover-wrap {
  min-width: 0;
}

.auth-cover {
  width: 100%;
  max-width: 620px;
  margin-left: auto;
  transform: rotate(-1.2deg);
  transition: transform 0.6s var(--e-ease-page);
}

.auth-cover:hover {
  transform: rotate(0deg) translateY(-2px);
}

.auth-cover__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.95rem 1.8rem 0.95rem 3.4rem;
  border-bottom: 1px solid var(--e-line);
  color: var(--e-muted);
  font-family: var(--e-font-mono);
  font-size: 0.75rem;
}

.auth-cover__body {
  padding: 1.7rem 2rem 1.6rem 3.4rem;
}

.auth-cover__eyebrow {
  margin: 0;
  color: var(--e-pen);
  font-size: 0.8125rem;
  font-weight: 600;
}

.auth-cover__title {
  margin: 0.35rem 0 0;
  font-family: var(--e-font-serif);
  font-size: clamp(2rem, 3vw, 2.7rem);
  line-height: 1.2;
  text-wrap: balance;
}

.auth-cover__title-line {
  white-space: nowrap;
}

.auth-cover__title-mark {
  position: relative;
  display: inline-block;
  white-space: nowrap;
}

.auth-cover__underline {
  left: -2%;
  bottom: -0.22em;
  width: 104%;
  height: 0.32em;
  opacity: 0.75;
}

.auth-cover__lede {
  margin: 0.55rem 0 0;
  max-width: 26rem;
  color: var(--e-muted);
  font-size: 0.9375rem;
  line-height: 1.75;
}

.auth-cover__toc {
  margin-top: 1.45rem;
  border-top: 1px solid var(--e-line);
}

.auth-cover__toc-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.7rem 0 0.35rem;
  color: var(--e-muted);
  font-family: var(--e-font-mono);
  font-size: 0.7rem;
}

.auth-cover__toc ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

.auth-cover__toc li {
  display: flex;
  align-items: baseline;
  gap: 0.65rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--e-line);
}

.auth-cover__toc-no {
  width: 1.5rem;
  flex-shrink: 0;
  color: var(--e-faint);
  font-family: var(--e-font-mono);
  font-size: 0.7rem;
}

.auth-cover__toc-title {
  color: var(--e-ink-2);
  font-size: 0.9rem;
}

.auth-cover__toc-dots {
  flex: 1;
  min-width: 1.5rem;
  border-bottom: 1px dotted var(--e-line-strong);
  transform: translateY(-0.22rem);
}

.auth-cover__toc-page {
  flex-shrink: 0;
  color: var(--e-faint);
  font-family: var(--e-font-mono);
  font-size: 0.7rem;
}

.auth-cover__toc li.is-key .auth-cover__toc-title {
  color: var(--e-ink);
  font-weight: 600;
}

.auth-cover__toc li.is-key .auth-cover__toc-page {
  color: var(--e-pen);
}

.auth-cover__hand {
  margin: 0.95rem 0 0;
  font-size: 1.2rem;
  line-height: 1.4;
  text-align: right;
  transform: rotate(-1.6deg);
}

.auth-cover__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 0.9rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--e-line);
  color: var(--e-muted);
  font-size: 0.75rem;
}

.auth-cover__stamp {
  position: absolute;
  right: 1.5rem;
  bottom: 1.3rem;
}

.auth__form-wrap {
  min-width: 0;
}

.auth-form {
  width: 100%;
  margin-right: auto;
}

.auth-form__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1.5rem;
  border-bottom: 1px solid var(--e-line);
  color: var(--e-muted);
  font-family: var(--e-font-mono);
  font-size: 0.75rem;
}

.auth-form__body {
  position: relative;
  padding: 1.8rem 2rem 1.6rem 3.2rem;
}

.auth-form__body::before {
  content: '';
  position: absolute;
  left: 2rem;
  top: 1.8rem;
  bottom: 1.6rem;
  width: 1px;
  background: var(--e-pen-line);
}

.auth-form__title {
  margin: 0.5rem 0 0;
  font-family: var(--e-font-serif);
  font-size: clamp(1.75rem, 2.5vw, 2.15rem);
  line-height: 1.25;
}

.auth-form__lede {
  margin: 0.5rem 0 0;
  color: var(--e-muted);
  font-size: 0.9375rem;
}

.auth-form__form {
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
  margin-top: 2rem;
}

.auth-field {
  position: relative;
}

.auth-field label {
  display: block;
  margin-bottom: 0.35rem;
  color: var(--e-muted);
  font-size: 0.8125rem;
  font-weight: 600;
}

.auth-field input {
  width: 100%;
  height: 46px;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--e-line-strong);
  border-radius: 0;
  background: transparent;
  color: var(--e-ink);
  font-size: 1rem;
  transition: border-color var(--e-dur-1) ease;
}

.auth-field input::placeholder {
  color: var(--e-faint);
}

.auth-field input:focus {
  border-bottom-color: transparent;
  outline: none;
}

.auth-field input:disabled {
  opacity: 0.6;
}

.auth-field::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1.5px;
  background: var(--e-pen);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.28s var(--e-ease-page);
  pointer-events: none;
}

.auth-field:focus-within::after {
  transform: scaleX(1);
}

.auth-field__row {
  position: relative;
}

.auth-field__row input {
  padding-right: 3.6rem;
}

.auth-field__toggle {
  position: absolute;
  right: 0;
  bottom: 0.7rem;
  padding: 0.2rem 0;
  color: var(--e-muted);
  font-size: 0.8125rem;
  transition: color var(--e-dur-1) ease;
}

.auth-field__toggle:hover {
  color: var(--e-pen);
}

.auth-error {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin: 0;
  padding: 0.6rem 0 0.6rem 0.8rem;
  border-left: 2px solid var(--e-pen);
  color: var(--e-ink);
  font-size: 0.875rem;
  line-height: 1.6;
}

.auth-error__icon {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  color: var(--e-pen);
}

.auth-error__icon svg {
  width: 18px;
  height: 18px;
}

.auth-submit {
  width: 100%;
  height: 52px;
  margin-top: 0.2rem;
}

.auth-submit:disabled {
  opacity: 1;
}

.auth-submit.is-success {
  background: var(--e-pen-fill);
}

.auth-submit__icon {
  width: 18px;
  height: 18px;
}

.auth-submit__stitch {
  width: 28px;
  height: 2px;
  background-image: repeating-linear-gradient(
    90deg,
    currentColor 0 4px,
    transparent 4px 8px
  );
  opacity: 0.9;
  animation: auth-stitch 0.8s linear infinite;
}

@keyframes auth-stitch {
  to {
    background-position-x: 8px;
  }
}

.auth-form__links {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1.25rem;
  font-size: 0.875rem;
}

.auth-form__note {
  margin: 1.8rem 0 0;
  color: var(--e-faint);
  font-family: var(--e-font-mono);
  font-size: 0.7rem;
}

@media (max-width: 1080px) {
  .auth__main {
    grid-template-columns: 1fr;
    gap: 2.4rem;
    min-height: 0;
    padding-block: 2.4rem 3rem;
  }

  .auth-cover {
    max-width: none;
    transform: none;
  }

  .auth-cover:hover {
    transform: none;
  }

  .auth-cover__toc,
  .auth-cover__hand,
  .auth-cover__foot {
    display: none;
  }

  .auth-cover__body {
    padding: 1.2rem 1.4rem 1.2rem 2.6rem;
  }

  .auth-cover__head {
    padding: 0.8rem 1.4rem 0.8rem 2.6rem;
  }

  .auth-cover__stamp {
    display: none;
  }

  .auth-form {
    max-width: none;
    margin: 0;
  }
}

@media (max-width: 560px) {
  .auth-cover__body {
    padding: 1rem 1.2rem 1rem 2.4rem;
  }

  .auth-cover__lede {
    display: none;
  }

  .auth-cover__title {
    font-size: 1.8rem;
  }

  .auth-form__body {
    padding: 1.4rem 1.2rem 1.4rem 2.4rem;
  }

  .auth-form__body::before {
    left: 1.4rem;
    top: 1.4rem;
    bottom: 1.4rem;
  }

  .auth-form__head {
    padding-inline: 1.2rem;
  }
}
</style>
