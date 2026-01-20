<template>
  <div class="qty-slider">
    <div class="top text-black">
      <span class="label">Quantity</span>
      <span class="value">{{ qty }}</span>
    </div>

    <Slider v-model="qty" :min="min" :max="max" :step="step" class="w-full" />

    <!-- Optional: quick precision buttons (recommended) -->
    <div class="actions">
      <Button icon="pi pi-minus" outlined @click="qty = clamp(qty - step)" />
      <div class="range">{{ min }} – {{ max }}</div>
      <Button icon="pi pi-plus" outlined @click="qty = clamp(qty + step)" />
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import Slider from "primevue/slider";
import Button from "primevue/button";

const min = 1;
const max = 100;   // change to what you need (slider is best for small ranges)
const step = 1;

const qty = ref(1);

const clamp = (n) => Math.max(min, Math.min(max, n));
</script>

<style scoped>
.qty-slider {
  max-width: 420px;
  padding: 12px;
  border-radius: 16px;
}

.top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}
.label { font-size: 14px; opacity: 0.8; }
.value { font-size: 22px; font-weight: 600; }

.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  gap: 10px;
}

.range {
  font-size: 12px;
  opacity: 0.7;
}
</style>
