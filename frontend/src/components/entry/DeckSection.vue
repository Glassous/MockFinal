<script setup lang="ts">
import { computed, ref } from 'vue'
import { samplePages } from '@/lib/entrySample'
import BindingThread from './BindingThread.vue'
import PenCheck from './PenCheck.vue'
import PenUnderline from './PenUnderline.vue'
import TexBlock from './TexBlock.vue'

const activeId = ref('example')
const activePage = computed(() => samplePages.find((page) => page.id === activeId.value)!)
const checkedPoints = computed(() => {
  const done = activePage.value.points.filter((point) => point.done).length
  return { done, total: activePage.value.points.length }
})

function select(id: string) {
  activeId.value = id
}

function onTabKeydown(event: KeyboardEvent, index: number) {
  let next = index
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    next = (index + 1) % samplePages.length
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    next = (index - 1 + samplePages.length) % samplePages.length
  } else if (event.key === 'Home') {
    next = 0
  } else if (event.key === 'End') {
    next = samplePages.length - 1
  } else {
    return
  }
  event.preventDefault()
  select(samplePages[next].id)
  document.getElementById('deck-tab-' + samplePages[next].id)?.focus()
}
</script>

<template>
  <section id="pages" class="e-section deck-section">
    <div class="e-container">
      <div class="e-section-head">
        <div>
          <p class="e-folio">03 / 翻页</p>
          <h2 class="e-h2">一页，就讲清一件事。</h2>
        </div>
        <div class="e-section-head__aside">
          <p class="e-body">
            目标、讲解、例题、检查都在同一页；读完打勾，下一页接着走。右侧页签可以随时翻回任何一页。
          </p>
        </div>
      </div>

      <div class="deck">
        <div class="deck__tabs" role="tablist" aria-label="讲义页签" aria-orientation="vertical">
          <button
            v-for="(page, index) in samplePages"
            :id="'deck-tab-' + page.id"
            :key="page.id"
            type="button"
            role="tab"
            class="deck__tab"
            :class="{ 'is-active': activeId === page.id }"
            :aria-selected="activeId === page.id"
            aria-controls="deck-page"
            :tabindex="activeId === page.id ? 0 : -1"
            @click="select(page.id)"
            @keydown="onTabKeydown($event, index)"
          >
            <span class="deck__tab-no">{{ page.pageNo }}</span>
            <span class="deck__tab-role">{{ page.role }}</span>
          </button>
        </div>

        <article
          id="deck-page"
          class="deck-page e-sheet e-animate is-drawn"
          role="tabpanel"
          :aria-labelledby="'deck-tab-' + activeId"
        >
          <BindingThread />
          <header class="deck-page__head">
            <span>复变函数 · 第 3 讲</span>
            <span>第 {{ activePage.pageNo }} 页 / 共 16 页</span>
          </header>

          <div class="deck-page__body">
            <Transition name="e-slide" mode="out-in">
              <div :key="activePage.id" class="deck-page__content">
                <div class="deck-page__main">
                  <p class="deck-page__eyebrow">期末终极复习 · {{ activePage.role }}</p>
                  <h3 class="deck-page__title">{{ activePage.title }}</h3>
                  <p class="deck-page__lede">{{ activePage.lede }}</p>

                  <div v-if="activePage.formula" class="deck-page__formula">
                    <TexBlock :tex="activePage.formula" display />
                    <PenUnderline class="deck-page__underline" />
                  </div>

                  <ol class="deck-page__steps">
                    <li
                      v-for="(point, index) in activePage.points"
                      :key="point.title"
                      :class="{ 'is-done': point.done }"
                    >
                      <span class="deck-page__step-no">0{{ index + 1 }}</span>
                      <span>
                        <b>{{ point.title }}</b>{{ point.text }}
                        <PenCheck v-if="point.done" class="step-check" />
                      </span>
                    </li>
                  </ol>

                  <p class="deck-page__takeaway">{{ activePage.takeaway }}</p>
                </div>

                <aside class="deck-page__margin">
                  <span class="e-hand deck-page__note">{{ activePage.note }}</span>
                  <span class="e-check deck-page__margin-check">
                    <PenCheck /> 本页检查 {{ checkedPoints.done }}/{{ checkedPoints.total }}
                  </span>
                </aside>
              </div>
            </Transition>

            <footer class="deck-page__foot">
              <span>示例内容 · 复变函数</span>
              <span>MockFinal · 讲义</span>
            </footer>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.deck {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 118px;
  grid-template-areas: 'page tabs';
  gap: clamp(18px, 3vw, 36px);
  align-items: start;
}

.deck__tabs {
  grid-area: tabs;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding-top: 1.2rem;
}

.deck__tab {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--e-line);
  border-left: 2px solid transparent;
  text-align: left;
  transition:
    border-color var(--e-dur-1) ease,
    background-color var(--e-dur-1) ease,
    color var(--e-dur-1) ease;
}

.deck__tab:hover {
  border-color: var(--e-line-strong);
}

