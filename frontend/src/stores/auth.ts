import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as authApi from '@/api/auth'
import type { RegisterPayload } from '@/api/auth'
import { clearToken, getToken, setToken } from '@/api/client'
import { useWorkspaceStore } from '@/stores/workspace'
import type { User } from '@/types'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(getToken())
  const user = ref<User | null>(null)
  const isAuthenticated = computed(() => !!token.value)

  function setSession(newToken: string, newUser: User): void {
    token.value = newToken
    user.value = newUser
    setToken(newToken)
    // 登录/切换账号时清空上一个账号的工作区缓存，避免跨账号状态泄露
    useWorkspaceStore().reset()
  }

  async function login(username: string, password: string): Promise<void> {
    const res = await authApi.login({ username, password })
    setSession(res.token, res.user)
  }

  async function register(payload: RegisterPayload): Promise<void> {
    const res = await authApi.register(payload)
    setSession(res.token, res.user)
  }

  async function fetchMe(): Promise<User> {
    const me = await authApi.getMe()
    user.value = me
    return me
  }

  function logout(): void {
    token.value = null
    user.value = null
    clearToken()
    // 登出（含全局 401 handler、主动退出）时清空工作区缓存
    useWorkspaceStore().reset()
  }

  return { token, user, isAuthenticated, login, register, fetchMe, logout }
})
