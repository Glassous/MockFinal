<script setup lang="ts">
import { RouterView } from 'vue-router'
import ToastHost from '@/components/ToastHost.vue'
</script>

<template>
  <RouterView v-slot="{ Component }">
    <transition name="page" mode="out-in">
      <component :is="Component" />
    </transition>
  </RouterView>
  <ToastHost />
</template>

<style scoped>
.page-enter-active,
.page-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.page-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.page-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