.deck__tab.is-active {
  border-color: var(--e-line-strong);
  border-left-color: var(--e-pen);
  background: var(--e-sheet);
}

.deck__tab-no {
  color: var(--e-faint);
  font-family: var(--e-font-mono);
  font-size: 0.7rem;
}

.deck__tab-role {
  color: var(--e-muted);
  font-family: var(--e-font-serif);
  font-size: 1rem;
  font-weight: 700;
}

.deck__tab.is-active .deck__tab-no,
.deck__tab.is-active .deck__tab-role {
  color: var(--e-pen);
}

.deck-page {
  grid-area: page;
  min-height: 520px;
  display: flex;
  flex-direction: column;
}

.deck-page__head {
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

.deck-page__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: 1.6rem 2rem 1.3rem 3.4rem;
}

.deck-page__content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 190px;
  gap: clamp(1.2rem, 2.6vw, 2.4rem);
  flex: 1;
}

.deck-page__main {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.deck-page__margin {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-left: 1.1rem;
  border-left: 1px solid var(--e-pen-line);
}

.deck-page__note {
  display: block;
  font-size: 1.15rem;
  line-height: 1.4;
  transform: rotate(-2deg);
}

.deck-page__takeaway {
  margin: auto 0 0;
  padding-top: 1.2rem;
  border-top: 1px solid var(--e-line);
  color: var(--e-ink);
  font-family: var(--e-font-serif);
  font-size: clamp(1.2rem, 1.8vw, 1.5rem);
  line-height: 1.5;
  text-wrap: balance;
}

.deck-page__takeaway::before {
  content: '“';
  margin-right: 0.15rem;
  color: var(--e-pen);
}

.deck-page__margin-check {
  margin-top: auto;
  font-size: 0.75rem;
  line-height: 1.5;
}

.step-check {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-left: 0.3rem;
  color: var(--e-pen);
  vertical-align: -1px;
}

.deck-page__eyebrow {
  margin: 0;
  color: var(--e-pen);
  font-size: 0.8125rem;
  font-weight: 600;
}

.deck-page__title {
  margin: 0.35rem 0 0;
  max-width: 34rem;
  font-family: var(--e-font-serif);
  font-size: clamp(1.5rem, 2.3vw, 1.9rem);
  line-height: 1.3;
  text-wrap: balance;
}

.deck-page__lede {
  margin: 0.6rem 0 0;
  max-width: 36rem;
  color: var(--e-muted);
  font-size: 0.9375rem;
  line-height: 1.75;
}

.deck-page__formula {
  position: relative;
  margin: 1.15rem 0 0.9rem;
  padding: 0.7rem 0;
  overflow-x: auto;
  overflow-y: hidden;
  font-size: clamp(1rem, 1.4vw, 1.25rem);
}

.deck-page__underline {
  left: 0;
  bottom: -4px;
  width: 62%;
  height: 12px;
  opacity: 0.7;
}

.deck-page__steps {
  margin: 0.4rem 0 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--e-line);
}

.deck-page__steps li {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 0.6rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--e-line);
  color: var(--e-ink-2);
  font-size: 0.9rem;
  line-height: 1.65;
}

.deck-page__steps b {
  margin-right: 0.4rem;
  color: var(--e-ink);
  font-weight: 600;
}

.deck-page__step-no {
  padding-top: 0.08rem;
  color: var(--e-faint);
  font-family: var(--e-font-mono);
  font-size: 0.7rem;
}

.deck-page__steps li.is-done .deck-page__step-no {
  color: var(--e-pen);
}

.deck-page__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1.2rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--e-line);
  color: var(--e-muted);
  font-size: 0.75rem;
}

@media (max-width: 840px) {
  .deck {
    grid-template-columns: 1fr;
    grid-template-areas:
      'tabs'
      'page';
  }

  .deck-page__content {
    grid-template-columns: 1fr;
  }

  .deck-page__margin {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem 1.4rem;
    padding: 0.9rem 0 0;
    border-left: 0;
    border-top: 1px solid var(--e-pen-line);
  }

  .deck-page__margin-check {
    margin-top: 0;
    margin-left: auto;
  }

  .deck__tabs {
    flex-direction: row;
    overflow-x: auto;
    padding: 0 0 0.4rem;
    scroll-snap-type: x mandatory;
  }

  .deck__tab {
    flex: 0 0 auto;
    scroll-snap-align: start;
    border-left: 1px solid var(--e-line);
    border-top: 2px solid transparent;
  }

  .deck__tab.is-active {
    border-left-color: var(--e-line-strong);
    border-top-color: var(--e-pen);
  }
}

@media (max-width: 640px) {
  .deck-page__head {
    padding: 0.8rem 1rem 0.8rem 2.4rem;
  }

  .deck-page__body {
    padding: 1.1rem 1rem 1.1rem 2.4rem;
  }

  .deck-page__foot {
    flex-wrap: wrap;
  }
}
</style>
