<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useInboundStore } from '../../stores/inbound'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { validateSku } from '../../src/api/inbounds'


type Step = 'OPERATOR' | 'HOME' | 'NEW_PACKAGE' | 'SCAN' | 'CONFIRM'
const step = ref<Step>('OPERATOR')
type VerifyStage = 'EMPTY' | 'FIRST' | 'CONFIRMED'


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
const outerBoxLabel = computed(() => store.session?.outerBoxId ?? outerBoxInput.value ?? '')

// -----------------------------
// ✅ Outer / Inner / Qty verification (2x scan for boxes)
// -----------------------------
const outerStage = ref<VerifyStage>('EMPTY')
const innerStage = ref<VerifyStage>('EMPTY')
const qtyStage = ref<VerifyStage>('EMPTY')

const outerFirst = ref('')
const innerFirst = ref('')

const outerVerified = computed(() => outerStage.value === 'CONFIRMED')
const innerVerified = computed(() => innerStage.value === 'CONFIRMED')
const qtyVerified = computed(() => qtyStage.value === 'CONFIRMED')

// strict chaining + lock previous after verified
const outerDisabled = computed(() => outerVerified.value)
const innerDisabled = computed(() => !outerVerified.value || innerVerified.value)
const qtyDisabled = computed(() => !innerVerified.value || qtyVerified.value)

// labels
const outerHint = computed(() =>
  outerStage.value === 'FIRST' ? 'Scan the SAME Outer Box again to confirm' : 'Scan or Type the Outer Box ID'
)
const innerHint = computed(() =>
  innerStage.value === 'FIRST' ? 'Scan the SAME Inner Box again to confirm' : 'Scan or Type the Inner Box ID'
)

const operatorInput = ref('')
const operatorEl = ref<HTMLInputElement | null>(null)

function goToOperator() {
  // hard reset (DB + store)
  store.resetAll()

  // clear UI inputs
  outerBoxInput.value = ''
  innerBoxInput.value = ''
  qtyInput.value = null
  skuInput.value = ''
  serialInput.value = ''

  // reset verification states
  outerStage.value = 'EMPTY'
  innerStage.value = 'EMPTY'
  qtyStage.value = 'EMPTY'
  outerFirst.value = ''
  innerFirst.value = ''
  skuStage.value = 'EMPTY'

  // go to operator screen
  step.value = 'OPERATOR'

  nextTick(() => operatorEl.value?.focus())
}


function saveOperator() {
  const ok = store.setOperator(operatorInput.value)
  if (!ok) {
    nextTick(() => operatorEl.value?.focus())
    return
  }
  step.value = 'HOME'
}

function goEditPackages() {
  // You can route, or change step, or open a dialog
  // Example: step-based navigation'

  // Or if using router:
  // router.push('/inbound/edit')
}


function verifyOuter() {
  store.clearMessages()
  const v = outerBoxInput.value.trim()
  if (!v) return

  if (outerStage.value === 'EMPTY') {
    outerFirst.value = v
    outerStage.value = 'FIRST'
    outerBoxInput.value = ''
    toast.add({ severity: 'info', summary: 'Confirm', detail: 'Re-scan Outer Box to confirm.', life: 1500 })
    nextTick(() => outerEl.value?.focus())
    return
  }

  if (outerStage.value === 'FIRST') {
    if (v !== outerFirst.value) {
      outerFirst.value = ''
      outerStage.value = 'EMPTY'
      outerBoxInput.value = ''
      toast.add({ severity: 'error', summary: 'Mismatch', detail: 'Outer Box mismatch. Scan again.', life: 2500 })
      nextTick(() => outerEl.value?.focus())
      return
    }

    outerStage.value = 'CONFIRMED'
    outerBoxInput.value = v
    nextTick(() => innerEl.value?.focus())
  }
}

