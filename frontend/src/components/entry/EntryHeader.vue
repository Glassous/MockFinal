<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import BrandMark from './BrandMark.vue'
import EntryThemeToggle from './EntryThemeToggle.vue'

const props = withDefaults(
  defineProps<{
    variant?: 'landing' | 'auth'
    sections?: { id: string; label: string }[]
  }>(),
  {
    variant: 'landing',
    sections: () => [],
  },
)

const auth = useAuthStore()

const cta = computed(() => (auth.isAuthenticated ? { name: 'home' } : { name: 'login' }))
const ctaLabel = computed(() => (auth.isAuthenticated ? '进入工作区' : '开始整理'))

function scrollTo(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
}
</script>

<template>
  <header class="e-header">
    <div class="e-container e-header__inner">
      <router-link :to="{ name: 'landing' }" aria-label="MockFinal 入口">
        <BrandMark />
      </router-link>

      <nav v-if="props.variant === 'landing'" class="e-nav" aria-label="页面章节">
        <a
          v-for="section in props.sections"
          :key="section.id"
          :href="`#${section.id}`"
          @click.prevent="scrollTo(section.id)"
        >
          {{ section.label }}
        </a>
      </nav>

      <div class="e-header__actions">
        <template v-if="props.variant === 'landing'">
          <router-link
            v-if="!auth.isAuthenticated"
            :to="{ name: 'login' }"
            class="e-link e-header__login"
          >
            登录
          </router-link>
          <router-link :to="cta" class="e-btn e-btn--pen">{{ ctaLabel }}</router-link>
        </template>
        <template v-else>
          <router-link :to="{ name: 'landing' }" class="e-link e-header__back">
            返回入口
          </router-link>
        </template>
        <EntryThemeToggle />
      </div>
    </div>
  </header>
</template>
