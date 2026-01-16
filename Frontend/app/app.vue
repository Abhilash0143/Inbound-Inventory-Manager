<template>
  <div class="min-h-screen bg-gray-100">
  <Toast position="top-right" />
  <ConfirmDialog />
  <Header />
  <NuxtPage />
  </div>
</template>

<script setup lang="ts">
import Toast from 'primevue/toast'
import ConfirmDialog from 'primevue/confirmdialog'
import Header from './components/header.vue';
</script>
