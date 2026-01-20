<script setup lang="ts">
import { ref, computed, nextTick, watch } from "vue";
import { useInboundStore } from "../../stores/inbound";
import { useToast } from "primevue/usetoast";
import { useConfirm } from "primevue/useconfirm";
import { validateSku } from "../../src/api/inbounds";
import { useRouter } from "vue-router";
import Slider from "primevue/slider";

// set your allowed max quantity here
const qtyMax = 50;

const router = useRouter();

type Step = "OPERATOR" | "HOME" | "NEW_PACKAGE" | "SCAN" | "CONFIRM";
const step = ref<Step>("OPERATOR");
type VerifyStage = "EMPTY" | "FIRST" | "CONFIRMED";

const store = useInboundStore();
const toast = useToast();
const confirm = useConfirm();

// inputs
const outerBoxInput = ref("");
const innerBoxInput = ref("");
const outerConfirmInput = ref("");
const innerConfirmInput = ref("");
const qtyInput = ref<number>(1); // Slider needs a number
const skuInput = ref("");
const serialInput = ref("");

// refs for focus
const outerEl = ref<HTMLInputElement | null>(null);
const innerEl = ref<HTMLInputElement | null>(null);
const outerConfirmEl = ref<HTMLInputElement | null>(null);
const innerConfirmEl = ref<HTMLInputElement | null>(null);
const qtyEl = ref<HTMLInputElement | null>(null);
const skuEl = ref<HTMLInputElement | null>(null);
const serialEl = ref<HTMLInputElement | null>(null);

const dateLabel = computed(() => store.session?.date ?? store.date);
const outerBoxLabel = computed(() => store.session?.outerBoxId ?? outerBoxInput.value ?? "");

// -----------------------------
// Outer / Inner / Qty verification (2x scan for boxes)
// -----------------------------
const outerStage = ref<VerifyStage>("EMPTY");
const innerStage = ref<VerifyStage>("EMPTY");
const qtyStage = ref<VerifyStage>("EMPTY");

const outerFirst = ref("");
const innerFirst = ref("");

const outerVerified = computed(() => outerStage.value === "CONFIRMED");
const innerVerified = computed(() => innerStage.value === "CONFIRMED");
const qtyVerified = computed(() => qtyStage.value === "CONFIRMED");

// strict chaining + lock previous after verified
const outerDisabled = computed(() => outerVerified.value);
const innerDisabled = computed(() => !outerVerified.value || innerVerified.value);

// NOTE: qtyDisabled is the single source of truth for "locked UI"
const qtyDisabled = computed(() => {
  return (
    !innerVerified.value || // must confirm inner first
    qtyVerified.value || // once confirmed, don't allow change
    store.qtyLocked || // store lock from server/resume
    store.current.items.length > 0 // if any scanning started, lock
  );
});

// ✅ IMPORTANT: even if Slider tries to "drag", we block updates via this proxy.
// This stops the slider thumb from moving (because v-model won't accept the new value).
const qtyModel = computed<number>({
  get() {
    return qtyInput.value;
  },
  set(v) {
    if (qtyDisabled.value) {
      // Block any visual changes
      toast.add({
        severity: "warn",
        summary: "Quantity Locked",
        detail: "Quantity cannot be changed after session starts / resume mode.",
        life: 1400
      });
      return;
    }
    qtyInput.value = v;
    qtyStage.value = "EMPTY";
  }
});

// labels
const outerHint = computed(() =>
  outerStage.value === "FIRST" ? "Confirm Outer Box ID" : "Scan or Type the Outer Box ID"
);

const innerHint = computed(() =>
  innerStage.value === "FIRST" ? "Confirm Inner Box ID" : "Scan or Type the Inner Box ID"
);

const operatorInput = ref("");
const operatorEl = ref<HTMLInputElement | null>(null);

