<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useInboundStore } from '../../stores/inbound'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'

type Step = 'HOME' | 'NEW_PACKAGE' | 'SCAN' | 'CONFIRM'
const step = ref<Step>('HOME')

const store = useInboundStore()
const toast = useToast()
const confirm = useConfirm()

// inputs
const outerBoxInput = ref('')
const innerBoxInput = ref('')
const qtyInput = ref<number | null>(null)
const skuInput = ref('')
const serialInput = ref('')

// refs for focus
const outerEl = ref<HTMLInputElement | null>(null)
const innerEl = ref<HTMLInputElement | null>(null)
const qtyEl = ref<HTMLInputElement | null>(null)
const skuEl = ref<HTMLInputElement | null>(null)
const serialEl = ref<HTMLInputElement | null>(null)

const dateLabel = computed(() => store.session?.date ?? store.date)
const outerBoxLabel = computed(() => store.session?.outerBoxId ?? '')

// ✅ Toast watchers (replace all error boxes)
watch(
  () => store.error,
  (val) => {
    if (!val) return
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: val,
      life: 3000
    })
    store.error = '' // clear so it doesn't repeat
  }
)

watch(
  () => store.success,
  (val) => {
    if (!val) return
    toast.add({
      severity: 'success',
      summary: 'Success',
      detail: val,
      life: 2500
    })
    store.success = ''
  }
)

function goNewPackage() {
  step.value = 'NEW_PACKAGE'
  store.resetCurrentInnerbox()
  store.clearMessages()

  outerBoxInput.value = store.session?.outerBoxId ?? ''
  innerBoxInput.value = ''
  qtyInput.value = null
  skuInput.value = ''
  serialInput.value = ''

  nextTick(() => outerEl.value?.focus())
}

function goHome() {
  step.value = 'HOME'
  store.clearMessages()

  outerBoxInput.value = ''
  innerBoxInput.value = ''
  qtyInput.value = null
  skuInput.value = ''
  serialInput.value = ''
}

function resetNewPackageForm() {
  store.clearMessages()
  innerBoxInput.value = ''
  qtyInput.value = null
  skuInput.value = ''
  serialInput.value = ''
  nextTick(() => innerEl.value?.focus())
}

function onNewPackageNext() {
  store.clearMessages()

  store.startOrResumeOuterbox(outerBoxInput.value)
  store.beginInnerbox(innerBoxInput.value, qtyInput.value ?? 0)

  if (store.error) return

  step.value = 'SCAN'
  skuInput.value = ''
  serialInput.value = ''
  nextTick(() => skuEl.value?.focus())
}

function onSkuEnter() {
  const incoming = skuInput.value.trim()
  if (!incoming) return

  store.setSku(incoming)

  if (store.error) {
    nextTick(() => skuEl.value?.focus())
    return
  }

  // SKU accepted & locked → move to serial, keep SKU visible
  nextTick(() => serialEl.value?.focus())
}

function onSerialEnter() {
  const ok = store.addSerial(serialInput.value)

  if (!ok) {
    nextTick(() => serialEl.value?.focus())
    return
  }

  serialInput.value = ''
  skuInput.value = ''           
  nextTick(() => skuEl.value?.focus())
}


function resetCurrentInnerbox() {
  store.resetCurrentInnerbox()

  skuInput.value = ''
  serialInput.value = ''

  step.value = 'NEW_PACKAGE'
  innerBoxInput.value = ''
  qtyInput.value = null

  nextTick(() => innerEl.value?.focus())
}

// ✅ Confirm dialogs
function confirmResetCurrentInnerbox() {
  confirm.require({
    header: 'Confirm Reset',
    message: 'Are you sure you want to reset the current InnerBox?',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Yes, Reset',
    rejectLabel: 'Cancel',
    accept: () => {
      resetCurrentInnerbox()
      toast.add({
        severity: 'info',
        summary: 'Reset',
        detail: 'Current InnerBox reset.',
        life: 2000
      })
    }
  })
}

function confirmResetNewPackageForm() {
  confirm.require({
    header: 'Confirm Reset',
    message: 'Clear current innerbox fields (InnerBox ID & Quantity)?',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Yes, Clear',
    rejectLabel: 'Cancel',
    accept: () => resetNewPackageForm()
  })
}

