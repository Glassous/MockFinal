import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as api from '@/api/workspaces'
import { ApiError } from '@/api/client'
import { useToastStore } from '@/stores/toast'
import type { Workspace, WorkspaceCreate, WorkspaceUpdate } from '@/types'

export const useWorkspaceStore = defineStore('workspace', () => {
  const workspaces = ref<Workspace[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  /** 全局「新建工作区」弹窗开关（Sidebar 承载弹窗，任意页面可触发） */
  const createOpen = ref(false)

  function openCreate(): void {
    createOpen.value = true
  }
  function closeCreate(): void {
    createOpen.value = false
  }

  async function fetch(force = false): Promise<void> {
    if (loading.value) return
    if (loaded.value && !force) return
    loading.value = true
    try {
      workspaces.value = await api.listWorkspaces()
      loaded.value = true
    } catch (error) {
      // 内部捕获并提示，消除 HomeView/Sidebar onMounted 调用处的 unhandled rejection；
      // 401 由全局 handler 统一处理，不重复弹错
      if (!(error instanceof ApiError && error.status === 401)) {
        useToastStore().error(
          error instanceof ApiError ? error.detail : '加载工作区失败，请重试',
        )
      }
    } finally {
      loading.value = false
    }
  }

  async function create(payload: WorkspaceCreate): Promise<Workspace> {
    const ws = await api.createWorkspace(payload)
    workspaces.value = [ws, ...workspaces.value]
    return ws
  }

  async function update(id: number, payload: WorkspaceUpdate): Promise<Workspace> {
    const ws = await api.updateWorkspace(id, payload)
    const idx = workspaces.value.findIndex((w) => w.id === id)
    if (idx >= 0) workspaces.value[idx] = ws
    return ws
  }

  async function remove(id: number): Promise<void> {
    await api.deleteWorkspace(id)
    workspaces.value = workspaces.value.filter((w) => w.id !== id)
  }

  function getById(id: number): Workspace | undefined {
    return workspaces.value.find((w) => w.id === id)
  }

  function reset(): void {
    workspaces.value = []
    loaded.value = false
    loading.value = false
    createOpen.value = false
  }

  return {
    workspaces,
    loading,
    loaded,
    createOpen,
    openCreate,
    closeCreate,
    fetch,
    create,
    update,
    remove,
    getById,
    reset,
  }
})