function goToOperator() {
  // hard reset (DB + store)
  store.resetAll();

  // clear UI inputs
  outerBoxInput.value = "";
  innerBoxInput.value = "";
  outerConfirmInput.value = "";
  innerConfirmInput.value = "";
  qtyInput.value = 1;
  skuInput.value = "";
  serialInput.value = "";

  // reset verification states
  outerStage.value = "EMPTY";
  innerStage.value = "EMPTY";
  qtyStage.value = "EMPTY";
  outerFirst.value = "";
  innerFirst.value = "";
  skuStage.value = "EMPTY";

  // go to operator screen
  step.value = "OPERATOR";
  nextTick(() => operatorEl.value?.focus());
}

const outerConfirmDisabled = computed(() => outerStage.value !== "FIRST" || outerVerified.value);
const innerConfirmDisabled = computed(() => innerStage.value !== "FIRST" || innerVerified.value);

function saveOperator() {
  const ok = store.setOperator(operatorInput.value);
  if (!ok) {
    nextTick(() => operatorEl.value?.focus());
    return;
  }
  step.value = "HOME";
}

function goEditPackages() {
  router.push("/inbound/edit");
}

function verifyOuterFirst() {
  store.clearMessages();
  const v = outerBoxInput.value.trim();
  if (!v) return;

  outerFirst.value = v;
  outerStage.value = "FIRST";

  // lock first input
  outerBoxInput.value = v;
  outerConfirmInput.value = "";

  toast.add({
    severity: "info",
    summary: "Confirm",
    detail: "Scan Outer Box again to confirm.",
    life: 1500
  });
  nextTick(() => outerConfirmEl.value?.focus());
}

function verifyOuterConfirm() {
  store.clearMessages();
  const v = outerConfirmInput.value.trim();
  if (!v) return;

  if (v !== outerFirst.value) {
    toast.add({
      severity: "error",
      summary: "Mismatch",
      detail: "Outer Box mismatch. Try again.",
      life: 2500
    });
    outerConfirmInput.value = "";
    nextTick(() => outerConfirmEl.value?.focus());
    return;
  }

  outerStage.value = "CONFIRMED";
  toast.add({
    severity: "success",
    summary: "Confirmed",
    detail: "Outer Box confirmed.",
    life: 1200
  });

  nextTick(() => innerEl.value?.focus());
}

function verifyInnerFirst() {
  store.clearMessages();
  const v = innerBoxInput.value.trim();
  if (!v) return;

  innerFirst.value = v;
  innerStage.value = "FIRST";

  innerBoxInput.value = v;
  innerConfirmInput.value = "";

  toast.add({
    severity: "info",
    summary: "Confirm",
    detail: "Scan Inner Box again to confirm.",
    life: 1500
  });
  nextTick(() => innerConfirmEl.value?.focus());
}

function verifyInnerConfirm() {
  store.clearMessages();
  const v = innerConfirmInput.value.trim();
  if (!v) return;

  if (v !== innerFirst.value) {
    toast.add({
      severity: "error",
      summary: "Mismatch",
      detail: "Inner Box mismatch. Try again.",
      life: 2500
    });
    innerConfirmInput.value = "";
    nextTick(() => innerConfirmEl.value?.focus());
    return;
  }

  innerStage.value = "CONFIRMED";
  toast.add({
    severity: "success",
    summary: "Confirmed",
    detail: "Inner Box confirmed.",
    life: 1200
  });

  nextTick(() => qtyEl.value?.focus?.());
}

function verifyQty() {
  store.clearMessages();
  const q = qtyInput.value ?? 0;
  if (!q || q < 1) {
    toast.add({
      severity: "error",
      summary: "Invalid",
      detail: "Quantity must be >= 1",
      life: 2500
    });
    nextTick(() => qtyEl.value?.focus());
    return;
  }
  qtyStage.value = "CONFIRMED";
}

// -----------------------------
// SKU / Serial flow (SKU must be scanned again for every product)
// -----------------------------
const skuStage = ref<"EMPTY" | "CONFIRMED">("EMPTY");
const skuVerified = computed(() => skuStage.value === "CONFIRMED");

