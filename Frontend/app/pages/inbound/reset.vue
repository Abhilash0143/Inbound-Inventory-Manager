<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from "vue";
import { useInboundStore } from "../../../stores/inbound";
import { useToast } from "primevue/usetoast";
import { useConfirm } from "primevue/useconfirm";
import { deleteSessionByBox } from "../../../src/api/inbounds";
import { useRouter } from "vue-router";

const router = useRouter();

function goHome() {
  store.requestGoHome();
  router.push("/"); // ✅ your main inbound page route
}



type VerifyStage = "EMPTY" | "FIRST" | "CONFIRMED";

const store = useInboundStore();
const toast = useToast();
const confirm = useConfirm();

const busy = ref(false);

// inputs
const outerBoxInput = ref("");
const outerConfirmInput = ref("");
const innerBoxInput = ref("");
const innerConfirmInput = ref("");

// refs
const outerEl = ref<HTMLInputElement | null>(null);
const outerConfirmEl = ref<HTMLInputElement | null>(null);
const innerEl = ref<HTMLInputElement | null>(null);
const innerConfirmEl = ref<HTMLInputElement | null>(null);

// stages
const outerStage = ref<VerifyStage>("EMPTY");
const innerStage = ref<VerifyStage>("EMPTY");

const outerFirst = ref("");
const innerFirst = ref("");

const outerVerified = computed(() => outerStage.value === "CONFIRMED");
const innerVerified = computed(() => innerStage.value === "CONFIRMED");

const canDelete = computed(() => {
  return !!store.operatorName && outerVerified.value && innerVerified.value && !busy.value;
});

function clearAll() {
  outerBoxInput.value = "";
  outerConfirmInput.value = "";
  innerBoxInput.value = "";
  innerConfirmInput.value = "";
  outerStage.value = "EMPTY";
  innerStage.value = "EMPTY";
  outerFirst.value = "";
  innerFirst.value = "";
  nextTick(() => outerEl.value?.focus());
}

// Outer verify
function verifyOuterFirst() {
  const v = outerBoxInput.value.trim();
  if (!v) return;

  outerFirst.value = v;
  outerStage.value = "FIRST";
  outerBoxInput.value = v;
  outerConfirmInput.value = "";

  toast.add({ severity: "info", summary: "Confirm", detail: "Scan Outer Box again to confirm.", life: 1400 });
  nextTick(() => outerConfirmEl.value?.focus());
}

function verifyOuterConfirm() {
  const v = outerConfirmInput.value.trim();
  if (!v) return;

  if (v !== outerFirst.value) {
    toast.add({ severity: "error", summary: "Mismatch", detail: "Outer Box mismatch. Try again.", life: 2200 });
    outerConfirmInput.value = "";
    nextTick(() => outerConfirmEl.value?.focus());
    return;
  }

  outerStage.value = "CONFIRMED";
  toast.add({ severity: "success", summary: "Confirmed", detail: "Outer Box confirmed.", life: 1000 });
  nextTick(() => innerEl.value?.focus());
}

// Inner verify
function verifyInnerFirst() {
  const v = innerBoxInput.value.trim();
  if (!v) return;

  innerFirst.value = v;
  innerStage.value = "FIRST";
  innerBoxInput.value = v;
  innerConfirmInput.value = "";

  toast.add({ severity: "info", summary: "Confirm", detail: "Scan Inner Box again to confirm.", life: 1400 });
  nextTick(() => innerConfirmEl.value?.focus());
}

function verifyInnerConfirm() {
  const v = innerConfirmInput.value.trim();
  if (!v) return;

  if (v !== innerFirst.value) {
    toast.add({ severity: "error", summary: "Mismatch", detail: "Inner Box mismatch. Try again.", life: 2200 });
    innerConfirmInput.value = "";
    nextTick(() => innerConfirmEl.value?.focus());
    return;
  }

  innerStage.value = "CONFIRMED";
  toast.add({ severity: "success", summary: "Confirmed", detail: "Inner Box confirmed.", life: 1000 });
}

async function deleteNow() {
  if (!store.operatorName) {
    toast.add({ severity: "warn", summary: "Operator Missing", detail: "Login with operator name first.", life: 2000 });
    return;
  }
  if (!outerVerified.value || !innerVerified.value) {
    toast.add({ severity: "warn", summary: "Incomplete", detail: "Confirm OuterBox and InnerBox first.", life: 2000 });
    return;
  }

  const outer = outerBoxInput.value.trim();
  const inner = innerBoxInput.value.trim();

  confirm.require({
    header: "Delete Box",
    message: `Delete ALL scans for OuterBox "${outer}" and InnerBox "${inner}"?`,
    icon: "pi pi-exclamation-triangle",
    acceptLabel: "Yes, Delete",
    rejectLabel: "Cancel",
    accept: async () => {
      busy.value = true;
      try {
        const r = await deleteSessionByBox({
          outerBoxId: outer,
          innerBoxId: inner,
          packedBy: store.operatorName,
        });

        toast.add({
          severity: "success",
          summary: "Deleted",
          detail: `Deleted session ${r.data.sessionId} (${r.data.status}). Items removed: ${r.data.deletedItems}`,
          life: 2500,
        });

        // optional: clear any current scanning state
        store.resetCurrentInnerboxLocal?.();

        clearAll();
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.response?.data?.details || err?.message || "Delete failed";
        toast.add({ severity: "error", summary: "Delete Failed", detail: msg, life: 3500 });
      } finally {
        busy.value = false;
      }
    },
  });
}