function verifyInner() {
  store.clearMessages()
  const v = innerBoxInput.value.trim()
  if (!v) return

  if (innerStage.value === 'EMPTY') {
    innerFirst.value = v
    innerStage.value = 'FIRST'
    innerBoxInput.value = ''
    toast.add({ severity: 'info', summary: 'Confirm', detail: 'Re-scan Inner Box to confirm.', life: 1500 })
    nextTick(() => innerEl.value?.focus())
    return
  }

  if (innerStage.value === 'FIRST') {
    if (v !== innerFirst.value) {
      innerFirst.value = ''
      innerStage.value = 'EMPTY'
      innerBoxInput.value = ''
      toast.add({ severity: 'error', summary: 'Mismatch', detail: 'Inner Box mismatch. Scan again.', life: 2500 })
      nextTick(() => innerEl.value?.focus())
      return
    }

    innerStage.value = 'CONFIRMED'
    innerBoxInput.value = v
    nextTick(() => qtyEl.value?.focus())
  }
}

function verifyQty() {
  store.clearMessages()
  const q = qtyInput.value ?? 0
  if (!q || q < 1) {
    toast.add({ severity: 'error', summary: 'Invalid', detail: 'Quantity must be >= 1', life: 2500 })
    nextTick(() => qtyEl.value?.focus())
    return
  }
  qtyStage.value = 'CONFIRMED'
  nextTick(() => onNewPackageNext())
}

// -----------------------------
// ✅ SKU / Serial flow (SKU must be scanned again for every product)
// -----------------------------
const skuStage = ref<'EMPTY' | 'CONFIRMED'>('EMPTY')
const skuVerified = computed(() => skuStage.value === 'CONFIRMED')

// strict disable chain
const skuDisabled = computed(() => store.scanLocked || skuVerified.value)
const serialDisabled = computed(() => store.scanLocked || !skuVerified.value)

// nice small helper text
const skuPill = computed(() => (skuVerified.value ? store.current.sku : ''))

async function onSkuEnter() {
  const incoming = skuInput.value.trim()
  if (!incoming) return

  // format validation
  const ok = store.setSku(incoming)
  if (!ok || store.error) {
    skuStage.value = 'EMPTY'
    skuInput.value = ''
    nextTick(() => skuEl.value?.focus())
    return
  }

  // ✅ server validation BEFORE serial
  try {
    await validateSku(store.sessionId!, store.current.sku, store.operatorName)
  } catch (err: any) {
    store.error = err?.response?.data?.error || "SKU mismatch"
    store.current.sku = ''
    store.skuValidated = false
    skuStage.value = 'EMPTY'
    skuInput.value = ''
    nextTick(() => skuEl.value?.focus())
    return
  }

  skuStage.value = 'CONFIRMED'
  skuInput.value = store.current.sku
  nextTick(() => serialEl.value?.focus())
}



async function onSerialEnter() {
  const incoming = serialInput.value.trim()
  if (!incoming) return

  const ok = await store.addSerial(incoming)
  if (!ok) {
    nextTick(() => serialEl.value?.focus())
    return
  }

  serialInput.value = ''
  skuInput.value = ''
  skuStage.value = 'EMPTY'
  nextTick(() => skuEl.value?.focus())
}


// -----------------------------
// Toast watchers
// -----------------------------
watch(
  () => store.error,
  (val) => {
    if (!val) return
    toast.add({ severity: 'error', summary: 'Error', detail: val, life: 3000 })
    store.error = ''
  }
)

watch(
  () => store.success,
  (val) => {
    if (!val) return
    toast.add({ severity: 'success', summary: 'Success', detail: val, life: 2500 })
    store.success = ''
  }
)

// -----------------------------
// navigation
// -----------------------------
async function goNewPackage() {
  step.value = 'NEW_PACKAGE'
  await store.resetCurrentInnerbox()   // ✅ await
  store.clearMessages()

  outerBoxInput.value = store.session?.outerBoxId ?? ''
  innerBoxInput.value = ''
  qtyInput.value = null
  skuInput.value = ''
  serialInput.value = ''

  outerStage.value = outerBoxInput.value.trim() ? 'CONFIRMED' : 'EMPTY'
  innerStage.value = 'EMPTY'
  qtyStage.value = 'EMPTY'
  outerFirst.value = ''
  innerFirst.value = ''

  skuStage.value = 'EMPTY'
  nextTick(() => (outerVerified.value ? innerEl.value?.focus() : outerEl.value?.focus()))
}