// strict disable chain
const skuDisabled = computed(() => store.scanLocked || skuVerified.value);
const serialDisabled = computed(() => store.scanLocked || !skuVerified.value);

// nice small helper text
const skuPill = computed(() => (skuVerified.value ? store.current.sku : ""));

async function onSkuEnter() {
  const incoming = skuInput.value.trim();
  if (!incoming) return;

  const ok = store.setSku(incoming);
  if (!ok || store.error) {
    skuStage.value = "EMPTY";
    skuInput.value = "";
    nextTick(() => skuEl.value?.focus());
    return;
  }

  // server validation BEFORE serial
  try {
    await validateSku(store.sessionId!, store.current.sku, store.operatorName);
  } catch (err: any) {
    store.error = err?.response?.data?.error || "SKU mismatch";
    store.current.sku = "";
    store.skuValidated = false;
    skuStage.value = "EMPTY";
    skuInput.value = "";
    nextTick(() => skuEl.value?.focus());
    return;
  }

  skuStage.value = "CONFIRMED";
  skuInput.value = store.current.sku;
  nextTick(() => serialEl.value?.focus());
}

function focusSku() {
  nextTick(() => {
    setTimeout(() => {
      skuEl.value?.focus();
      skuEl.value?.select?.();
    }, 0);
  });
}

async function onSerialEnter() {
  // Batch locked → stop
  if (store.batchLocked) {
    toast.add({
      severity: "warn",
      summary: "Batch Full",
      detail: "Confirm or reset the batch to continue.",
      life: 2000
    });

    serialInput.value = "";
    skuInput.value = "";
    skuStage.value = "EMPTY";
    store.current.sku = "";
    store.skuValidated = false;

    focusSku();
    return;
  }

  const incoming = serialInput.value.trim();
  if (!incoming) return;

  const ok = await store.addSerial(incoming);

  if (!ok) {
    serialInput.value = "";
    skuInput.value = "";
    skuStage.value = "EMPTY";
    store.current.sku = "";
    store.skuValidated = false;

    focusSku();
    return;
  }

  // success: clear and go back to SKU
  serialInput.value = "";
  skuInput.value = "";
  skuStage.value = "EMPTY";
  focusSku();
}

// -----------------------------
// Toast watchers
// -----------------------------
watch(
  () => store.error,
  (val) => {
    if (!val) return;
    toast.add({ severity: "error", summary: "Error", detail: val, life: 3000 });
    store.error = "";
  }
);

watch(
  () => store.success,
  (val) => {
    if (!val) return;
    toast.add({ severity: "success", summary: "Success", detail: val, life: 2500 });
    store.success = "";
  }
);

watch(
  () => store.goOperatorRequested,
  (val) => {
    if (!val) return;

    step.value = "OPERATOR";
    store.clearGoOperatorRequest();
    nextTick(() => operatorEl.value?.focus());
  }
);

// ✅ When server resumes a session, reflect expectedQty in the UI slider display once it changes
watch(
  () => store.current.expectedQty,
  (v) => {
    if (v && v > 0) {
      qtyInput.value = v;
      // If server already has expectedQty (resume), treat as confirmed in UI
      // But ONLY if qty is locked or scanning already started
      if (store.qtyLocked || store.current.items.length > 0) {
        qtyStage.value = "CONFIRMED";
      }
    }
  },
  { immediate: true }
);

// -----------------------------
// navigation
// -----------------------------
async function goNewPackage() {
  step.value = "NEW_PACKAGE";
  await store.resetCurrentInnerbox();
  store.clearMessages();

  outerBoxInput.value = store.session?.outerBoxId ?? "";
  innerBoxInput.value = "";
  outerConfirmInput.value = "";
  innerConfirmInput.value = "";

  qtyInput.value = 1;
  qtyStage.value = "EMPTY";

  skuInput.value = "";
  serialInput.value = "";

  outerStage.value = outerBoxInput.value.trim() ? "CONFIRMED" : "EMPTY";
  innerStage.value = "EMPTY";
  outerFirst.value = "";
  innerFirst.value = "";

  skuStage.value = "EMPTY";
  nextTick(() => (outerVerified.value ? innerEl.value?.focus() : outerEl.value?.focus()));
}