function confirmResetOnConfirmPage() {
  confirm.require({
    header: 'Confirm Reset',
    message: 'Reset this InnerBox and go back to New Package?',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Yes, Reset',
    rejectLabel: 'Cancel',
    accept: () => resetCurrentInnerbox()
  })
}

function scanNext() {
  if (!store.canGoConfirm) return
  step.value = 'CONFIRM'
}

function confirmNextInnerbox() {
  const ok = store.confirmInnerbox()
  if (!ok) return

  step.value = 'NEW_PACKAGE'
  store.clearMessages()

  innerBoxInput.value = ''
  qtyInput.value = null
  skuInput.value = ''
  serialInput.value = ''

  nextTick(() => innerEl.value?.focus())
}

function confirmAndGoHome() {
  store.clearMessages()
  const ok = store.confirmInnerbox()
  if (!ok) return
  step.value = 'HOME'
}
</script>

<template>
  <title>Inbound Inventory</title>

  <div class="text-gray-900 w-full">
    <!-- HOME -->
    <div v-if="step === 'HOME'" class="h-[calc(100vh-96px)] px-4 flex items-center">
      <div class="mx-auto w-full max-w-md sm:max-w-3xl text-center">
        <div class="mb-6 sm:mb-10">
          <div class="font-semibold tracking-wide text-2xl sm:text-2xl md:text-[30px] pb-12">
            Inbound Inventory Tracking System
          </div>
        </div>

        <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-4 sm:gap-8">
          <button
            class="w-full sm:w-72 h-24 rounded-xl border border-gray-300 bg-white
                   shadow-md hover:shadow-xl hover:-translate-y-0.5 transition
                   flex items-center justify-center"
            @click="goNewPackage"
          >
            <span class="text-lg sm:text-base font-semibold tracking-wide">NEW PACKAGE</span>
          </button>

          <!-- <button
            class="w-full sm:w-72 h-24 rounded-xl border border-gray-300 bg-white
                   shadow-md hover:shadow-xl hover:-translate-y-0.5 transition
                   flex items-center justify-center"
            @click="() => {}"
          >
            <span class="text-lg sm:text-base font-semibold tracking-wide">DRAFTS</span>
          </button> -->
        </div>
      </div>
    </div>

    <!-- NEW PACKAGE -->
    <div v-if="step === 'NEW_PACKAGE'" class="px-4">
      <div class="mx-auto max-w-5xl">
        <div class="border-t border-gray-300 my-6" />

        <div class="relative py-4">
          <div class="mb-2 text-center text-xs border border-gray-700 p-2 md:absolute md:right-0 md:top-0 md:mb-0">
            Date: {{ dateLabel }}
          </div>

          <div class="text-center font-semibold tracking-wide text-[20px] mt-10">
            NEW PACKAGE
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-1 gap-4 md:gap-10 items-end justify-items-stretch md:justify-items-center py-6">
          <div class="w-full md:max-w-xs text-center">
            <div class="text-xs mb-2">Scan or Type the Outer Box ID</div>
            <input
              ref="outerEl"
              v-model="outerBoxInput"
              class="w-full border border-gray-700 px-3 py-2 text-center outline-none rounded-md bg-white"
              placeholder="Outer Box ID"
              @keydown.enter.prevent="innerEl?.focus()"
            />
          </div>

          <div class="w-full md:max-w-xs text-center">
            <div class="text-xs mb-2">Scan or Type the Inner Box ID</div>
            <input
              ref="innerEl"
              v-model="innerBoxInput"
              :disabled="!outerBoxInput.trim()"
              class="w-full border border-gray-700 px-3 py-2 text-center outline-none rounded-md bg-white"
              placeholder="Inner Box ID"
              @keydown.enter.prevent="qtyEl?.focus()"
            />
          </div>

          <div class="w-full md:max-w-[140px] text-center">
            <div class="text-xs mb-2">Product Quantity</div>
            <input
              ref="qtyEl"
              v-model.number="qtyInput"
              :disabled="!innerBoxInput.trim()"
              type="number"
              min="1"
              class="w-full border border-gray-700 px-3 py-2 text-center outline-none rounded-md bg-white"
              placeholder="0"
              @keydown.enter.prevent="onNewPackageNext"
            />
          </div>
        </div>

        <div class="flex flex-col sm:flex-row justify-center gap-3 sm:gap-6 py-6">
          <button class="w-full sm:w-28 rounded bg-gray-800 text-white py-2 text-sm hover:opacity-90" @click="onNewPackageNext">
            Next
          </button>

          <button class="w-full sm:w-28 rounded bg-orange-500 text-white py-2 text-sm hover:opacity-90" @click="confirmResetNewPackageForm">
            Reset
          </button>
        </div>

        <div class="border-t border-gray-300 my-6" />
      </div>
    </div>

    <!-- SCAN -->
    <div v-if="step === 'SCAN'" class="px-4">
      <div class="mx-auto max-w-5xl">
        <div class="border-t border-gray-300 my-6" />

        <div class="relative py-2 pb-2">
          <div class="text-sm font-semibold text-gray-500 underline">OuterBox ID: {{ outerBoxLabel }}</div>
          <div class="absolute right-0 top-0 border border-gray-700 px-3 py-1 text-xs">
            Date: {{ dateLabel }}
          </div>
        </div>

        <div class="text-center w-full">
          <div class="text-sm font-semibold mt-4">InnerBox ID : {{ store.current.innerBoxId }}</div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6 py-6">
          <div class="bg-white rounded-xl shadow-md p-4 text-center">
            <div class="text-[11px] text-gray-500 uppercase tracking-wide">Entered Quantity</div>
            <div class="mt-2 text-2xl sm:text-xl font-semibold text-[#004aad]">{{ store.current.expectedQty }}</div>
          </div>

          <div class="bg-white rounded-xl shadow-md p-4 text-center">
            <div class="text-[11px] text-gray-500 uppercase tracking-wide">Scanned Products</div>
            <div class="mt-2 text-2xl sm:text-xl font-semibold text-[#004aad]">{{ store.scannedProductsCurrent }}</div>
          </div>

          <div class="bg-white rounded-xl shadow-md p-4 text-center">
            <div class="text-[11px] text-gray-500 uppercase tracking-wide">Scanned Innerboxes</div>
            <div class="mt-2 text-2xl sm:text-xl font-semibold text-[#004aad]">{{ store.scannedInnerboxesCount }}</div>
          </div>

          <div class="bg-white rounded-xl shadow-md p-4 text-center">
            <div class="text-[11px] text-gray-500 uppercase tracking-wide">Total Quantity</div>
            <div class="mt-2 text-2xl sm:text-xl font-semibold text-[#004aad]">{{ store.allProductsCountIncludingCurrent }}</div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-10 items-start justify-items-stretch md:justify-items-center py-2">
          <div class="w-full md:max-w-xs text-left">
            <div class="text-xs mb-2">Product SKU</div>
            <input
              ref="skuEl"
              v-model="skuInput"
              class="w-full border border-gray-700 px-3 py-2 text-center outline-none text-sm rounded-md bg-white"
              placeholder="Scan/Type SKU"
              @keydown.enter.prevent="onSkuEnter"
            />
            <div v-if="store.current.sku" class="mt-1 text-[11px] text-gray-600">
              Locked SKU: <span class="font-semibold">{{ store.current.sku }}</span>
            </div>
          </div>

          <div class="w-full md:max-w-xs text-left">
            <div class="text-xs mb-2">Product Serial Number</div>
            <input
              ref="serialEl"
              v-model="serialInput"
              :disabled="!store.canScanSerial"
              class="w-full border border-gray-700 px-3 py-2 text-center outline-none text-sm rounded-md bg-white disabled:bg-gray-100 disabled:cursor-not-allowed"
              placeholder="Scan/Type Serial"
              @keydown.enter.prevent="onSerialEnter"
            />
          </div>

          <div class="w-full md:max-w-xs">
  <div class="text-xs mb-2 text-left">Scanned Products</div>

  <div class="border border-gray-200 p-2 h-28 overflow-auto text-xs rounded-lg">
    <div
      v-for="item in store.current.items"
      :key="item.serial"
      class="flex items-center justify-between border-b py-1"
    >
      <div class="flex flex-col">
        <span class="font-semibold">SKU: {{ item.sku }}</span>
        <span class="font-mono text-gray-600">SN: {{ item.serial }}</span>
      </div>

      <button
        class="text-[11px] underline"
        @click="store.removeSerial(item.serial)"
      >
        remove
      </button>
    </div>

    <div v-if="store.current.items.length === 0" class="text-gray-400 text-center py-6">
      No products yet
    </div>
  </div>
