<script setup lang="ts">
import { computed, ref } from 'vue'
import { sampleQuestion } from '@/lib/entrySample'
import PenCheck from './PenCheck.vue'
import PenCross from './PenCross.vue'
import StampMark from './StampMark.vue'
import TexBlock from './TexBlock.vue'

const picked = ref<string | null>(null)
const revealed = computed(() => picked.value !== null)
const isCorrect = computed(() => picked.value === sampleQuestion.answer)
const correctOption = computed(
  () => sampleQuestion.options.find((option) => option.id === sampleQuestion.answer)!,
)

function choose(id: string) {
  picked.value = id
}

function reset() {
  picked.value = null
}
</script>

<template>
  <section id="quiz" class="e-section quiz-section">
    <div class="e-container">
      <div class="e-section-head">
        <div>
          <p class="e-folio">04 / 试做</p>
          <h2 class="e-h2">模拟卷，先做一道。</h2>
        </div>
        <div class="e-section-head__aside">
          <p class="e-body">
            选项选完再看解析；题目与答案分开存放，不提前泄底。做完这一道，再去建自己的工作区。
          </p>
        </div>
      </div>

      <div class="quiz-layout">
        <aside class="quiz-aside">
          <p class="quiz-aside__hand e-hand">先做，<br />再看解析。</p>
          <p class="quiz-aside__text">答案单独装订，选完才显示解析。</p>
          <span class="quiz-aside__ref">复变函数 · 留数定理</span>
        </aside>

        <form class="quiz-sheet e-sheet e-animate is-drawn" @submit.prevent>
          <header class="quiz-sheet__head">
            <span>期末模拟考试 · 示例</span>
            <span>复变函数</span>
          </header>

          <div class="quiz-sheet__body">
            <StampMark class="quiz-sheet__stamp" text="示例" :rotate="6" :delay="0.2" />
            <p class="quiz-sheet__eyebrow">第三大题 · 15 分</p>
            <p class="quiz-sheet__stem">{{ sampleQuestion.stem }}</p>

            <div class="quiz-sheet__formula">
              <TexBlock :tex="sampleQuestion.stemFormula" display />
            </div>

            <fieldset class="quiz-options">
              <legend class="sr-only">选择答案</legend>
              <label
                v-for="option in sampleQuestion.options"
                :key="option.id"
                class="quiz-option"
                :class="{
                  'is-selected': picked === option.id,
                  'is-correct': revealed && option.id === sampleQuestion.answer,
                  'is-wrong': revealed && picked === option.id && option.id !== sampleQuestion.answer,
                }"
              >
                <input
                  type="radio"
                  name="sample-question"
                  :value="option.id"
                  :checked="picked === option.id"
                  @change="choose(option.id)"
                />
                <span class="quiz-option__marker">{{ option.label }}</span>
                <span class="quiz-option__text">{{ option.text }}</span>
                <span
                  v-if="revealed && option.id === sampleQuestion.answer"
                  class="quiz-option__state is-correct"
                >
                  <PenCheck />
                </span>
                <span
                  v-else-if="revealed && picked === option.id"
                  class="quiz-option__state is-wrong"
                >
                  <PenCross />
                </span>
              </label>
            </fieldset>

            <div v-if="revealed" class="quiz-result" aria-live="polite">
              <div class="quiz-result__head">
                <span class="quiz-result__mark" :class="isCorrect ? 'is-correct' : 'is-wrong'">
                  <PenCheck v-if="isCorrect" />
                  <PenCross v-else />
                </span>
                <p class="quiz-result__title">{{ isCorrect ? '答对了。' : '还差一步。' }}</p>
                <button type="button" class="e-link quiz-result__again" @click="reset">
                  再做一次
                </button>
              </div>
              <p class="quiz-result__text">{{ sampleQuestion.explanation }}</p>
              <p v-if="!isCorrect" class="quiz-result__answer">
                正确答案：{{ correctOption.label }}。{{ correctOption.text }}
              </p>
            </div>
          </div>

          <footer class="quiz-sheet__foot">
            <span>答案与解析独立存放</span>
            <span>MockFinal · 模拟卷</span>
          </footer>
        </form>
      </div>
    </div>
  </section>
</template>

<style scoped>
.quiz-layout {
  display: grid;
  grid-template-columns: minmax(180px, 0.62fr) minmax(0, 1.38fr);
  gap: clamp(24px, 5vw, 72px);
  align-items: start;
}

.quiz-aside {
  padding-top: 1.6rem;
}

.quiz-aside__hand {
  margin: 0;
  font-size: clamp(1.7rem, 2.6vw, 2.3rem);
  line-height: 1.3;
  transform: rotate(-3deg);
}

.quiz-aside__text {
  max-width: 16rem;
  margin: 1.3rem 0 0;
  color: var(--e-muted);
  font-size: 0.9375rem;
  line-height: 1.75;
}

.quiz-aside__ref {
  display: inline-block;
  margin-top: 2rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--e-pen-line);
  color: var(--e-muted);
  font-family: var(--e-font-mono);
  font-size: 0.72rem;
}

.quiz-sheet {
  min-height: 500px;
  display: flex;
  flex-direction: column;
}