async function onNewPackageNext() {
  store.clearMessages();

  if (!outerVerified.value || !innerVerified.value || !qtyVerified.value) {
    toast.add({
      severity: "warn",
      summary: "Incomplete",
      detail: "Confirm OuterBox, InnerBox, and Quantity first.",
      life: 2000
    });
    return;
  }

  store.startOrResumeOuterbox(outerBoxInput.value);
  const ok = await store.beginInnerbox(innerBoxInput.value, qtyInput.value ?? 0);
  if (!ok) return;

  // IMPORTANT: after claim/resume, always display server qty
  qtyInput.value = store.current.expectedQty;
  // and lock UI stage so user isn't confused
  qtyStage.value = "CONFIRMED";

  // reset scan fields and force SKU per product
  step.value = "SCAN";
  skuInput.value = "";
  serialInput.value = "";
  skuStage.value = "EMPTY";
  (store.current as any).sku = "";
  nextTick(() => skuEl.value?.focus());
}

// Scan Complete = go directly to CONFIRM (no Next button)
const canScanComplete = computed(() => {
  return store.current.items.length > 0 && !store.error && !store.scanLocked;
});

function scanCompleteAndGoConfirm() {
  if (!canScanComplete.value) {
    toast.add({
      severity: "warn",
      summary: "Not Ready",
      detail: "Complete scanning all products for this InnerBox first.",
      life: 2200
    });
    return;
  }

  step.value = "CONFIRM";
}

// -----------------------------
// reset current innerbox
// -----------------------------
function requireOuterRescan() {
  outerStage.value = "EMPTY";
  outerFirst.value = "";
  outerBoxInput.value = "";

  innerStage.value = "EMPTY";
  innerFirst.value = "";
  innerBoxInput.value = "";

  qtyStage.value = "EMPTY";
  qtyInput.value = 1;

  skuInput.value = "";
  serialInput.value = "";

  nextTick(() => outerEl.value?.focus());
}

async function resetCurrentInnerbox() {
  const ok = await store.resetCurrentInnerbox();
  if (!ok) return;

  skuInput.value = "";
  serialInput.value = "";
  skuStage.value = "EMPTY";

  step.value = "NEW_PACKAGE";
  requireOuterRescan();

  nextTick(() => innerEl.value?.focus());
}

// Confirm dialogs
function confirmResetCurrentInnerbox() {
  confirm.require({
    header: "Confirm Reset",
    message: "Are you sure you want to reset the current InnerBox?",
    icon: "pi pi-exclamation-triangle",
    acceptLabel: "Yes, Reset",
    rejectLabel: "Cancel",
    accept: async () => {
      await resetCurrentInnerbox();
      toast.add({ severity: "info", summary: "Reset", detail: "Current InnerBox reset.", life: 2000 });
    }
  });
}

async function confirmNextInnerbox() {
  store.clearMessages();

  const okFinalize = await store.finalizeInnerbox();
  if (!okFinalize) return;

  const okLocal = await store.confirmInnerbox();
  if (!okLocal) return;

  step.value = "NEW_PACKAGE";

  outerBoxInput.value = "";
  innerBoxInput.value = "";
  outerConfirmInput.value = "";
  innerConfirmInput.value = "";
  qtyInput.value = 1;
  qtyStage.value = "EMPTY";

  skuInput.value = "";
  serialInput.value = "";

  outerStage.value = "EMPTY";
  innerStage.value = "EMPTY";
  outerFirst.value = "";
  innerFirst.value = "";

  skuStage.value = "EMPTY";
  (store.current as any).sku = "";

  nextTick(() => outerEl.value?.focus());
}