</div>

        </div>

        <div class="flex flex-col sm:flex-row justify-center gap-3 sm:gap-6 py-6">
          <button
            class="w-full sm:w-28 rounded py-2 text-sm text-white"
            :class="store.canGoConfirm ? 'bg-gray-800 hover:opacity-90' : 'bg-gray-400 cursor-not-allowed'"
            :disabled="!store.canGoConfirm"
            @click="scanNext"
          >
            Next
          </button>

          <button
            class="w-full sm:w-28 rounded bg-orange-500 text-white py-2 text-sm hover:opacity-90"
            @click="confirmResetCurrentInnerbox"
          >
            Reset
          </button>
        </div>

        <div class="border-t border-gray-300 my-6" />
      </div>
    </div>

    <!-- CONFIRM -->
    <div v-if="step === 'CONFIRM'" class="px-4">
      <div class="mx-auto max-w-5xl">
        <div class="border-t border-gray-300 my-6" />

        <div class="relative py-2">
          <div class="text-sm font-semibold text-gray-500">Outer Box ID: {{ outerBoxLabel }}</div>
          <div class="absolute right-0 top-0 border border-gray-700 px-3 py-1 text-xs">
            Date: {{ dateLabel }}
          </div>
        </div>

        <div class="text-center text-sm py-2">
          InnerBox ID : <span class="font-semibold">{{ store.current.innerBoxId }}</span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-2 gap-4 sm:gap-8 py-6">
          <div class="bg-white rounded-xl shadow-md px-4 py-5 text-center">
            <div class="text-xs text-gray-500">No of Products</div>
            <div class="mt-2 text-2xl font-semibold text-[#004aad]">{{ store.current.expectedQty }}</div>
          </div>

          <div class="bg-white rounded-xl shadow-md p-4 text-center">
            <div class="text-xs text-gray-500 tracking-wide">Scanned Products</div>
            <div class="mt-2 text-2xl font-semibold text-[#004aad]">{{ store.scannedProductsCurrent }}</div>
          </div>

          <div class="bg-white rounded-xl shadow-md px-4 py-5 text-center">
            <div class="text-xs text-gray-500">Scanned Innerboxes</div>
            <div class="mt-2 text-2xl font-semibold text-[#004aad]">{{ store.scannedInnerboxesCount }}</div>
          </div>

          <div class="bg-white rounded-xl shadow-md px-4 py-5 text-center">
            <div class="text-xs text-gray-500">All Products Count</div>
            <div class="mt-2 text-2xl font-semibold text-[#004aad]">{{ store.allProductsCountIncludingCurrent }}</div>
          </div>
        </div>

        <div class="text-center text-sm py-2">
          Verify & Confirm the products and Innerbox
        </div>

        <div class="flex flex-col sm:flex-row justify-center gap-3 sm:gap-6 py-6">
          <button
            class="w-full sm:w-28 rounded bg-orange-500 text-white py-2 text-sm hover:opacity-90"
            @click="confirmResetOnConfirmPage"
          >
            Reset
          </button>

          <button
            class="w-full sm:w-40 rounded bg-gray-800 text-white py-2 text-sm hover:opacity-90"
            @click="confirmNextInnerbox"
          >
            Next InnerBox
          </button>

          <button
            class="w-full sm:w-28 rounded border border-gray-700 py-2 text-sm hover:bg-gray-50"
            @click="confirmAndGoHome"
          >
            Home
          </button>
        </div>

        <div class="border-t border-gray-300 my-6" />
      </div>
    </div>
  </div>
</template>
