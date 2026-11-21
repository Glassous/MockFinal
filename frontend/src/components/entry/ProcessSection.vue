<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  processSteps,
  reviewOutline,
  examOutline,
  samplePages,
  type ProcessStepId,
} from '@/lib/entrySample'
import BindingThread from './BindingThread.vue'
import PenArrow from './PenArrow.vue'
import PenCheck from './PenCheck.vue'
import PenCircle from './PenCircle.vue'
import PenUnderline from './PenUnderline.vue'
import StampMark from './StampMark.vue'
import TexBlock from './TexBlock.vue'

const examplePage = samplePages.find((item) => item.id === 'example')!
const active = ref<ProcessStepId>('split')
const drawn = ref(false)
const stage = ref<HTMLElement | null>(null)
const activeStep = computed(() => processSteps.find((step) => step.id === active.value)!)
let observer: IntersectionObserver | null = null
let timer = 0

function replay() {
  drawn.value = false
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    drawn.value = true
  }, 40)
}

function select(id: ProcessStepId) {
  if (active.value === id) return
  active.value = id
  replay()
  nextTick(() => {
    document.getElementById('process-tab-' + id)?.focus()
  })
}

function onTabKeydown(event: KeyboardEvent, index: number) {
  let next = index
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    next = (index + 1) % processSteps.length
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    next = (index - 1 + processSteps.length) % processSteps.length
  } else if (event.key === 'Home') {
    next = 0
  } else if (event.key === 'End') {
    next = processSteps.length - 1
  } else {
    return
  }
  event.preventDefault()
  select(processSteps[next].id)
}

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting) {
        replay()
        observer?.disconnect()
      }
    },
    { threshold: 0.2 },
  )
  if (stage.value) observer.observe(stage.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  window.clearTimeout(timer)
})
</script>

<template>
  <section id="process" class="e-section process">
    <div class="e-container">
      <div class="e-section-head">
        <div>
          <p class="e-folio">02 / 工序</p>
          <h2 class="e-h2">先拆开，再装订。</h2>
        </div>
        <div class="e-section-head__aside">
          <p class="e-body">
            按知识点分节，为每一节批注目标、例题与易错点，再装订成两份成品。资料里的公式、出处和页码都留在原位。
          </p>
        </div>
      </div>

      <div class="process__layout">
        <div class="process__tabs" role="tablist" aria-label="资料处理工序">
          <button
            v-for="(step, index) in processSteps"
            :id="'process-tab-' + step.id"
            :key="step.id"
            type="button"
            role="tab"
            class="process__tab"
            :class="{ 'is-active': active === step.id }"
            :aria-selected="active === step.id"
            :aria-controls="'process-stage'"
            :tabindex="active === step.id ? 0 : -1"
            @click="select(step.id)"
            @keydown="onTabKeydown($event, index)"
          >
            <span class="process__tab-index">{{ step.index }}</span>
            <span class="process__tab-title">{{ step.title }}</span>
            <span class="process__tab-desc">{{ step.desc }}</span>
          </button>
        </div>

        <div
          id="process-stage"
          ref="stage"
          class="process-stage e-sheet e-sheet--soft"
          role="tabpanel"
          :aria-labelledby="'process-tab-' + active"
          tabindex="0"
        >
          <header class="process-stage__head">
            <span>工序 {{ activeStep.index }} · {{ activeStep.title }}</span>
            <span>示例 · 复变函数</span>
          </header>

          <div class="process-stage__body e-animate" :class="{ 'is-drawn': drawn }">
            <Transition name="e-stage" mode="out-in">
              <div v-if="active === 'split'" key="split" class="stage-split">
                <div class="stage-split__file">
                  <span class="stage-split__tab">复变函数-第3讲.md</span>
                  <span class="stage-split__meta">4 节 · 3 个知识点</span>
                </div>
                <pre class="stage-split__code" aria-label="课程资料原文示例"><code># 复变函数 · 第 3 讲
