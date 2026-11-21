<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{ sections: { id: string; label: string }[] }>()

const active = ref(props.sections[0]?.id ?? '')
const progress = ref(0)
let observer: IntersectionObserver | null = null
let frame = 0

function updateProgress() {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight
  progress.value = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0
}

function onScroll() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    updateProgress()
  })
}

function go(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
}

onMounted(() => {
  updateProgress()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', updateProgress)

  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
      if (visible[0]) active.value = visible[0].target.id
    },
    { rootMargin: '-38% 0px -50% 0px', threshold: [0, 0.2, 0.5] },
  )

  for (const section of props.sections) {
    const el = document.getElementById(section.id)
    if (el) observer.observe(el)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', updateProgress)
  observer?.disconnect()
  if (frame) cancelAnimationFrame(frame)
})
</script>

<template>
  <nav class="e-rail" aria-label="章节导航">
    <span class="e-rail__line" aria-hidden="true">
      <span class="e-rail__fill" :style="{ transform: `scaleY(${progress})` }" />
    </span>
    <ul class="e-rail__list">
      <li v-for="section in sections" :key="section.id">
        <a
          :href="`#${section.id}`"
          :aria-current="active === section.id ? 'true' : undefined"
          @click.prevent="go(section.id)"
        >
          {{ section.label }}
        </a>
      </li>
    </ul>
  </nav>
</template>
