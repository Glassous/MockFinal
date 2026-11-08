<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowRight,
  Check,
  CircleHelp,
  Lightbulb,
  ListChecks,
  Sparkles,
  X,
} from 'lucide-vue-next'
import type { PageManifest, TeachingCheck } from '@/types'
import DeckRoleBadge from './DeckRoleBadge.vue'
import MarkdownView from '@/components/MarkdownView.vue'

type Tab = 'page' | 'check' | 'sources' | 'ai'

const props = defineProps<{
  open: boolean
  manifest: PageManifest
  pageTitle: string
  completed: boolean
  canComplete?: boolean
  checkCount?: number | null
  minutes?: number | null
  score?: number | null
  suggestedQuestions?: string[]
}>()

const emit = defineEmits<{
  close: []
  focusBlock: [blockId: string]
  complete: []
  checked: []
  ask: [question: string]
}>()

const tab = ref<Tab>('page')
const answers = ref<Record<string, number>>({})

const teaching = computed(() => props.manifest.teaching)
const role = computed(() => teaching.value?.role ?? null)
const checks = computed<TeachingCheck[]>(() => teaching.value?.check ?? [])
const chain = computed(() => teaching.value?.chain ?? [])
const example = computed(() => teaching.value?.worked_example)
const summary = computed(() => teaching.value?.summary)
const refs = computed(() => props.manifest.source_refs ?? [])
const assistant = computed(() => props.manifest.assistant ?? {})
const hasTeaching = computed(() => Boolean(teaching.value))
const answeredCount = computed(() => Object.keys(answers.value).length)

watch(
  () => props.open,
  (open) => {
    if (open) {
      tab.value = hasTeaching.value ? 'page' : 'sources'
      answers.value = {}
    }
  },
)

watch(
  () => props.pageTitle,
  () => {
    answers.value = {}
  },
)

function selectAnswer(check: TeachingCheck, index: number) {
  if (answers.value[check.id] !== undefined) return
  answers.value = { ...answers.value, [check.id]: index }
  if (Object.keys(answers.value).length >= checks.value.length) emit('checked')
}

function resetChecks() {
  answers.value = {}
}

