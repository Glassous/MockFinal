<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { samplePages } from '@/lib/entrySample'
import BindingThread from './BindingThread.vue'
import TexBlock from './TexBlock.vue'
import PenCircle from './PenCircle.vue'
import PenArrow from './PenArrow.vue'
import PenCheck from './PenCheck.vue'
import StampMark from './StampMark.vue'

const page = samplePages.find((item) => item.id === 'example')!
const drawn = ref(false)

onMounted(() => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      drawn.value = true
    })
  })
})
</script>

<template>
  <article class="hero-sheet e-sheet e-animate" :class="{ 'is-drawn': drawn }">
    <BindingThread />
    <header class="hero-sheet__head">
      <span>复变函数 · 留数定理</span>
      <span>第 04 页 / 共 16 页</span>
    </header>

    <div class="hero-sheet__body">
      <p class="hero-sheet__eyebrow">期末终极复习 · 例题</p>
      <h2 class="hero-sheet__title">{{ page.title }}</h2>
      <p class="hero-sheet__lede">{{ page.lede }}</p>

      <div class="hero-sheet__stage">
        <div class="hero-sheet__formula">
          <TexBlock :tex="page.formula!" display />
          <PenCircle class="hero-sheet__circle" :delay="1" />
        </div>
        <div class="hero-sheet__note">
          <PenArrow class="hero-sheet__arrow" />
          <span class="e-hand">圈外不算</span>
        </div>
      </div>

      <ol class="hero-sheet__steps">
        <li
          v-for="(point, index) in page.points"
          :key="point.title"
          :class="{ 'is-done': point.done }"
        >
          <span class="hero-sheet__step-no">0{{ index + 1 }}</span>
          <span>
            <b>{{ point.title }}</b>{{ point.text }}
            <PenCheck v-if="point.done" class="step-check" />
          </span>
        </li>
      </ol>

      <footer class="hero-sheet__foot">
        <span class="e-check"><PenCheck /> 本页检查 1/1 · 已掌握</span>
        <StampMark text="已批注" :delay="0.9" />
      </footer>
    </div>
  </article>
</template>

<style scoped>
.hero-sheet {
  width: 100%;
  max-width: 700px;
  margin-left: auto;
  transform: rotate(-1.2deg);
  transition: transform 0.6s var(--e-ease-page);
}

.hero-sheet:hover {
  transform: rotate(0deg) translateY(-2px);
}

.hero-sheet__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.95rem 2rem 0.95rem 3.4rem;
  border-bottom: 1px solid var(--e-line);
  color: var(--e-muted);
  font-family: var(--e-font-mono);
  font-size: 0.75rem;
}

.hero-sheet__body {
  padding: 1.5rem 2rem 1.6rem 3.4rem;
}

.hero-sheet__eyebrow {
  margin: 0;
  color: var(--e-pen);
  font-size: 0.8125rem;
  font-weight: 600;
}

.hero-sheet__title {
  margin: 0.35rem 0 0;
  font-family: var(--e-font-serif);
  font-size: clamp(1.35rem, 2vw, 1.65rem);
  line-height: 1.3;
  text-wrap: balance;
}

.hero-sheet__lede {
  margin: 0.55rem 0 0;
  max-width: 34rem;
  color: var(--e-muted);
  font-size: 0.9rem;
  line-height: 1.7;
}

.hero-sheet__stage {
  position: relative;
  margin: 1.4rem 0 1.1rem;
  padding-right: 6.5rem;
}

.hero-sheet__formula {
  position: relative;
  padding: 0.7rem 0;
  overflow-x: auto;
  overflow-y: hidden;
  font-size: clamp(0.98rem, 1.35vw, 1.22rem);
}

.hero-sheet__circle {
  left: -18px;
  top: -14px;
  width: calc(100% + 36px);
  height: calc(100% + 28px);
}

.hero-sheet__note {
  position: absolute;
  right: 0;
  top: 50%;
  width: 6.2rem;
  color: var(--e-pen);
  font-family: var(--e-font-hand);
  font-size: 1.15rem;
  line-height: 1.25;
  transform: rotate(-3deg) translateY(-40%);
}

.hero-sheet__arrow {
  left: -30px;
  top: -16px;
  width: 36px;
  height: 30px;
  transform: scaleX(-1);
}

.hero-sheet__steps {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--e-line);
}

.hero-sheet__steps li {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  gap: 0.6rem;
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--e-line);
  color: var(--e-ink-2);
  font-size: 0.875rem;
  line-height: 1.6;
}

.hero-sheet__steps b {
  margin-right: 0.45rem;
  color: var(--e-ink);
  font-weight: 600;
}

.hero-sheet__step-no {
  padding-top: 0.08rem;
  color: var(--e-faint);
  font-family: var(--e-font-mono);
  font-size: 0.7rem;
}

.hero-sheet__steps li.is-done .hero-sheet__step-no {
  color: var(--e-pen);
}

.step-check {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-left: 0.3rem;
  color: var(--e-pen);
  vertical-align: -1px;
}

.hero-sheet__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--e-line);
}

@media (max-width: 640px) {
  .hero-sheet {
    max-width: none;
    transform: none;
  }

  .hero-sheet:hover {
    transform: none;
  }

  .hero-sheet__head {
    padding: 0.8rem 0.9rem 0.8rem 2.2rem;
  }

  .hero-sheet__body {
    padding: 1.1rem 0.9rem 1.2rem 2.2rem;
  }

  .hero-sheet__formula {
    font-size: 0.86rem;
  }

  .hero-sheet__stage {
    padding-right: 0;
  }

  .hero-sheet__note {
    position: static;
    width: auto;
    margin-top: 0.9rem;
    transform: rotate(-2deg);
  }

  .hero-sheet__arrow {
    display: none;
  }

  .hero-sheet__foot {
    flex-wrap: wrap;
  }
}
</style>
