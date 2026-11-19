<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowRight, FileText } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/auth'
import BrandMark from '@/components/entry/BrandMark.vue'
import ClosingSection from '@/components/entry/ClosingSection.vue'
import DeckSection from '@/components/entry/DeckSection.vue'
import EntryHeader from '@/components/entry/EntryHeader.vue'
import EntryRail from '@/components/entry/EntryRail.vue'
import HeroSpecimen from '@/components/entry/HeroSpecimen.vue'
import ProcessSection from '@/components/entry/ProcessSection.vue'
import QuizSection from '@/components/entry/QuizSection.vue'

const sections = [
  { id: 'sample', label: '样张' },
  { id: 'process', label: '工序' },
  { id: 'pages', label: '翻页' },
  { id: 'quiz', label: '试做' },
  { id: 'start', label: '开始' },
]

const auth = useAuthStore()
const ready = ref(false)
const startTarget = computed(() => (auth.isAuthenticated ? { name: 'home' } : { name: 'login' }))

onMounted(() => {
  requestAnimationFrame(() => {
    ready.value = true
  })
})

function scrollTo(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
}
</script>

<template>
  <div class="entry-v3 landing" :class="{ 'is-ready': ready }">
    <EntryHeader :sections="sections" />
    <EntryRail :sections="sections" />

    <main>
      <section id="sample" class="hero">
        <div class="e-container hero__inner">
          <div class="hero__copy">
            <p class="e-kicker">01 / 样张 · 期末复习</p>
            <h1 class="e-display hero__title">从资料，到考场。</h1>
            <p class="e-body hero__lede">
              上传 .md / .txt 课程资料，生成一份能逐页读的复习讲义，和一份带答案的模拟卷。
            </p>
            <div class="hero__flow e-animate" :class="{ 'is-drawn': ready }">
              <span class="hero__flow-file">
                <FileText :size="14" :stroke-width="1.8" />
                .md / .txt
              </span>
              <svg
                class="hero__flow-branch"
                viewBox="0 0 36 62"
                fill="none"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  class="e-draw"
                  d="M0 31 H14 M14 14 V48 M14 14 H36 M14 48 H36"
                  pathLength="1"
                  stroke="currentColor"
                  stroke-width="1.3"
                  stroke-linecap="round"
                  vector-effect="non-scaling-stroke"
                />
              </svg>
              <span class="hero__flow-outputs">
                <span>复习讲义</span>
                <span>模拟卷 <i>+ 答案</i></span>
              </span>
            </div>

            <div class="hero__actions">
              <router-link :to="startTarget" class="e-btn e-btn--pen">
                开始整理
                <ArrowRight :size="16" :stroke-width="1.8" />
              </router-link>
              <a href="#process" class="e-link" @click.prevent="scrollTo('process')">
                看它怎么工作
              </a>
            </div>
            <p class="hero__note">资料仅支持 .md / .txt · 单文件 ≤ 8 MiB</p>
          </div>

          <div class="hero__specimen">
            <HeroSpecimen />
            <p class="hero__caption">示例 · 复变函数 · 第 3 讲</p>
          </div>
        </div>

        <a href="#process" class="hero__scroll" @click.prevent="scrollTo('process')">
          <span>往下看，这张纸怎么来的</span>
          <span class="hero__scroll-line" aria-hidden="true" />
        </a>
      </section>

      <ProcessSection />
      <DeckSection />
      <QuizSection />
      <ClosingSection />
    </main>

    <footer class="landing-foot">
      <div class="e-container landing-foot__inner">
        <BrandMark />
        <p class="landing-foot__note">示例内容 · 复变函数讲义</p>
        <div class="landing-foot__links">
          <router-link v-if="!auth.isAuthenticated" :to="{ name: 'login' }" class="e-link">
            登录
          </router-link>
          <router-link v-if="!auth.isAuthenticated" :to="{ name: 'register' }" class="e-link">
            注册
          </router-link>
          <router-link v-else :to="{ name: 'home' }" class="e-link">进入工作区</router-link>
          <a href="#sample" class="e-link" @click.prevent="scrollTo('sample')">回到顶部</a>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  min-height: 100dvh;
}

.landing main {
  overflow-x: clip;
}

