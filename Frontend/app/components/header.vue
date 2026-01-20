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
  </header>
</template>


<script lang="ts" setup>
import { useInboundStore } from '../../stores/inbound'
const store = useInboundStore()


defineEmits<{
  (e: 'go-operator'): void
}>()

</script>

<style></style>