async function confirmAndGoHome() {
  store.clearMessages();

  const okFinalize = await store.finalizeInnerbox();
  if (!okFinalize) return;

  const okLocal = await store.confirmInnerbox();
  if (!okLocal) return;

  store.resetAll();

  outerBoxInput.value = "";
  innerBoxInput.value = "";
  outerConfirmInput.value = "";
  innerConfirmInput.value = "";
  qtyInput.value = 1;
  qtyStage.value = "EMPTY";

  skuInput.value = "";
  serialInput.value = "";

  outerStage.value = "EMPTY";
  innerStage.value = "EMPTY";
  outerFirst.value = "";
  innerFirst.value = "";

  skuStage.value = "EMPTY";
  nextTick(() => operatorEl.value?.focus());

  step.value = "OPERATOR";
}

// Confirm page summary
const confirmSummary = computed(() => ({
  outerBoxId: outerBoxLabel.value,
  innerBoxId: store.current.innerBoxId,
  qty: store.current.expectedQty,
  scanned: store.current.items?.length ?? 0
}));
</script>

<template>
  <title>Inbound Inventory</title>

  <div v-if="step === 'OPERATOR'" class="h-[calc(100vh-96px)] px-4 flex items-center">
    <div class="mx-auto w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
      <div class="text-xl font-semibold text-center">Operator Name</div>
      <div class="text-sm text-gray-500 text-center mt-2">Enter your username before starting scanning.</div>

      <div class="mt-6">
        <label class="text-xs text-gray-500">Username</label>
        <input
          ref="operatorEl"
          v-model="operatorInput"
          class="mt-2 w-full border border-gray-300 px-4 py-3 rounded-xl outline-none text-center bg-white text-black"
          placeholder="e.g. Ramu"
          @keydown.enter.prevent="saveOperator"
        />
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
        <div class="mb-4 sm:mb-6">
          <div class="font-semibold tracking-wide text-2xl sm:text-2xl md:text-[30px]">
            Inbound Inventory Tracking System
          </div>

          <div class="mt-3 text-sm text-gray-600">
            Logged in as
            <span class="font-semibold text-gray-900 ml-1">
              {{ store.operatorName }}
            </span>
          </div>
        </div>

        <div class="mt-10 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-4 sm:gap-8">
          <button
            class="w-full sm:w-72 h-24 rounded-2xl border border-gray-200 bg-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition flex items-center justify-center"
            @click="goNewPackage"
          >
            <span class="text-lg sm:text-base font-semibold tracking-wide">NEW PACKAGE</span>
          </button>

          <button
            class="w-full sm:w-72 h-24 rounded-2xl border border-gray-200 bg-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition flex items-center justify-center"
            @click="goEditPackages"
          >
            <span class="text-lg sm:text-base font-semibold tracking-wide">EDIT PACKAGES</span>
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
              <div class="text-xs text-gray-500 mb-2">Scan or Type the Outer Box ID</div>

              <div class="relative">
                <input
                  ref="outerEl"
                  v-model="outerBoxInput"
                  :disabled="outerStage !== 'EMPTY' || outerVerified"
                  class="w-full border border-gray-300 px-4 py-3 text-center outline-none rounded-xl bg-white disabled:bg-gray-100 disabled:cursor-not-allowed pr-11"
                  placeholder="Outer Box ID"
                  @keydown.enter.prevent="verifyOuterFirst"
                />
                <i
                  v-if="outerStage !== 'EMPTY'"
                  class="pi pi-check-circle absolute right-3 top-1/2 -translate-y-1/2 text-green-600"
                />
              </div>

              <div v-if="outerStage === 'FIRST'" class="text-xs text-blue-600 mt-3 mb-2">
                Confirm Outer Box ID (scan again)
              </div>

              <div v-if="outerStage === 'FIRST'" class="relative">
                <input
                  ref="outerConfirmEl"
                  v-model="outerConfirmInput"
                  :disabled="outerConfirmDisabled"
                  class="w-full border border-gray-300 px-4 py-3 text-center outline-none rounded-xl bg-white disabled:bg-gray-100 disabled:cursor-not-allowed pr-11"
                  placeholder="Confirm Outer Box ID"
                  @keydown.enter.prevent="verifyOuterConfirm"
                />
              </div>
            </div>

            <!-- INNER -->
            <div class="w-full text-left">
              <div class="text-xs text-gray-500 mb-2">Scan or Type the Inner Box ID</div>

              <div class="relative">
                <input
                  ref="innerEl"
                  v-model="innerBoxInput"
                  :disabled="!outerVerified || innerStage !== 'EMPTY' || innerVerified"
                  class="w-full border border-gray-300 px-4 py-3 text-center outline-none rounded-xl bg-white disabled:bg-gray-100 disabled:cursor-not-allowed pr-11"
                  placeholder="Inner Box ID"
                  @keydown.enter.prevent="verifyInnerFirst"
                />
                <i
                  v-if="innerStage !== 'EMPTY'"
                  class="pi pi-check-circle absolute right-3 top-1/2 -translate-y-1/2 text-green-600"
                />
              </div>

              <div v-if="innerStage === 'FIRST'" class="text-xs text-blue-600 mt-3 mb-2">
                Confirm Inner Box ID (scan again)
              </div>

              <div v-if="innerStage === 'FIRST'" class="relative">
                <input
                  ref="innerConfirmEl"
                  v-model="innerConfirmInput"
                  :disabled="innerConfirmDisabled"
                  class="w-full border border-gray-300 px-4 py-3 text-center outline-none rounded-xl bg-white disabled:bg-gray-100 disabled:cursor-not-allowed pr-11"
                  placeholder="Confirm Inner Box ID"
                  @keydown.enter.prevent="verifyInnerConfirm"
                />
              </div>
            </div>

            <!-- QTY -->
            <div class="w-full text-left">
              <div class="text-xs text-gray-500 mb-2">Product Quantity</div>

              <div class="border border-gray-300 rounded-xl bg-white px-4 py-4">
                <div class="flex items-center justify-between mb-3">
                  <div class="text-sm text-gray-500">Qty</div>

                  <div class="flex items-center gap-2">
                    <div
                      class="min-w-[56px] text-center text-base font-semibold px-3 py-1 rounded-lg bg-gray-50 border border-gray-200"
                      :class="qtyDisabled ? 'opacity-60' : ''"
                    >
                      {{ qtyInput }}
                    </div>
                    <i v-if="qtyVerified" class="pi pi-check-circle text-green-600" />
                  </div>
                </div>

                <!-- ✅ Slider always rendered (consistent UI), but model blocks changes when locked -->
                <Slider
                  v-model="qtyModel"
                  :min="1"
                  :max="qtyMax"
                  :step="1"
                  class="w-full"
                  :disabled="qtyDisabled"
                />

                <div class="flex justify-between text-[11px] text-gray-400 mt-2">
                  <span>1</span>
                  <span>{{ qtyMax }}</span>
                </div>

                <!-- Buttons + confirm -->
                <div class="flex items-center justify-between gap-3 mt-4">
                  <Button
                    icon="pi pi-minus"
                    outlined
                    class="w-12 h-12"
                    :disabled="qtyDisabled || qtyInput <= 1"
                    @click="qtyModel = Math.max(1, qtyInput - 1)"
                  />

                  <Button label="Confirm Qty" class="flex-1 h-12" :disabled="qtyDisabled" @click="verifyQty" />

                  <Button
                    icon="pi pi-plus"
                    outlined
                    class="w-12 h-12"
                    :disabled="qtyDisabled || qtyInput >= qtyMax"
                    @click="qtyModel = Math.min(qtyMax, qtyInput + 1)"
                  />
                </div>

                <!-- small helper when locked -->
                <div v-if="qtyDisabled" class="mt-3 text-xs text-gray-500">
                  Quantity locked. (Session started / resume mode). Reset InnerBox to change.
                </div>
              </div>
            </div>
          </div>

          <div class="flex flex-col sm:flex-row justify-end gap-3 mt-6">
            <button
              class="w-full sm:w-32 rounded-xl py-3 text-sm text-white"
              :class="outerVerified && innerVerified && qtyVerified ? 'bg-gray-900 hover:opacity-90' : 'bg-gray-400 cursor-not-allowed'"
              :disabled="!(outerVerified && innerVerified && qtyVerified)"
              @click="onNewPackageNext"
            >
              Start Scan
            </button>

            <button class="w-full sm:w-28 rounded-xl bg-orange-500 text-white py-3 text-sm hover:opacity-90" @click="confirmResetCurrentInnerbox">
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- SCAN -->
    <div v-if="step === 'SCAN'" class="px-4 py-6">
      <div class="mx-auto max-w-5xl">
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

        <div class="mt-6 bg-white border border-gray-200 rounded-2xl shadow-sm p-5 sm:p-6">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 items-start">
            <!-- SKU -->
            <div class="w-full text-left">
              <div class="text-xs text-gray-500 mb-2">
                Product SKU <span class="text-gray-400">(Scan every product)</span>
              </div>

              <div class="relative">
                <input
                  ref="skuEl"
                  v-model="skuInput"
                  :disabled="skuDisabled"
                  class="w-full border border-gray-300 px-4 py-3 text-center outline-none text-sm rounded-xl bg-white disabled:bg-gray-100 disabled:cursor-not-allowed pr-11"
                  placeholder="Scan/Type SKU"
                  @keydown.enter.prevent="onSkuEnter"
                />
                <i v-if="skuVerified" class="pi pi-check-circle absolute right-3 top-1/2 -translate-y-1/2 text-green-600" />
              </div>
            </div>

            <!-- SERIAL -->
            <div class="w-full text-left">
              <div class="text-xs text-gray-500 mb-2">Product Serial Number</div>

              <div class="relative">
                <input
                  ref="serialEl"
                  v-model="serialInput"
                  :disabled="serialDisabled"
                  class="w-full border border-gray-300 px-4 py-3 text-center outline-none text-sm rounded-xl bg-white disabled:bg-gray-100 disabled:cursor-not-allowed pr-11"
                  placeholder="Scan/Type Serial"
                  @keydown.enter.prevent="onSerialEnter"
                />
                <i v-if="!serialDisabled" class="pi pi-check-circle absolute right-3 top-1/2 -translate-y-1/2 text-green-600 opacity-30" />
              </div>

              <div class="mt-2 text-[11px] text-gray-500">
                Tip: Scan SKU → then scan Serial. After saving one item, SKU is required again.
              </div>
            </div>

            <!-- LIST (Batch-wise) -->
            <div class="w-full">
              <div class="text-xs text-gray-500 mb-2">Current items ({{ store.pendingCount }} / {{ store.batchSize }})</div>

              <div class="border border-gray-200 bg-gray-50 p-3 h-40 overflow-auto text-xs rounded-2xl">
                <div
                  v-for="item in store.pendingItems"
                  :key="item.serial"
                  class="flex items-start justify-between gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 mb-2"
                >
                  <div class="flex flex-col">
                    <span class="font-semibold">SKU: {{ item.sku }}</span>
                    <span class="font-mono text-gray-600">SN: {{ item.serial }}</span>
                  </div>

                  <div class="flex items-center gap-2">
                    <i class="pi pi-check text-green-600 mt-1" />
                    <button class="text-gray-400 hover:text-red-600" @click="store.deletePendingItem(item.serial)" title="Delete">
                      <i class="pi pi-trash text-xs" />
                    </button>
                  </div>
                </div>

                <div v-if="store.pendingItems.length === 0" class="text-gray-400 text-center py-10">
                  No items in current batch
                </div>
              </div>

              <div class="mt-2 text-[11px] text-gray-500 flex justify-between">
                <span>Confirmed: <b>{{ store.confirmedCount }}</b></span>
                <span>Total scanned: <b>{{ store.current.items.length }}</b> / <b>{{ store.current.expectedQty }}</b></span>
              </div>
            </div>

            <!-- ACTION BUTTONS (unchanged) -->
            <div class="mt-4 flex flex-col gap-3 sm:hidden">
              <div class="grid grid-cols-2 gap-3">
                <button
                  class="rounded-xl py-3 text-sm text-white w-full"
                  :class="store.canConfirmBatch ? 'bg-gray-900 hover:opacity-90' : 'bg-gray-400 cursor-not-allowed'"
                  :disabled="!store.canConfirmBatch"
                  @click="store.confirmBatch()"
                >
                  Confirm Batch
                </button>

                <button
                  class="rounded-xl py-3 text-sm text-white w-full"
                  :class="store.pendingCount > 0 ? 'bg-orange-500 hover:opacity-90' : 'bg-gray-300 cursor-not-allowed'"
                  :disabled="store.pendingCount === 0"
                  @click="store.resetBatch()"
                >
                  Reset Batch
                </button>
              </div>

              <button
                v-if="store.canShowScanComplete"
                class="w-full rounded-xl bg-blue-600 text-white py-3 text-sm hover:opacity-90 disabled:opacity-50"
                :disabled="!store.canEnableScanComplete"
                @click="scanCompleteAndGoConfirm"
              >
                Scan Complete
              </button>
            </div>

            <div class="mt-6 hidden sm:flex w-full items-center justify-between gap-4">
              <div class="flex items-center gap-3">
                <button
                  class="rounded-xl py-3 text-sm text-white px-6"
                  :class="store.canConfirmBatch ? 'bg-gray-900 hover:opacity-90' : 'bg-gray-400 cursor-not-allowed'"
                  :disabled="!store.canConfirmBatch"
                  @click="store.confirmBatch()"
                >
                  Confirm Batch
                </button>

                <button
                  class="rounded-xl py-3 text-sm text-white px-6"
                  :class="store.pendingCount > 0 ? 'bg-orange-500 hover:opacity-90' : 'bg-gray-300 cursor-not-allowed'"
                  :disabled="store.pendingCount === 0"
                  @click="store.resetBatch()"
                >
                  Reset Batch
                </button>
              </div>

              <button
                v-if="store.canShowScanComplete"
                class="rounded-xl bg-blue-600 text-white py-3 text-sm hover:opacity-90 disabled:opacity-50 px-8"
                :disabled="!store.canEnableScanComplete"
                @click="scanCompleteAndGoConfirm"
              >
                Scan Complete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- CONFIRM (unchanged) -->
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
              <div class="mt-1 text-lg font-semibold">{{ confirmSummary.scanned }} / {{ confirmSummary.qty }}</div>
              <div class="text-[11px] text-gray-500 mt-1">Scanned / Expected</div>
            </div>
          </div>

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

              <div
                v-for="(item, idx) in store.current.items"
                :key="item.serial"
                class="grid grid-cols-12 px-4 py-3 text-sm border-t border-gray-200 bg-white"
              >
                <div class="col-span-1 text-gray-500">{{ idx + 1 }}</div>
                <div class="col-span-5 font-semibold">{{ item.sku }}</div>
                <div class="col-span-6 font-mono text-gray-700">{{ item.serial }}</div>
              </div>
            </div>
          </div>

          <div class="flex flex-col sm:flex-row justify-center gap-3 sm:gap-6 mt-6">
            <button class="w-full sm:w-28 rounded-xl bg-orange-500 text-white py-3 text-sm hover:opacity-90" @click="confirmResetCurrentInnerbox">
              Reset
            </button>

            <button class="w-full sm:w-44 rounded-xl bg-gray-900 text-white py-3 text-sm hover:opacity-90" @click="confirmNextInnerbox">
              Confirm & Next InnerBox
            </button>

            <button class="w-full sm:w-28 rounded-xl border border-gray-300 bg-white py-3 text-sm hover:bg-gray-50" @click="confirmAndGoHome">
              Home
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