function goHome() {
  step.value = 'HOME'
  store.clearMessages()

  outerBoxInput.value = ''
  innerBoxInput.value = ''
  qtyInput.value = null
  skuInput.value = ''
  serialInput.value = ''

  outerStage.value = 'EMPTY'
  innerStage.value = 'EMPTY'
  qtyStage.value = 'EMPTY'
  outerFirst.value = ''
  innerFirst.value = ''

  skuStage.value = 'EMPTY'
    ; (store.current as any).sku = ''
}

async function onNewPackageNext() {
  store.clearMessages()

  if (!outerVerified.value || !innerVerified.value || !qtyVerified.value) {
    toast.add({
      severity: 'warn',
      summary: 'Incomplete',
      detail: 'Confirm OuterBox, InnerBox, and Quantity first.',
      life: 2000
    })
    return
  }

  store.startOrResumeOuterbox(outerBoxInput.value)
const ok = await store.beginInnerbox(innerBoxInput.value, qtyInput.value ?? 0)
if (!ok) return


  // reset scan fields and force SKU per product
  step.value = 'SCAN'
  skuInput.value = ''
  serialInput.value = ''
  skuStage.value = 'EMPTY'
    ; (store.current as any).sku = ''
  nextTick(() => skuEl.value?.focus())
}

// -----------------------------
// ✅ Scan Complete = go directly to CONFIRM (no Next button)
// -----------------------------
const canScanComplete = computed(() => {
  return (
    store.current.items.length > 0 &&   // at least 1 SKU + SN scanned
    !store.error &&                     // no active error
    !store.scanLocked                   // not already locked
  )
})



function scanCompleteAndGoConfirm() {
  if (!canScanComplete.value) {
    toast.add({
      severity: 'warn',
      summary: 'Not Ready',
      detail: 'Complete scanning all products for this InnerBox first.',
      life: 2200
    })
    return
  }

  // finalize scanning (keeps your existing store behavior)
  step.value = 'CONFIRM'
}

// -----------------------------
// reset current innerbox
// -----------------------------

function requireOuterRescan() {
  // unlock + force rescan UI
  outerStage.value = 'EMPTY'
  outerFirst.value = ''
  outerBoxInput.value = ''      // force user to scan again

  // also reset downstream fields/stages
  innerStage.value = 'EMPTY'
  innerFirst.value = ''
  innerBoxInput.value = ''
  qtyStage.value = 'EMPTY'
  qtyInput.value = null

  // scan fields
  skuInput.value = ''
  serialInput.value = ''

  nextTick(() => outerEl.value?.focus())
}

async function resetCurrentInnerbox() {
 const ok = await store.resetCurrentInnerbox()
if (!ok) return
  skuInput.value = ''
  serialInput.value = ''
  skuStage.value = 'EMPTY'

  step.value = 'NEW_PACKAGE'
  requireOuterRescan()
  innerBoxInput.value = ''
  qtyInput.value = null

  // reset inner/qty verification
  innerStage.value = 'EMPTY'
  qtyStage.value = 'EMPTY'
  innerFirst.value = ''

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
    accept: async () => {
  await resetCurrentInnerbox()
  toast.add({ severity: 'info', summary: 'Reset', detail: 'Current InnerBox reset.', life: 2000 })
}
  })
}

async function confirmNextInnerbox() {
  store.clearMessages()

  // 1) ✅ server-side confirm (qty check + mark confirmed)
  const okFinalize = await store.finalizeInnerbox()
  if (!okFinalize) return

  // 2) ✅ local store + reset current
  const okLocal = await store.confirmInnerbox()
  if (!okLocal) return

  // 3) go to next package + force outer rescan
  step.value = 'NEW_PACKAGE'

  outerBoxInput.value = ''
  innerBoxInput.value = ''
  qtyInput.value = null
  skuInput.value = ''
  serialInput.value = ''

  outerStage.value = 'EMPTY'
  innerStage.value = 'EMPTY'
  qtyStage.value = 'EMPTY'
  outerFirst.value = ''
  innerFirst.value = ''

  skuStage.value = 'EMPTY'
  ;(store.current as any).sku = ''

  nextTick(() => outerEl.value?.focus())
}