## 留数定理
设 f 在简单闭曲线 C 内除有限个孤立奇点外解析……
## 为什么用留数
留数定理把复杂的围道积分降成有限个代数留数……
## 例题
I = ∮_C (z²+1)/((z−1)(z+2)(z−4)) dz
## 易错点
z=4 在圈外，不能算；负向曲线要乘 −1。</code></pre>
                <div class="stage-split__bracket" aria-hidden="true">
                  <span>4 节</span>
                  <span>3 考点</span>
                </div>
                <p class="stage-split__tip">每一节都保留标题与出处，后面对应到具体页码。</p>
              </div>

              <div v-else-if="active === 'mark'" key="mark" class="stage-mark">
                <div class="stage-mark__head">
                  <span>第 3 讲 · 留数定理</span>
                  <span>批注 03</span>
                </div>
                <h3 class="stage-mark__title">先判内外，再算留数。</h3>
                <div class="stage-mark__formula">
                  <TexBlock :tex="examplePage.formula!" display />
                  <PenCircle class="stage-mark__circle" :delay="1" />
                  <PenUnderline class="stage-mark__underline" />
                </div>
                <div class="stage-mark__note">
                  <PenArrow class="stage-mark__arrow" />
                  <span class="e-hand">圈外不算</span>
                </div>
                <ul class="stage-mark__points">
                  <li><PenCheck /> 找奇点：1、−2、4</li>
                  <li><PenCheck /> 判内外：1、−2 在内，4 在外</li>
                  <li><PenCheck /> 求和：I = πi/9</li>
                </ul>
                <p class="stage-mark__strike">圈外奇点也要算</p>
              </div>

              <div v-else key="bind" class="stage-bind">
                <div class="stage-bind__sheet">
                  <BindingThread :holes="['18%', '82%']" />
                  <span class="stage-bind__label">产出 01</span>
                  <h3>期末终极复习</h3>
                  <p>考纲、概念、公式、易错点与优先级。</p>
                  <ul>
                    <li v-for="item in reviewOutline" :key="item">{{ item }}</li>
                  </ul>
                  <span class="stage-bind__page">共 16 页</span>
                </div>
                <div class="stage-bind__sheet stage-bind__sheet--exam">
                  <BindingThread :holes="['18%', '82%']" />
                  <span class="stage-bind__label">产出 02</span>
                  <h3>期末模拟考试</h3>
                  <p>选择、填空、简答、综合，答案独立成册。</p>
                  <ul>
                    <li v-for="item in examOutline" :key="item">{{ item }}</li>
                  </ul>
                  <span class="stage-bind__page">答案单独装订</span>
                </div>
                <StampMark class="stage-bind__stamp" text="两份成品" :rotate="-6" :delay="0.5" />
              </div>
            </Transition>
          </div>

          <footer class="process-stage__foot">
            <span>输入 · {{ activeStep.input }}</span>
            <span>产出 · {{ activeStep.output }}</span>
          </footer>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.process__layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: clamp(24px, 4vw, 56px);
  align-items: start;
}

.process__tabs {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.process__tab {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 0.2rem 0.6rem;
  padding: 1rem 0.9rem 1rem 0;
  text-align: left;
  border-left: 2px solid transparent;
  transition:
    border-color var(--e-dur-1) ease,
    color var(--e-dur-1) ease;
}

.process__tab:hover {
  border-left-color: var(--e-line-strong);
}

.process__tab.is-active {
  border-left-color: var(--e-pen);
}

.process__tab-index {
  grid-row: 1 / span 2;
  padding-top: 0.25rem;
  color: var(--e-faint);
  font-family: var(--e-font-mono);
  font-size: 0.75rem;
}

.process__tab.is-active .process__tab-index {
  color: var(--e-pen);
}

.process__tab-title {
  color: var(--e-muted);
  font-family: var(--e-font-serif);
  font-size: 1.2rem;
  font-weight: 700;
}

.process__tab.is-active .process__tab-title {
  color: var(--e-ink);
}

.process__tab-desc {
  color: var(--e-muted);
  font-size: 0.8125rem;
  line-height: 1.55;
}

.process-stage {
  display: flex;
  flex-direction: column;
  min-height: 480px;
}

.process-stage__head,
.process-stage__foot {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1.4rem;
  color: var(--e-muted);
  font-family: var(--e-font-mono);
  font-size: 0.75rem;
}

.process-stage__head {
  border-bottom: 1px solid var(--e-line);
}

.process-stage__foot {
  margin-top: auto;
  border-top: 1px solid var(--e-line);
}

.process-stage__body {
  flex: 1;
  padding: clamp(1.3rem, 2.6vw, 2rem);
}

.stage-split {
  position: relative;
  min-height: 360px;
}

.stage-split__file {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.7rem;
  border-bottom: 1px solid var(--e-line);
}

.stage-split__tab {
  display: inline-block;
  padding: 0.35rem 0.7rem;
  border: 1px solid var(--e-line-strong);
  border-bottom: 0;
  color: var(--e-ink);
  font-family: var(--e-font-mono);
  font-size: 0.8125rem;
}

.stage-split__meta {
  color: var(--e-muted);
  font-family: var(--e-font-mono);
  font-size: 0.75rem;
}

.stage-split__code {
  margin: 0.9rem 0 0;
  padding: 0 4.5rem 0 0;
  overflow: hidden;
  color: var(--e-ink-2);
  font-family: var(--e-font-mono);
  font-size: clamp(0.78rem, 1.05vw, 0.875rem);
  line-height: 2;
  white-space: pre-wrap;
}

.stage-split__bracket {
  position: absolute;
  right: 0.2rem;
  top: 4.2rem;
  bottom: 2.4rem;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 4.4rem;
  padding-left: 0.7rem;
  border-left: 1px solid var(--e-pen);
  color: var(--e-pen);
  font-family: var(--e-font-mono);
  font-size: 0.6875rem;
  white-space: nowrap;
}

.stage-split__bracket::before,
.stage-split__bracket::after {
  content: '';
  position: absolute;
  left: -1px;
  width: 0.55rem;
  height: 1px;
  background: var(--e-pen);
}

.stage-split__bracket::before {
  top: 0;
}

.stage-split__bracket::after {
  bottom: 0;
}

.stage-split__tip {
  margin: 1rem 0 0;
  color: var(--e-muted);
  font-size: 0.8125rem;
}

.stage-mark {
  position: relative;
  min-height: 360px;
}

.stage-mark__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.7rem;
  border-bottom: 1px solid var(--e-line);
  color: var(--e-muted);
  font-family: var(--e-font-mono);
  font-size: 0.75rem;
}

