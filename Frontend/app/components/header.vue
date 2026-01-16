<template>
  <div class="bg-gray-600 h-20 flex items-center p-8">
    <img
      src="/compassco_ONLY_TEXT_WITH_BORDER_White.png"
      alt="compassco logo"
      class="cursor-pointer h-8 sm:h-9 md:h-11 lg:h-12 w-auto">
  </div>
</template>

<script lang="ts" setup>
import { useRouter } from 'vue-router'

const router = useRouter()

function home() {
  router.push('/')
}
</script>

<style>
</style>