async function confirmAndGoHome() {
  store.clearMessages()

  const okFinalize = await store.finalizeInnerbox()
  if (!okFinalize) return

  const okLocal = await store.confirmInnerbox()
  if (!okLocal) return

  // ✅ VERY IMPORTANT: clear session so outerBoxId won't auto-fill again
  store.resetAll()

  // ✅ Clear UI + verification states
  outerBoxInput.value = ''
  innerBoxInput.value = ''
  qtyInput.value = null
  skuInput.value = ''
  serialInput.value = ''

  outerStage.value = 'EMPTY'
  innerStage.value = 'EMPTY'
  qtyStage.value = 'EMPTY'
  outerFirst.value = ''
  innerFirst.value = ''

  skuStage.value = 'EMPTY'
  nextTick(() => operatorEl.value?.focus())

  step.value = 'OPERATOR'
}



// -----------------------------
// Confirm page “saved data” helpers
// -----------------------------
const confirmSummary = computed(() => ({
  outerBoxId: outerBoxLabel.value,
  innerBoxId: store.current.innerBoxId,
  qty: store.current.expectedQty,
  scanned: store.current.items?.length ?? 0
}))


</script>

<template>
  <title>Inbound Inventory</title>

  <div v-if="step === 'OPERATOR'" class="h-[calc(100vh-96px)] px-4 flex items-center">
    <div class="mx-auto w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
      <div class="text-xl font-semibold text-center">Operator Name</div>
      <div class="text-sm text-gray-500 text-center mt-2">
        Enter your username before starting scanning.
      </div>

      <div class="mt-6">
        <label class="text-xs text-gray-500">Username</label>
        <input ref="operatorEl" v-model="operatorInput"
          class="mt-2 w-full border border-gray-300 px-4 py-3 rounded-xl outline-none text-center bg-white text-black"
          placeholder="e.g. Ramu" @keydown.enter.prevent="saveOperator" />
      </div>

      <button class="mt-5 w-full rounded-xl bg-gray-900 text-white py-3 text-sm hover:opacity-90" @click="saveOperator">
        Continue
      </button>
    </div>
  </div>


  <div class="text-gray-900 w-full bg-gray-50 min-h-[calc(100vh-64px)]">
    <!-- HOME -->
    <div v-if="step === 'HOME'" class="h-[calc(100vh-96px)] px-4 flex items-center">
  <div class="mx-auto w-full max-w-md sm:max-w-4xl text-center">

    <!-- Title -->
    <div class="mb-4 sm:mb-6">
      <div class="font-semibold tracking-wide text-2xl sm:text-2xl md:text-[30px]">
        Inbound Inventory Tracking System
      </div>

      <!-- Operator -->
      <div class="mt-3 text-sm text-gray-600">
        Logged in as
        <span class="font-semibold text-gray-900 ml-1">
          {{ store.operatorName }}
        </span>
      </div>
    </div>

    <!-- Actions -->
    <div
      class="mt-10 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-4 sm:gap-8"
    >
      <!-- New Package -->
      <button
        class="w-full sm:w-72 h-24 rounded-2xl border border-gray-200 bg-white shadow-sm
               hover:shadow-lg hover:-translate-y-0.5 transition
               flex items-center justify-center"
        @click="goNewPackage"
      >
        <span class="text-lg sm:text-base font-semibold tracking-wide">
          NEW PACKAGE
        </span>
      </button>

      <!-- Edit Packages -->
      <button
        class="w-full sm:w-72 h-24 rounded-2xl border border-gray-200 bg-white shadow-sm
               hover:shadow-lg hover:-translate-y-0.5 transition
               flex items-center justify-center"
        @click="goEditPackages"
      >
        <span class="text-lg sm:text-base font-semibold tracking-wide">
          EDIT PACKAGES
        </span>
      </button>
    </div>
  </div>
