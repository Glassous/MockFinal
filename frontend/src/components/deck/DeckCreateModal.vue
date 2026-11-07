<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Deck, DeckStyle } from '@/types'
import { createDeck } from '@/api/decks'
import { ApiError } from '@/api/client'
import { defaultDeckStyle } from '@/lib/deck'
import { useToastStore } from '@/stores/toast'
import AppButton from '@/components/AppButton.vue'
import AppInput from '@/components/AppInput.vue'
import Modal from '@/components/Modal.vue'
import BuildSetupPanel from '@/components/deck/BuildSetupPanel.vue'

const props = defineProps<{
  open: boolean
  workspaceId: number
}>()

const emit = defineEmits<{
  close: []
  created: [deck: Deck]
}>()

const toast = useToastStore()
const title = ref('')
const style = ref<DeckStyle>(defaultDeckStyle())
const busy = ref(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    title.value = ''
    style.value = defaultDeckStyle()
    busy.value = false
  },
)

async function submit() {
  if (busy.value) return
  busy.value = true
  try {
    const deck = await createDeck(props.workspaceId, {
      title: title.value.trim() || undefined,
      style: style.value,
    })
    emit('created', deck)
  } catch (error) {
    toast.error(error instanceof ApiError ? error.detail : '创建复习页失败，请重试')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Modal
    :open="open"
    title="新建复习页"
    description="先确定风格与密度，创建后进入构建工作台启动生成。"
    size="lg"
    :close-on-overlay="!busy"
    @close="emit('close')"
  >
    <div class="space-y-5">
      <AppInput
        v-model="title"
        label="标题"
        placeholder="留空则使用「工作区名 · 复习页」"
        :maxlength="120"
        autocomplete="off"
      />
      <div class="border-t border-border pt-4">
        <BuildSetupPanel v-model="style" :show-submit="false" />
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <AppButton variant="secondary" :disabled="busy" @click="emit('close')">取消</AppButton>
        <AppButton :loading="busy" @click="submit">创建并继续</AppButton>
      </div>
    </template>
  </Modal>
</template>