onMounted(() => {
  if (!store.operatorName) {
    toast.add({
      severity: "error",
      summary: "Operator Required",
      detail: "Please login with operator name before deleting a box.",
      life: 3000,
    });

    // ✅ optional: send them to operator page
    // change the route to your actual operator/login route
    router.push("/"); 
  } else {
    nextTick(() => outerEl.value?.focus());
  }
});

</script>

<template>
  <div class="text-gray-900 w-full bg-gray-50 min-h-[calc(100vh-64px)] px-4 py-6">
    <div class="mx-auto max-w-lg">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-lg font-semibold tracking-wide">Delete Scanned Box</div>
          <div class="text-sm text-gray-500 mt-1">
            Scan and confirm OuterBox + InnerBox.
          </div>
        </div>

        <div class="text-xs text-gray-500">
          Operator:
          <span class="font-semibold text-gray-800">{{ store.operatorName || "—" }}</span>
        </div>
      </div>

      <div class="mt-6 bg-white border border-gray-200 rounded-2xl shadow-sm p-5 sm:p-6">
        <!-- OUTER -->
        <div class="w-full text-left">
          <div class="text-xs text-gray-500 mb-2">Scan or Type the Outer Box ID</div>

          <div class="relative">
            <input
              ref="outerEl"
              v-model="outerBoxInput"
              :disabled="outerStage !== 'EMPTY' || outerVerified || busy"
              class="w-full border border-gray-300 px-4 py-3 text-center outline-none rounded-xl bg-white disabled:bg-gray-100 disabled:cursor-not-allowed pr-11"
              placeholder="Outer Box ID"
              @keydown.enter.prevent="verifyOuterFirst"
            />
            <i v-if="outerStage !== 'EMPTY'" class="pi pi-check-circle absolute right-3 top-1/2 -translate-y-1/2 text-green-600" />
          </div>

          <div v-if="outerStage === 'FIRST'" class="text-xs text-blue-600 mt-3 mb-2">Confirm Outer Box ID (scan again)</div>

          <div v-if="outerStage === 'FIRST'" class="relative">
            <input
              ref="outerConfirmEl"
              v-model="outerConfirmInput"
              :disabled="busy"
              class="w-full border border-gray-300 px-4 py-3 text-center outline-none rounded-xl bg-white disabled:bg-gray-100 disabled:cursor-not-allowed pr-11"
              placeholder="Confirm Outer Box ID"
              @keydown.enter.prevent="verifyOuterConfirm"
            />
          </div>
        </div>

        <!-- INNER -->
        <div class="w-full text-left mt-6">
          <div class="text-xs text-gray-500 mb-2">Scan or Type the Inner Box ID</div>

          <div class="relative">
            <input
              ref="innerEl"
              v-model="innerBoxInput"
              :disabled="!outerVerified || innerStage !== 'EMPTY' || innerVerified || busy"
              class="w-full border border-gray-300 px-4 py-3 text-center outline-none rounded-xl bg-white disabled:bg-gray-100 disabled:cursor-not-allowed pr-11"
              placeholder="Inner Box ID"
              @keydown.enter.prevent="verifyInnerFirst"
            />
            <i v-if="innerStage !== 'EMPTY'" class="pi pi-check-circle absolute right-3 top-1/2 -translate-y-1/2 text-green-600" />
          </div>

          <div v-if="innerStage === 'FIRST'" class="text-xs text-blue-600 mt-3 mb-2">Confirm Inner Box ID (scan again)</div>

          <div v-if="innerStage === 'FIRST'" class="relative">
            <input
              ref="innerConfirmEl"
              v-model="innerConfirmInput"
              :disabled="busy"
              class="w-full border border-gray-300 px-4 py-3 text-center outline-none rounded-xl bg-white disabled:bg-gray-100 disabled:cursor-not-allowed pr-11"
              placeholder="Confirm Inner Box ID"
              @keydown.enter.prevent="verifyInnerConfirm"
            />
          </div>
        </div>

        <!-- ACTIONS -->
        <div class="flex flex-col sm:flex-row justify-end gap-3 mt-8">
  <button
    class="w-full sm:w-36 rounded-xl py-3 text-sm text-white"
    :class="canDelete ? 'bg-red-600 hover:opacity-90' : 'bg-gray-400 cursor-not-allowed'"
    :disabled="!canDelete"
    @click="deleteNow"
  >
    {{ busy ? "Deleting..." : "Delete Box" }}
  </button>

  <button
    class="w-full sm:w-28 rounded-xl border border-gray-300 bg-white py-3 text-sm hover:bg-gray-50"
    :disabled="busy"
    @click="clearAll"
  >
    Clear
  </button>

  <button
    class="w-full sm:w-28 rounded-xl border border-gray-300 bg-white py-3 text-sm hover:bg-gray-50"
    :disabled="busy"
    @click="goHome"
  >
    Home
  </button>
</div>


        <div class="mt-4 text-[11px] text-gray-500">
          Note: If another operator is actively scanning and the lock lease has not expired, delete will be blocked.
        </div>
      </div>
    </div>
  </div>
</template>