</div>


    <!-- NEW PACKAGE -->
    <div v-if="step === 'NEW_PACKAGE'" class="px-4 py-6">
      <div class="mx-auto max-w-lg">
        <div class="flex items-center justify-between gap-3">
          <div class="text-lg font-semibold tracking-wide">New Package</div>
          <div class="text-xs text-gray-500">
            Operator: <span class="font-semibold text-gray-800">{{ store.operatorName }}</span>
          </div>
          <div class="text-xs border border-gray-200 bg-white px-3 py-2 rounded-xl shadow-sm">
            <div class="text-gray-500">Date</div>
            <div class="font-semibold">{{ dateLabel }}</div>
          </div>
        </div>

        <div class="mt-6 bg-white border border-gray-200 rounded-2xl shadow-sm p-5 sm:p-6">
          <div class="grid grid-cols-1 gap-4 md:gap-6 items-end">
            <!-- OUTER -->
            <div class="w-full text-left">
              <div class="text-xs text-gray-500 mb-2">{{ outerHint }}</div>
              <div class="relative">
                <input ref="outerEl" v-model="outerBoxInput" :disabled="outerDisabled"
                  class="w-full border border-gray-300 px-4 py-3 text-center outline-none rounded-xl bg-white disabled:bg-gray-100 disabled:cursor-not-allowed pr-11"
                  placeholder="Outer Box ID" @keydown.enter.prevent="verifyOuter" />
                <i v-if="outerVerified"
                  class="pi pi-check-circle absolute right-3 top-1/2 -translate-y-1/2 text-green-600" />
              </div>
            </div>

            <!-- INNER -->
            <div class="w-full text-left">
              <div class="text-xs text-gray-500 mb-2">{{ innerHint }}</div>
              <div class="relative">
                <input ref="innerEl" v-model="innerBoxInput" :disabled="innerDisabled"
                  class="w-full border border-gray-300 px-4 py-3 text-center outline-none rounded-xl bg-white disabled:bg-gray-100 disabled:cursor-not-allowed pr-11"
                  placeholder="Inner Box ID" @keydown.enter.prevent="verifyInner" />
                <i v-if="innerVerified"
                  class="pi pi-check-circle absolute right-3 top-1/2 -translate-y-1/2 text-green-600" />
              </div>
            </div>

            <!-- QTY -->
            <div class="w-full text-left">
              <div class="text-xs text-gray-500 mb-2">Product Quantity</div>
              <div class="relative">
                <input ref="qtyEl" v-model.number="qtyInput" :disabled="qtyDisabled" type="number" min="1"
                  class="w-full border border-gray-300 px-4 py-3 text-center outline-none rounded-xl bg-white disabled:bg-gray-100 disabled:cursor-not-allowed pr-11"
                  placeholder="0" @keydown.enter.prevent="verifyQty" />
                <i v-if="qtyVerified"
                  class="pi pi-check-circle absolute right-3 top-1/2 -translate-y-1/2 text-green-600" />
              </div>
            </div>
          </div>

          <div class="flex flex-col sm:flex-row justify-end gap-3 mt-6">
            <button class="w-full sm:w-32 rounded-xl py-3 text-sm text-white"
              :class="outerVerified && innerVerified && qtyVerified ? 'bg-gray-900 hover:opacity-90' : 'bg-gray-400 cursor-not-allowed'"
              :disabled="!(outerVerified && innerVerified && qtyVerified)" @click="onNewPackageNext">
              Start Scan
            </button>

            <button class="w-full sm:w-28 rounded-xl bg-orange-500 text-white py-3 text-sm hover:opacity-90"
              @click="confirmResetCurrentInnerbox">
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- SCAN -->
    <div v-if="step === 'SCAN'" class="px-4 py-6">
      <div class="mx-auto max-w-5xl">
        <!-- header -->
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-sm text-gray-500">Outer Box</div>
            <div class="text-lg font-semibold">{{ outerBoxLabel }}</div>

            <div class="mt-2 text-sm text-gray-500">Inner Box</div>
            <div class="text-lg font-semibold">{{ store.current.innerBoxId }}</div>
          </div>

          <div class="text-xs text-gray-500">
            Operator: <span class="font-semibold text-gray-800">{{ store.operatorName }}</span>
          </div>

          <div class="text-xs border border-gray-200 bg-white px-3 py-2 rounded-xl shadow-sm">
            <div class="text-gray-500">Date</div>
            <div class="font-semibold">{{ dateLabel }}</div>
          </div>
        </div>

        <!-- stats -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6 mt-6">
          <div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 text-center">
            <div class="text-[11px] text-gray-500 uppercase tracking-wide">Entered Qty</div>
            <div class="mt-2 text-2xl font-semibold text-gray-900">{{ store.current.expectedQty }}</div>
          </div>

          <div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 text-center">
            <div class="text-[11px] text-gray-500 uppercase tracking-wide">Scanned</div>
            <div class="mt-2 text-2xl font-semibold text-gray-900">{{ store.scannedProductsCurrent }}</div>
          </div>

          <div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 text-center">
            <div class="text-[11px] text-gray-500 uppercase tracking-wide">Innerboxes</div>
            <div class="mt-2 text-2xl font-semibold text-gray-900">{{ store.scannedInnerboxesCount }}</div>
          </div>

          <div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 text-center">
            <div class="text-[11px] text-gray-500 uppercase tracking-wide">Total Products</div>
            <div class="mt-2 text-2xl font-semibold text-gray-900">{{ store.allProductsCountIncludingCurrent }}</div>
          </div>
        </div>

        <!-- scan area -->
        <div class="mt-6 bg-white border border-gray-200 rounded-2xl shadow-sm p-5 sm:p-6">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 items-start">
            <!-- SKU -->
            <div class="w-full text-left">
              <div class="text-xs text-gray-500 mb-2">
                Product SKU <span class="text-gray-400">(Scan every product)</span>
              </div>

              <div class="relative">
                <input ref="skuEl" v-model="skuInput" :disabled="skuDisabled"
                  class="w-full border border-gray-300 px-4 py-3 text-center outline-none text-sm rounded-xl bg-white disabled:bg-gray-100 disabled:cursor-not-allowed pr-11"
                  placeholder="Scan/Type SKU" @keydown.enter.prevent="onSkuEnter" />
                <i v-if="skuVerified"
                  class="pi pi-check-circle absolute right-3 top-1/2 -translate-y-1/2 text-green-600" />
              </div>
            </div>

            <!-- SERIAL -->
            <div class="w-full text-left">
              <div class="text-xs text-gray-500 mb-2">Product Serial Number</div>

              <div class="relative">
                <input ref="serialEl" v-model="serialInput" :disabled="serialDisabled"
                  class="w-full border border-gray-300 px-4 py-3 text-center outline-none text-sm rounded-xl bg-white disabled:bg-gray-100 disabled:cursor-not-allowed pr-11"
                  placeholder="Scan/Type Serial" @keydown.enter.prevent="onSerialEnter" />
                <i v-if="!serialDisabled"
                  class="pi pi-check-circle absolute right-3 top-1/2 -translate-y-1/2 text-green-600 opacity-30" />
              </div>

              <div class="mt-2 text-[11px] text-gray-500">
                Tip: Scan SKU → then scan Serial. After saving one item, SKU is required again.
              </div>
            </div>

            <!-- LIST -->
            <div class="w-full">
              <div class="text-xs text-gray-500 mb-2">Scanned Products</div>

              <div class="border border-gray-200 bg-gray-50 p-3 h-40 overflow-auto text-xs rounded-2xl">
                <div v-for="item in store.current.items" :key="item.serial"
                  class="flex items-start justify-between gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 mb-2">
                  <div class="flex flex-col">
                    <span class="font-semibold">SKU: {{ item.sku }}</span>
                    <span class="font-mono text-gray-600">SN: {{ item.serial }}</span>
                  </div>
                  <i class="pi pi-check text-green-600 mt-1" />
                </div>

                <div v-if="store.current.items.length === 0" class="text-gray-400 text-center py-10">
                  No products yet
                </div>
              </div>
            </div>
          </div>

          <!-- actions -->
          <div class="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 mt-6">
            <button
              class="w-full sm:w-44 rounded-xl bg-blue-600 text-white py-3 text-sm hover:opacity-90 disabled:opacity-50"
              :disabled="!canScanComplete" @click="scanCompleteAndGoConfirm">
              Scan Complete
            </button>

            <button class="w-full sm:w-28 rounded-xl bg-orange-500 text-white py-3 text-sm hover:opacity-90"
              @click="confirmResetCurrentInnerbox">
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- CONFIRM (show saved/scanned data, no stat cards) -->
    <div v-if="step === 'CONFIRM'" class="px-4 py-6">
      <div class="mx-auto max-w-5xl">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-lg font-semibold">Confirm & Save</div>
            <div class="text-sm text-gray-500 mt-1">Review the scanned data below before confirming.</div>
          </div>

          <div class="text-xs text-gray-500">
            Operator: <span class="font-semibold text-gray-800">{{ store.operatorName }}</span>
          </div>

          <div class="text-xs border border-gray-200 bg-white px-3 py-2 rounded-xl shadow-sm">
            <div class="text-gray-500">Date</div>
            <div class="font-semibold">{{ dateLabel }}</div>
          </div>
        </div>

        <!-- summary -->
        <div class="mt-6 bg-white border border-gray-200 rounded-2xl shadow-sm p-5 sm:p-6">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="bg-gray-50 border border-gray-200 rounded-2xl p-4">
              <div class="text-[11px] text-gray-500 uppercase tracking-wide">Outer Box</div>
              <div class="mt-1 text-lg font-semibold">{{ confirmSummary.outerBoxId }}</div>
            </div>

            <div class="bg-gray-50 border border-gray-200 rounded-2xl p-4">
              <div class="text-[11px] text-gray-500 uppercase tracking-wide">Inner Box</div>
              <div class="mt-1 text-lg font-semibold">{{ confirmSummary.innerBoxId }}</div>
            </div>

            <div class="bg-gray-50 border border-gray-200 rounded-2xl p-4">
              <div class="text-[11px] text-gray-500 uppercase tracking-wide">Quantity</div>
              <div class="mt-1 text-lg font-semibold">
                {{ confirmSummary.scanned }} / {{ confirmSummary.qty }}
              </div>
              <div class="text-[11px] text-gray-500 mt-1">Scanned / Expected</div>
            </div>
          </div>

          <!-- items -->
          <div class="mt-6">
            <div class="text-sm font-semibold">Scanned Items</div>
            <div class="text-xs text-gray-500 mt-1">SKU & Serial numbers saved for this InnerBox.</div>

            <div class="mt-3 border border-gray-200 rounded-2xl overflow-hidden">
              <div class="grid grid-cols-12 bg-gray-100 px-4 py-3 text-xs font-semibold text-gray-600">
                <div class="col-span-1">#</div>
                <div class="col-span-5">SKU</div>
                <div class="col-span-6">Serial Number</div>
              </div>

              <div v-if="store.current.items.length === 0" class="px-4 py-10 text-center text-gray-400">
                No scanned items
              </div>

              <div v-for="(item, idx) in store.current.items" :key="item.serial"
                class="grid grid-cols-12 px-4 py-3 text-sm border-t border-gray-200 bg-white">
                <div class="col-span-1 text-gray-500">{{ idx + 1 }}</div>
                <div class="col-span-5 font-semibold">{{ item.sku }}</div>
                <div class="col-span-6 font-mono text-gray-700">{{ item.serial }}</div>
              </div>
            </div>
          </div>

          <!-- actions -->
          <div class="flex flex-col sm:flex-row justify-center gap-3 sm:gap-6 mt-6">
            <button class="w-full sm:w-28 rounded-xl bg-orange-500 text-white py-3 text-sm hover:opacity-90"
              @click="confirmResetCurrentInnerbox">
              Reset
            </button>

            <button class="w-full sm:w-44 rounded-xl bg-gray-900 text-white py-3 text-sm hover:opacity-90"
              @click="confirmNextInnerbox">
              Confirm & Next InnerBox
            </button>

            <button class="w-full sm:w-28 rounded-xl border border-gray-300 bg-white py-3 text-sm hover:bg-gray-50"
              @click="confirmAndGoHome">
              Home
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
