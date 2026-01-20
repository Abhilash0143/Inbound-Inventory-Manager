<template>
  <header class="bg-gray-600 h-20 px-6 flex items-center justify-between">
    <!-- LEFT: Logo -->
    <div class="flex items-center">
      <img
        src="/compassco_ONLY_TEXT_WITH_BORDER_White.png"
        alt="Compassco logo"
        class="cursor-pointer h-8 sm:h-9 md:h-11 lg:h-12 w-auto"
      />
    </div>

    <!-- RIGHT: Home button -->
    <button
      type="button"
      class="mr-5 px-4 py-2 rounded-lg bg-gray-500 text-white text-sm hover:opacity-90 pi pi-home"
      @click="store.requestGoOperator()"
    >
      Home
    </button>
  </header>
</template>


<script lang="ts" setup>
import { useRouter } from 'vue-router'
import { useInboundStore } from '../../stores/inbound'
const store = useInboundStore()

const router = useRouter()

defineEmits<{
  (e: 'go-operator'): void
}>()

</script>

<style></style>