.stage-mark__title {
  margin: 1.1rem 0 0;
  font-family: var(--e-font-serif);
  font-size: clamp(1.4rem, 2.1vw, 1.8rem);
}

.stage-mark__formula {
  position: relative;
  margin: 0.8rem 0 0.4rem;
  padding-right: 6rem;
  overflow-x: auto;
  overflow-y: hidden;
  font-size: clamp(0.95rem, 1.3vw, 1.18rem);
}

.stage-mark__circle {
  left: -14px;
  top: -12px;
  width: calc(100% + 28px);
  height: calc(100% + 24px);
}

.stage-mark__underline {
  left: 0;
  bottom: -6px;
  width: 68%;
  height: 12px;
  opacity: 0.7;
}

.stage-mark__note {
  position: absolute;
  right: 0;
  top: 7.2rem;
  width: 5.4rem;
  color: var(--e-pen);
  font-family: var(--e-font-hand);
  font-size: 1.1rem;
  transform: rotate(-3deg);
}

.stage-mark__arrow {
  left: -28px;
  top: -18px;
  width: 34px;
  height: 28px;
  transform: scaleX(-1);
}

.stage-mark__points {
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--e-line);
}

.stage-mark__points li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--e-line);
  color: var(--e-ink-2);
  font-size: 0.875rem;
}

.stage-mark__points svg {
  width: 15px;
  height: 15px;
  color: var(--e-pen);
  flex-shrink: 0;
}

.stage-mark__strike {
  display: inline-block;
  margin: 1rem 0 0;
  color: var(--e-muted);
  font-size: 0.875rem;
  text-decoration: line-through;
  text-decoration-color: var(--e-pen);
  text-decoration-thickness: 2px;
}

.stage-bind {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: clamp(1rem, 2vw, 1.6rem);
  min-height: 360px;
  align-items: start;
}

.stage-bind__sheet {
  position: relative;
  padding: 1.5rem 1.2rem 1.1rem 2.6rem;
  border: 1px solid var(--e-line);
  background: var(--e-sheet-deep);
}

.stage-bind__sheet:nth-child(2) {
  transform: translateY(1.2rem) rotate(0.8deg);
}

.stage-bind__sheet--exam {
  transform: translateY(1.2rem) rotate(0.8deg);
}

.stage-bind__label {
  color: var(--e-pen);
  font-family: var(--e-font-mono);
  font-size: 0.7rem;
}

.stage-bind__sheet h3 {
  margin: 0.35rem 0 0;
  font-family: var(--e-font-serif);
  font-size: clamp(1.1rem, 1.6vw, 1.35rem);
}

.stage-bind__sheet p {
  margin: 0.35rem 0 0.9rem;
  color: var(--e-muted);
  font-size: 0.8125rem;
  line-height: 1.6;
}

.stage-bind__sheet ul {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--e-line);
}

.stage-bind__sheet li {
  padding: 0.36rem 0;
  border-bottom: 1px solid var(--e-line);
  color: var(--e-ink-2);
  font-size: 0.8125rem;
}

.stage-bind__page {
  display: block;
  margin-top: 0.8rem;
  color: var(--e-faint);
  font-family: var(--e-font-mono);
  font-size: 0.7rem;
}

.stage-bind__stamp {
  position: absolute;
  right: 0.5rem;
  bottom: -0.5rem;
}

@media (max-width: 920px) {
  .process__layout {
    grid-template-columns: 1fr;
  }

  .process__tabs {
    flex-direction: row;
    overflow-x: auto;
    padding-bottom: 0.4rem;
    scroll-snap-type: x mandatory;
  }

  .process__tab {
    flex: 0 0 min(78vw, 280px);
    scroll-snap-align: start;
    border-left: 0;
    border-top: 2px solid var(--e-line);
    padding: 0.8rem 0.8rem 0.8rem 0;
  }

  .process__tab.is-active {
    border-top-color: var(--e-pen);
    border-left-color: transparent;
  }

  .process-stage {
    min-height: 0;
  }
}

@media (max-width: 680px) {
  .process-stage__body {
    padding: 1rem;
  }

  .stage-split__code {
    padding-right: 3.4rem;
  }

  .stage-split__bracket {
    width: 3.4rem;
    font-size: 0.625rem;
  }

  .stage-mark__formula {
    padding-right: 0;
  }

  .stage-mark__note {
    position: static;
    margin-top: 0.8rem;
    transform: rotate(-2deg);
  }

  .stage-mark__arrow {
    display: none;
  }

  .stage-bind {
    grid-template-columns: 1fr;
  }

  .stage-bind__sheet:nth-child(2),
  .stage-bind__sheet--exam {
    transform: none;
  }

  .stage-bind__stamp {
    position: static;
    justify-self: end;
    margin-top: 0.4rem;
  }
}
</style>
