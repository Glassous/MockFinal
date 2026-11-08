<script setup lang="ts">
import { computed } from 'vue'
import { Check, Loader2, X } from 'lucide-vue-next'
import type { DeckJob } from '@/types'
import { BUILD_STAGES, buildStageIndex } from '@/lib/deck'

const props = defineProps<{ job: DeckJob | null }>()

const stageIndex = computed(() => buildStageIndex(props.job))
const failed = computed(() => props.job?.status === 'failed')
const canceled = computed(() => props.job?.status === 'canceled')
</script>

<template>
  <div>
    <div class="flex items-center gap-1 overflow-x-auto">
      <div
        v-for="(stage, index) in BUILD_STAGES"
        :key="stage"
        class="flex min-w-0 flex-1 items-center gap-1"
      >
        <div class="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold"
            :class="[
              index < stageIndex
                ? 'border-transparent bg-invert text-invert-ink'
                : index === stageIndex
                  ? failed
                    ? 'border-border-strong bg-panel text-ink'
                    : 'border-border-strong bg-raised text-ink'
                  : 'border-border bg-panel text-faint',
            ]"
          >
            <X v-if="failed && index === stageIndex" class="h-3.5 w-3.5" />
            <Loader2
              v-else-if="index === stageIndex && job && !['done', 'partial', 'failed', 'canceled'].includes(job.status)"
              class="h-3.5 w-3.5 spin"
            />
            <Check v-else-if="index < stageIndex" class="h-3.5 w-3.5" />
            <template v-else>{{ index + 1 }}</template>
          </span>
          <span
            class="truncate text-[11px] font-medium"
            :class="index <= stageIndex ? 'text-ink' : 'text-faint'"
          >
            {{ stage }}
          </span>
        </div>
        <span
          v-if="index < BUILD_STAGES.length - 1"
          class="h-px w-3 shrink-0"
          :class="index < stageIndex ? 'bg-invert' : 'bg-border'"
          aria-hidden="true"
        />
      </div>
    </div>
    <p v-if="canceled" class="mt-2 text-xs text-muted">任务已取消，已完成的页面仍可阅读。</p>
  </div>
</template>