.quiz-sheet__head,
.quiz-sheet__foot {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1.5rem;
  color: var(--e-muted);
  font-family: var(--e-font-mono);
  font-size: 0.75rem;
}

.quiz-sheet__head {
  border-bottom: 1px solid var(--e-line);
}

.quiz-sheet__foot {
  margin-top: auto;
  border-top: 1px solid var(--e-line);
}

.quiz-sheet__body {
  position: relative;
  flex: 1;
  padding: clamp(1.3rem, 2.6vw, 2.1rem) clamp(1.2rem, 3vw, 2.2rem);
}

.quiz-sheet__stamp {
  position: absolute;
  top: 1.1rem;
  right: 1.2rem;
  font-size: 0.95rem;
  padding: 0.35rem 0.6rem;
}

.quiz-sheet__eyebrow {
  margin: 0;
  color: var(--e-pen);
  font-family: var(--e-font-mono);
  font-size: 0.75rem;
}

.quiz-sheet__stem {
  margin: 0.6rem 0 0;
  max-width: 34rem;
  color: var(--e-ink);
  font-family: var(--e-font-serif);
  font-size: clamp(1.15rem, 1.75vw, 1.4rem);
  line-height: 1.5;
}

.quiz-sheet__formula {
  margin: 1rem 0 1.2rem;
  padding: 0.6rem 0;
  overflow-x: auto;
  overflow-y: hidden;
  font-size: clamp(0.98rem, 1.35vw, 1.2rem);
}

.quiz-options {
  margin: 0;
  padding: 0;
  border: 0;
  border-top: 1px solid var(--e-line);
}

.quiz-option {
  position: relative;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 0.2rem;
  border-bottom: 1px solid var(--e-line);
  cursor: pointer;
  transition:
    background-color var(--e-dur-1) ease,
    border-color var(--e-dur-1) ease;
}

.quiz-option:hover {
  background: var(--e-sheet-deep);
}

.quiz-option:has(input:focus-visible) {
  outline: 2px solid var(--e-pen);
  outline-offset: 2px;
}

.quiz-option input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.quiz-option__marker {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--e-line-strong);
  border-radius: 50%;
  color: var(--e-muted);
  font-family: var(--e-font-mono);
  font-size: 0.72rem;
  transition:
    border-color var(--e-dur-1) ease,
    color var(--e-dur-1) ease,
    background-color var(--e-dur-1) ease;
}

.quiz-option__text {
  color: var(--e-ink-2);
  font-size: 0.9375rem;
  line-height: 1.6;
}

.quiz-option.is-selected .quiz-option__marker {
  border-color: var(--e-pen);
  color: var(--e-pen);
}

.quiz-option.is-selected .quiz-option__text {
  color: var(--e-ink);
}

.quiz-option.is-correct .quiz-option__marker {
  border-color: var(--e-pen);
  background: var(--e-pen);
  color: var(--e-pen-ink);
}

.quiz-option.is-wrong .quiz-option__text {
  text-decoration: line-through;
  text-decoration-color: var(--e-pen);
  text-decoration-thickness: 1.5px;
}

.quiz-option__state {
  display: inline-grid;
  place-items: center;
  color: var(--e-pen);
}

.quiz-option__state svg {
  width: 22px;
  height: 22px;
}

.quiz-result {
  margin-top: 1.2rem;
  padding: 0.9rem 0 0.2rem 1rem;
  border-left: 2px solid var(--e-pen);
}

.quiz-result__head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.quiz-result__mark {
  display: inline-grid;
  place-items: center;
  color: var(--e-pen);
}

.quiz-result__mark svg {
  width: 22px;
  height: 22px;
}

.quiz-result__title {
  margin: 0;
  color: var(--e-ink);
  font-family: var(--e-font-serif);
  font-size: 1.15rem;
  font-weight: 700;
}

.quiz-result__again {
  margin-left: auto;
  font-size: 0.8125rem;
}

.quiz-result__text,
.quiz-result__answer {
  margin: 0.45rem 0 0;
  color: var(--e-muted);
  font-size: 0.875rem;
  line-height: 1.7;
}

.quiz-result__answer {
  color: var(--e-ink-2);
}

@media (max-width: 860px) {
  .quiz-layout {
    grid-template-columns: 1fr;
  }

  .quiz-aside {
    display: flex;
    align-items: baseline;
    gap: 1.2rem;
    padding-top: 0;
  }

  .quiz-aside__hand {
    font-size: 1.45rem;
    flex-shrink: 0;
  }

  .quiz-aside__hand br {
    display: none;
  }

  .quiz-aside__text {
    margin: 0;
    max-width: 22rem;
  }

  .quiz-aside__ref {
    display: none;
  }
}

@media (max-width: 560px) {
  .quiz-sheet__stamp {
    top: 0.8rem;
    right: 0.8rem;
  }

  .quiz-option {
    grid-template-columns: 28px minmax(0, 1fr) 22px;
    gap: 0.55rem;
  }

  .quiz-result__head {
    flex-wrap: wrap;
  }

  .quiz-result__again {
    margin-left: 0;
  }
}
</style>
