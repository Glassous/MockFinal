<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import StampMark from './StampMark.vue'

const router = useRouter()
const auth = useAuthStore()
const drawn = ref(false)

onMounted(() => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      drawn.value = true
    })
  })
})

function start() {
  router.push(auth.isAuthenticated ? { name: 'home' } : { name: 'login' })
}
</script>

<template>
  <section id="start" class="e-section closing">
    <div class="e-container">
      <div class="closing__stack">
        <span class="closing__paper closing__paper--back" aria-hidden="true" />
        <span class="closing__paper closing__paper--mid" aria-hidden="true" />

        <div class="closing__sheet e-sheet e-animate" :class="{ 'is-drawn': drawn }">
          <svg
            class="closing__knot"
            viewBox="0 0 560 96"
            fill="none"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              class="e-draw"
              d="M0 54 C 96 50, 126 26, 154 34 C 182 42, 172 74, 144 72 C 116 70, 122 32, 170 30 C 218 28, 250 54, 316 54 C 386 54, 440 50, 560 54"
              pathLength="1"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              vector-effect="non-scaling-stroke"
            />
            <path
              class="e-draw e-delay-1"
              d="M154 34 C 128 12, 96 12, 82 28"
              pathLength="1"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              vector-effect="non-scaling-stroke"
            />
            <path
              class="e-draw e-delay-1"
              d="M144 72 C 118 94, 88 92, 74 76"
              pathLength="1"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              vector-effect="non-scaling-stroke"
            />
          </svg>

          <div class="closing__body">
            <p class="e-folio">05 / 开始</p>
            <h2 class="e-h2">把你的资料，放进来。</h2>
            <p class="e-body">
              新建一个工作区，上传 .md / .txt 资料；剩下的交给 MockFinal。
            </p>
            <ol class="closing__steps">
              <li><span class="closing__step-no">01</span>登录或注册</li>
              <li><span class="closing__step-no">02</span>新建工作区</li>
              <li><span class="closing__step-no">03</span>上传资料</li>
            </ol>
            <div class="closing__actions">
              <button type="button" class="e-btn e-btn--pen" @click="start">登录开始</button>
              <router-link
                v-if="!auth.isAuthenticated"
                :to="{ name: 'register' }"
                class="e-btn e-btn--line"
              >
                注册账号
              </router-link>
              <router-link v-else :to="{ name: 'home' }" class="e-btn e-btn--line">
                进入工作区
              </router-link>
            </div>
            <p class="closing__note">资料仅支持 .md / .txt · 单文件 ≤ 8 MiB</p>
          </div>

          <StampMark class="closing__stamp" text="开始复习" :rotate="-6" :delay="0.6" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.closing {
  padding-bottom: clamp(80px, 10vw, 140px);
}

.closing__stack {
  position: relative;
  max-width: 820px;
  margin: 0 auto;
  padding: 1.4rem;
}

.closing__paper {
  position: absolute;
  inset: 1.4rem;
  display: block;
  border: 1px solid var(--e-line);
  background: var(--e-sheet-deep);
  border-radius: 2px;
}

.closing__paper--back {
  transform: rotate(-1.6deg) translate(-0.8rem, 0.9rem);
  opacity: 0.7;
}

.closing__paper--mid {
  transform: rotate(0.9deg) translate(0.6rem, -0.4rem);
  opacity: 0.85;
}

.closing__sheet {
  position: relative;
  padding-top: 5.2rem;
  overflow: hidden;
}

.closing__knot {
  position: absolute;
  top: 0.8rem;
  left: 0;
  width: 100%;
  height: 96px;
  color: var(--e-pen);
}

.closing__body {
  padding: 0 clamp(1.4rem, 4vw, 3.2rem) 2.4rem;
}

.closing__body .e-h2 {
  max-width: 12em;
  margin: 0.6rem 0 0;
}

.closing__body .e-body {
  max-width: 32rem;
  margin: 0.9rem 0 0;
}

.closing__steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  max-width: 32rem;
  margin: 1.7rem 0 0;
  padding: 0;
  list-style: none;
}

.closing__steps li {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--e-pen-line);
  color: var(--e-ink-2);
  font-size: 0.875rem;
}

.closing__step-no {
  color: var(--e-pen);
  font-family: var(--e-font-mono);
  font-size: 0.7rem;
}

.closing__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

.closing__note {
  margin: 1.4rem 0 0;
  color: var(--e-faint);
  font-family: var(--e-font-mono);
  font-size: 0.72rem;
}

.closing__stamp {
  position: absolute;
  right: clamp(1.2rem, 3vw, 2.4rem);
  bottom: 1.6rem;
}

@media (max-width: 640px) {
  .closing__stack {
    padding: 0.8rem;
  }

  .closing__paper {
    inset: 0.8rem;
  }

  .closing__sheet {
    padding-top: 4.2rem;
  }

  .closing__knot {
    height: 72px;
  }

  .closing__body {
    padding-inline: 1.3rem;
  }

  .closing__stamp {
    position: static;
    margin: 0 1.3rem 1.4rem auto;
    display: flex;
    width: fit-content;
  }
}
</style>