.hero {
  position: relative;
  min-height: calc(100dvh - 72px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-block: clamp(40px, 6vw, 80px) 0;
}

.hero__inner {
  display: grid;
  grid-template-columns: minmax(300px, 0.86fr) minmax(0, 1.14fr);
  gap: clamp(32px, 6vw, 88px);
  align-items: center;
}

.hero__copy {
  max-width: 34rem;
}

.hero__title {
  margin: 0.9rem 0 0;
  font-size: clamp(2.2rem, 3.6vw, 3.35rem);
}

.hero__lede {
  max-width: 30rem;
  margin: 1.25rem 0 0;
}

.hero__flow {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-top: 1.8rem;
}

.hero__flow-file {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  height: 34px;
  padding: 0 0.75rem;
  border: 1px solid var(--e-line-strong);
  color: var(--e-ink);
  font-family: var(--e-font-mono);
  font-size: 0.75rem;
  white-space: nowrap;
}

.hero__flow-file svg {
  flex-shrink: 0;
  color: var(--e-muted);
}

.hero__flow-branch {
  flex-shrink: 0;
  width: 36px;
  height: 62px;
  color: var(--e-pen);
}

.hero__flow-outputs {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.hero__flow-outputs span {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 0.65rem;
  border: 1px solid var(--e-line);
  background: var(--e-sheet);
  color: var(--e-ink-2);
  font-size: 0.8125rem;
  white-space: nowrap;
}

.hero__flow-outputs i {
  margin-left: 0.35rem;
  color: var(--e-pen);
  font-family: var(--e-font-mono);
  font-size: 0.68rem;
  font-style: normal;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1.4rem;
  margin-top: 1.5rem;
}

.hero__note {
  margin: 1.6rem 0 0;
  color: var(--e-faint);
  font-family: var(--e-font-mono);
  font-size: 0.72rem;
}

.hero__specimen {
  min-width: 0;
}

.hero__caption {
  margin: 1.1rem 0 0;
  color: var(--e-faint);
  font-family: var(--e-font-mono);
  font-size: 0.72rem;
  text-align: right;
}

.hero__scroll {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.8rem;
  margin-top: clamp(2rem, 4vw, 3.2rem);
  padding-bottom: 1.6rem;
  color: var(--e-muted);
  font-size: 0.75rem;
}

.hero__scroll-line {
  width: 1px;
  height: 42px;
  background: linear-gradient(to bottom, var(--e-pen), transparent);
}

.landing-foot {
  border-top: 1px solid var(--e-line);
}

.landing-foot__inner {
  display: flex;
  align-items: center;
  gap: 1.4rem;
  padding-block: 1.4rem;
}

.landing-foot__note {
  margin: 0;
  color: var(--e-faint);
  font-family: var(--e-font-mono);
  font-size: 0.7rem;
}

.landing-foot__links {
  display: flex;
  align-items: center;
  gap: 1.3rem;
  margin-left: auto;
}

.landing-foot__links .e-link {
  font-size: 0.8125rem;
}

@media (max-width: 980px) {
  .hero {
    min-height: 0;
  }

  .hero__inner {
    grid-template-columns: 1fr;
    gap: 2.4rem;
  }

  .hero__copy {
    max-width: none;
  }

  .hero__title {
    font-size: clamp(2.2rem, 7vw, 3rem);
  }

  .hero__scroll {
    display: none;
  }
}

@media (max-width: 640px) {
  .hero {
    padding-top: 2rem;
  }

  .hero__flow {
    gap: 0.4rem;
  }

  .hero__flow-file {
    padding: 0 0.55rem;
    font-size: 0.7rem;
  }

  .hero__flow-branch {
    width: 26px;
    height: 58px;
  }

  .hero__flow-outputs span {
    height: 26px;
    padding: 0 0.5rem;
    font-size: 0.75rem;
  }

  .hero__flow-outputs i {
    font-size: 0.62rem;
  }

  .hero__caption {
    text-align: left;
  }

  .landing-foot__inner {
    flex-wrap: wrap;
    gap: 0.8rem 1.2rem;
  }

  .landing-foot__note {
    display: none;
  }

  .landing-foot__links {
    margin-left: 0;
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
