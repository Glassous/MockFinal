import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { getToken } from '@/api/client'

declare module 'vue-router' {
  interface RouteMeta {
    /** 访客页（登录/注册/找回），已登录用户访问会被重定向到首页 */
    guest?: boolean
    title?: string
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { guest: true, title: '登录' },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/RegisterView.vue'),
    meta: { guest: true, title: '注册' },
  },
  {
    path: '/forgot',
    name: 'forgot',
    component: () => import('@/views/ForgotPasswordView.vue'),
    meta: { guest: true, title: '找回密码' },
  },
  {
    path: '/',
    component: () => import('@/layouts/AppLayout.vue'),
    children: [
      {
        path: '',
        name: 'home',
        component: () => import('@/views/HomeView.vue'),
        meta: { title: '工作区' },
      },
      {
        path: 'workspace/:id',
        name: 'workspace',
        component: () => import('@/views/WorkspaceView.vue'),
        meta: { title: '工作区' },
      },
    ],
  },
  {
    path: '/workspace/:id/decks/:deckId',
    component: () => import('@/layouts/DeckLayout.vue'),
    children: [
      {
        path: '',
        name: 'deck-overview',
        component: () => import('@/views/DeckOverviewView.vue'),
        meta: { title: '复习页' },
      },
      {
        path: 'build',
        name: 'deck-build',
        component: () => import('@/views/DeckBuildView.vue'),
        meta: { title: '构建工作台' },
      },
      {
        path: 'pages/:pageId',
        name: 'deck-reader',
        component: () => import('@/views/DeckReaderView.vue'),
        meta: { title: '复习页阅读' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

// vue-router 5：守卫用返回值控制导航，不使用 next()
router.beforeEach((to) => {
  const authed = !!getToken()

  if (to.meta.guest) {
    return authed ? { name: 'home' } : true
  }

  if (!authed) {
    return {
      name: 'login',
      query: to.fullPath && to.fullPath !== '/' ? { redirect: to.fullPath } : {},
    }
  }

  return true
})

router.afterEach((to) => {
  const base = 'MockFinal · 期末终极复习助手'
  document.title = to.meta.title ? `${to.meta.title} · ${base}` : base
})