function answerState(check: TeachingCheck, index: number): string {
  const picked = answers.value[check.id]
  if (picked === undefined) {
    return 'border-border bg-panel text-ink hover:border-border-strong'
  }
  if (index === check.answer_index) return 'border-border-strong bg-raised text-ink'
  if (index === picked) return 'border-danger/50 bg-danger-soft text-ink'
  return 'border-border bg-panel text-muted opacity-70'
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <teleport to="body">
    <transition name="sheet">
      <div v-if="open" class="fixed inset-0 z-panel">
        <div class="absolute inset-0 bg-overlay/30 md:bg-transparent" @click="emit('close')" />
        <aside
          class="absolute inset-x-0 bottom-0 flex max-h-[86dvh] flex-col rounded-t-3xl border border-border bg-panel shadow-pop md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[390px] md:rounded-none md:border-y-0 md:border-r-0"
          role="dialog"
          aria-modal="true"
          aria-label="学习面板"
        >
          <header class="shrink-0 border-b border-border px-4 py-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-sm font-semibold text-ink">学习面板</h2>
                  <DeckRoleBadge
                    :role="role"
                    :checks="checkCount"
                    :minutes="minutes"
                    :score="score"
                  />
                </div>
                <p class="mt-0.5 truncate text-xs text-muted">{{ pageTitle }}</p>
              </div>
              <button
                type="button"
                class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-ink"
                aria-label="关闭学习面板"
                @click="emit('close')"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
            <div class="mt-3 flex gap-1 rounded-2xl bg-raised p-1" role="tablist">
              <button
                v-for="item in [
                  { key: 'page', label: '本页' },
                  { key: 'check', label: '检查' },
                  { key: 'sources', label: '依据' },
                  { key: 'ai', label: 'AI' },
                ]"
                :key="item.key"
                type="button"
                role="tab"
                :aria-selected="tab === item.key"
                class="flex-1 rounded-xl px-2 py-1.5 text-xs font-medium transition-colors"
                :class="tab === item.key ? 'bg-panel text-ink shadow-sm' : 'text-muted hover:text-ink'"
                @click="tab = item.key as Tab"
              >
                {{ item.label }}
              </button>
            </div>
          </header>

          <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <template v-if="tab === 'page'">
              <div v-if="!hasTeaching" class="rounded-2xl border border-border bg-raised px-3.5 py-3">
                <p class="text-sm font-medium text-ink">这是旧版页面，暂无教学目标</p>
                <p class="mt-1 text-xs leading-relaxed text-muted">
                  仍可查看来源依据，或直接向 AI 助手提问。
                </p>
              </div>
              <template v-else>
                <p
                  v-if="teaching?.hook"
                  class="rounded-2xl border border-border bg-raised px-3.5 py-3 text-sm leading-relaxed text-ink"
                >
                  {{ teaching.hook }}
                </p>

                <section v-if="teaching?.objectives?.length" class="mt-4">
                  <h3 class="flex items-center gap-1.5 text-xs font-semibold text-ink">
                    <Lightbulb class="h-3.5 w-3.5 text-muted" />
                    学习目标
                  </h3>
                  <ul class="mt-2 space-y-1.5">
                    <li
                      v-for="objective in teaching.objectives"
                      :key="objective"
                      class="flex items-start gap-2 text-sm leading-relaxed text-ink"
                    >
                      <span
                        class="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border text-[11px] text-muted"
                        aria-hidden="true"
                      >
                        <Check class="h-2.5 w-2.5" />
                      </span>
                      <span>{{ objective }}</span>
                    </li>
                  </ul>
                </section>

                <section v-if="teaching?.prerequisites?.length" class="mt-4">
                  <h3 class="text-xs font-semibold text-ink">前置知识</h3>
                  <p class="mt-1.5 text-sm leading-relaxed text-muted">
                    {{ teaching.prerequisites.join('；') }}
                  </p>
                </section>

                <section v-if="chain.length" class="mt-4">
                  <h3 class="text-xs font-semibold text-ink">讲解路线</h3>
                  <div class="mt-2 space-y-1.5">
                    <button
                      v-for="(step, index) in chain"
                      :key="step.id"
                      type="button"
                      class="flex w-full items-center gap-2 rounded-xl border border-border bg-panel px-3 py-2 text-left text-sm text-ink transition-colors hover:border-border-strong hover:bg-raised"
                      @click="emit('focusBlock', step.block_id)"
                    >
                      <span class="text-[11px] font-bold tabular-nums text-faint">
                        {{ String(index + 1).padStart(2, '0') }}
                      </span>
                      <span class="min-w-0 flex-1">{{ step.title }}</span>
                      <ArrowRight class="h-3.5 w-3.5 shrink-0 text-faint" />
                    </button>
                  </div>
                </section>

                <section v-if="example" class="mt-4">
                  <h3 class="text-xs font-semibold text-ink">例题</h3>
                  <p class="mt-1.5 text-sm font-medium leading-relaxed text-ink">
                    {{ example.problem }}
                  </p>
                  <ol class="mt-2 space-y-2">
                    <li
                      v-for="step in example.steps"
                      :key="step.id"
                      class="rounded-xl border border-border bg-panel px-3 py-2"
                    >
                      <p class="text-[11px] font-semibold text-muted">{{ step.title }}</p>
                      <MarkdownView :content="step.body" />
                    </li>
                  </ol>
                  <p class="mt-2 text-sm font-medium text-ink">答案：{{ example.answer }}</p>
                  <p v-if="example.common_error" class="mt-1 text-xs leading-relaxed text-muted">
                    常见错误：{{ example.common_error }}
                  </p>
                </section>

                <section v-if="summary" class="mt-4">
                  <h3 class="text-xs font-semibold text-ink">小结</h3>
                  <ul v-if="summary.key_points?.length" class="mt-1.5 space-y-1">
                    <li
                      v-for="point in summary.key_points"
                      :key="point"
                      class="flex gap-1.5 text-sm leading-relaxed text-muted"
                    >
                      <span class="text-faint">·</span>
                      <span>{{ point }}</span>
                    </li>
                  </ul>
                  <div v-if="summary.misconceptions?.length" class="mt-2 rounded-xl bg-raised px-3 py-2">
                    <p class="text-[11px] font-semibold text-muted">易错点</p>
                    <ul class="mt-1 space-y-1">
                      <li
                        v-for="item in summary.misconceptions"
                        :key="item"
                        class="text-xs leading-relaxed text-muted"
                      >
                        {{ item }}
                      </li>
                    </ul>
                  </div>
                  <p v-if="summary.next" class="mt-2 text-xs leading-relaxed text-muted">
                    下一页：{{ summary.next }}
                  </p>
                </section>
              </template>
            </template>

            <template v-else-if="tab === 'check'">
              <div v-if="!checks.length" class="text-sm text-muted">本页没有随堂检查。</div>
              <template v-else>
                <p class="text-xs text-muted">
                  作答后立即显示解析，不自动跳页。已完成 {{ answeredCount }} / {{ checks.length }}。
                </p>
                <section v-for="(check, index) in checks" :key="check.id" class="mt-4">
                  <h3 class="flex items-start gap-1.5 text-sm font-medium text-ink">
                    <CircleHelp class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
                    <span>{{ index + 1 }}. {{ check.question }}</span>
                  </h3>
                  <div class="mt-2 space-y-1.5">
                    <button
                      v-for="(option, optionIndex) in check.options"
                      :key="option"
                      type="button"
                      class="flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors"
                      :class="answerState(check, optionIndex)"
                      :disabled="answers[check.id] !== undefined"
                      @click="selectAnswer(check, optionIndex)"
                    >
                      <span class="text-[11px] font-bold tabular-nums text-faint">
                        {{ String.fromCharCode(65 + optionIndex) }}
                      </span>
                      <span class="min-w-0 flex-1">{{ option }}</span>
                      <Check
                        v-if="answers[check.id] !== undefined && optionIndex === check.answer_index"
                        class="h-3.5 w-3.5 shrink-0"
                      />
                    </button>
                  </div>
                  <div
                    v-if="answers[check.id] !== undefined"
                    class="mt-2 rounded-xl border border-border bg-raised px-3 py-2"
                  >
                    <p class="text-xs font-medium text-ink">
                      {{ answers[check.id] === check.answer_index ? '回答正确' : '再想一想' }}
                    </p>
                    <MarkdownView :content="check.explanation" />
                  </div>
                </section>
                <button
                  v-if="answeredCount > 0"
                  type="button"
                  class="mt-4 inline-flex h-9 items-center gap-1.5 rounded-2xl border border-border px-3 text-sm text-muted transition-colors hover:border-border-strong hover:text-ink"
                  @click="resetChecks"
                >
                  再做一次
                </button>
              </template>
            </template>

            <template v-else-if="tab === 'sources'">
              <div v-if="assistant.summary" class="rounded-2xl border border-border bg-raised px-3.5 py-3">
                <p class="text-[11px] font-semibold uppercase tracking-wider text-faint">页面摘要</p>
                <p class="mt-1.5 text-sm leading-relaxed text-ink">{{ assistant.summary }}</p>
                <ul v-if="assistant.key_facts?.length" class="mt-2 space-y-1">
                  <li
                    v-for="fact in assistant.key_facts"
                    :key="fact"
                    class="flex gap-1.5 text-xs leading-relaxed text-muted"
                  >
                    <span class="text-faint">·</span>
                    <span>{{ fact }}</span>
                  </li>
                </ul>
              </div>
              <div v-if="refs.length" class="mt-3 space-y-2.5">
                <div
                  v-for="(ref, index) in refs"
                  :key="`${ref.section_id}-${index}`"
                  class="rounded-2xl border border-border bg-panel px-3.5 py-3"
                >
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-[11px] font-semibold uppercase tracking-wider text-faint">
                      来源 {{ index + 1 }}
                    </span>
                    <span v-if="ref.heading" class="text-sm font-medium text-ink">{{ ref.heading }}</span>
                    <span
                      v-if="ref.unverified"
                      class="rounded-full border border-border-strong px-2 py-0.5 text-[11px] text-muted"
                    >
                      待核对
                    </span>
                  </div>
                  <blockquote
                    v-if="ref.quote"
                    class="mt-2 border-l-2 border-border-strong pl-2.5 text-sm leading-relaxed text-muted"
                  >
                    {{ ref.quote }}
                  </blockquote>
                </div>
              </div>
              <p v-else class="mt-3 text-sm text-muted">本页未引用资料段落。</p>
            </template>

            <template v-else>
              <div class="flex flex-col items-center px-2 py-6 text-center">
                <Sparkles class="h-6 w-6 text-faint" />
                <p class="mt-2 text-sm font-medium text-ink">页面 AI 助手</p>
                <p class="mt-1 text-xs leading-relaxed text-muted">
                  助手只依据当前页面、选中内容与来源段落回答。
                </p>
                <button
                  type="button"
                  class="mt-3 inline-flex h-9 items-center rounded-2xl bg-invert px-3.5 text-sm font-medium text-invert-ink transition-opacity hover:opacity-90"
                  @click="emit('ask', '')"
                >
                  打开 AI 助手
                </button>
              </div>
              <div v-if="suggestedQuestions?.length" class="mt-4">
                <p class="text-[11px] font-semibold uppercase tracking-wider text-faint">可以这样问</p>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <button
                    v-for="question in suggestedQuestions.slice(0, 5)"
                    :key="question"
                    type="button"
                    class="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-border-strong hover:text-ink"
                    @click="emit('ask', question)"
                  >
                    {{ question }}
                  </button>
                </div>
              </div>
            </template>
          </div>

          <footer class="shrink-0 border-t border-border px-4 py-3">
            <div v-if="completed" class="flex items-center justify-center gap-1.5 text-xs text-muted">
              <Check class="h-3.5 w-3.5" />
              已标记学完
            </div>
            <button
              v-else
              type="button"
              class="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-2xl bg-invert text-sm font-medium text-invert-ink transition-opacity disabled:opacity-45"
              :disabled="!canComplete"
              :title="canComplete ? '标记本页已学完' : '完成页面交互或随堂检查后即可标记'"
              @click="emit('complete')"
            >
              <ListChecks class="h-4 w-4" />
              学完本页
            </button>
            <p v-if="!completed && !canComplete" class="mt-1.5 text-center text-[11px] text-faint">
              完成页面交互或随堂检查后即可标记
            </p>
          </footer>
        </aside>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.18s ease;
}
.sheet-enter-active aside,
.sheet-leave-active aside {
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from aside,
.sheet-leave-to aside {
  transform: translateY(24px);
}
@media (min-width: 768px) {
  .sheet-enter-from aside,
  .sheet-leave-to aside {
    transform: translateX(24px);
  }
}
</style>
