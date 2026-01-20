<script setup lang="ts">
import { ref } from "vue"
import { useToast } from "primevue/usetoast"
import { useConfirm } from "primevue/useconfirm"

import Dialog from "primevue/dialog"
import DataTable from "primevue/datatable"
import Column from "primevue/column"
import Button from "primevue/button"
import InputText from "primevue/inputtext"
import InputNumber from "primevue/inputnumber"
import Checkbox from "primevue/checkbox"

import {
  adminListSessions,
  adminGetSession,
  adminUpdateSession,
  adminDeleteItem,
  adminUpdateItem,
  adminDeleteSession
} from "../../../src/api/inbounds"

import { isValidSku } from "../../../utils/skuValidator"

type SessionRow = {
  id: number
  outerBoxId: string
  innerBoxId: string
  expectedQty: number
  scannedQty: number
  status: string
  lockedSku: string | null
  confirmedAt: string | null
  lockedAt: string | null
}

type ItemRow = {
  id: number
  sku: string
  serialNumber: string
  packedBy: string
  createdAt: string
}

const toast = useToast()
const confirm = useConfirm()

// admin auth
const adminPw = ref("")
const authed = ref(false)

// table
const loading = ref(false)
const rows = ref<SessionRow[]>([])

// edit dialog
const editOpen = ref(false)
const selectedSessionId = ref<number | null>(null)
const editLoading = ref(false)
const sessionDetail = ref<SessionRow | null>(null)
const items = ref<ItemRow[]>([])

// edit form
const expectedQtyEdit = ref<number | null>(null)
const clearLockedSku = ref(false)

// edit item dialog
const editItemOpen = ref(false)
const itemEditId = ref<number | null>(null)
const skuEdit = ref("")
const serialEdit = ref("")

const dateLabel = (row: SessionRow) => row.confirmedAt ?? row.lockedAt ?? ""

async function doAuthAndLoad() {
  const pw = adminPw.value.trim()
  if (!pw) {
    toast.add({ severity: "warn", summary: "Admin", detail: "Enter admin password", life: 2000 })
    return
  }

  try {
    loading.value = true
    const r = await adminListSessions(pw)
    rows.value = r.data
    authed.value = true
    toast.add({ severity: "success", summary: "Loaded", detail: "Packages loaded", life: 1500 })
  } catch (e: any) {
    authed.value = false
    toast.add({
      severity: "error",
      summary: "Auth failed",
      detail: e?.response?.data?.error || e?.message || "Failed",
      life: 2500
    })
  } finally {
    loading.value = false
  }
}

async function openEdit(row: SessionRow) {
  const pw = adminPw.value.trim()
  if (!pw) {
    toast.add({ severity: "warn", summary: "Admin", detail: "Enter admin password", life: 2000 })
    return
  }

  selectedSessionId.value = row.id
  editOpen.value = true

  clearLockedSku.value = false
  sessionDetail.value = null
  items.value = []
  expectedQtyEdit.value = null

  try {
    editLoading.value = true
    const r = await adminGetSession(pw, row.id)

    sessionDetail.value = {
      ...r.data.session,
      scannedQty: r.data.items?.length ?? 0
    } as any

    items.value = r.data.items
    expectedQtyEdit.value = Number(r.data.session.expectedQty) || 0
  } catch (e: any) {
    toast.add({
      severity: "error",
      summary: "Load failed",
      detail: e?.response?.data?.error || e?.message || "Failed",
      life: 2500
    })
    editOpen.value = false
  } finally {
    editLoading.value = false
  }
}

function openItemEditDialog(item: ItemRow) {
  itemEditId.value = item.id
  skuEdit.value = item.sku
  serialEdit.value = item.serialNumber
  editItemOpen.value = true
}

async function refreshSelectedSession() {
  const pw = adminPw.value.trim()
  if (!pw || !selectedSessionId.value) return

  const detail = await adminGetSession(pw, selectedSessionId.value)
  sessionDetail.value = {
    ...detail.data.session,
    scannedQty: detail.data.items?.length ?? 0
  } as any
  items.value = detail.data.items
}

async function refreshList() {
  const pw = adminPw.value.trim()
  if (!pw) return
  const list = await adminListSessions(pw)
  rows.value = list.data
}

async function saveSessionEdits() {
  if (!selectedSessionId.value) return

  const pw = adminPw.value.trim()
  if (!pw) return

  try {
    editLoading.value = true

    const payload: any = {}
    if (expectedQtyEdit.value !== null) payload.expectedQty = expectedQtyEdit.value
    if (clearLockedSku.value) payload.clearLockedSku = true

    await adminUpdateSession(pw, selectedSessionId.value, payload)

    toast.add({ severity: "success", summary: "Saved", detail: "Session updated", life: 1500 })

    await refreshList()
    await refreshSelectedSession()
  } catch (e: any) {
    toast.add({
      severity: "error",
      summary: "Save failed",
      detail: e?.response?.data?.error || e?.message || "Failed",
      life: 2500
    })
  } finally {
    editLoading.value = false
  }
}

async function saveItemEdits() {
  const pw = adminPw.value.trim()
  if (!pw) return
  if (!itemEditId.value) return

  const sku = skuEdit.value.trim().toUpperCase()
  const sn = serialEdit.value.trim().toUpperCase()

  // same validations
  if (!sku || !sn) {
    toast.add({ severity: "warn", summary: "Invalid", detail: "SKU and Serial required", life: 2000 })
    return
  }
  if (!isValidSku(sku)) {
    toast.add({ severity: "error", summary: "Invalid SKU", detail: sku, life: 2500 })
    return
  }
  if (sn === sku) {
    toast.add({ severity: "error", summary: "Invalid", detail: "Serial cannot equal SKU", life: 2500 })
    return
  }

  try {
    editLoading.value = true
    await adminUpdateItem(pw, itemEditId.value, { sku, serialNumber: sn })

    toast.add({ severity: "success", summary: "Saved", detail: "Item updated", life: 1500 })
    editItemOpen.value = false

    await refreshSelectedSession()
    await refreshList()
  } catch (e: any) {
    toast.add({
      severity: "error",
      summary: "Update failed",
      detail: e?.response?.data?.error || e?.message || "Failed",
      life: 3000
    })
  } finally {
    editLoading.value = false
  }
}

async function deleteItem(itemId: number) {
  const pw = adminPw.value.trim()
  if (!pw) return

  confirm.require({
    header: "Delete Item",
    message: "Delete this scanned item?",
    icon: "pi pi-exclamation-triangle",
    acceptLabel: "Delete",
    rejectLabel: "Cancel",
    accept: async () => {
      try {
        editLoading.value = true
        await adminDeleteItem(pw, itemId)

        toast.add({ severity: "info", summary: "Deleted", detail: "Item removed", life: 1200 })

        await refreshSelectedSession()
        await refreshList()
      } catch (e: any) {
        toast.add({
          severity: "error",
          summary: "Delete failed",
          detail: e?.response?.data?.error || e?.message || "Failed",
          life: 2500
        })
      } finally {
        editLoading.value = false
      }
    }
  })
}

function confirmDeleteSession() {
  const pw = adminPw.value.trim()
  if (!pw || !selectedSessionId.value) return

  confirm.require({
    header: "Delete InnerBox",
    message: "This will delete the entire InnerBox session and ALL scanned items. Continue?",
    icon: "pi pi-exclamation-triangle",
    acceptLabel: "Yes, Delete",
    rejectLabel: "Cancel",
    accept: async () => {
      try {
        editLoading.value = true
        await adminDeleteSession(pw, selectedSessionId.value!)

        toast.add({ severity: "success", summary: "Deleted", detail: "InnerBox deleted", life: 1500 })

        editOpen.value = false
        selectedSessionId.value = null
        sessionDetail.value = null
        items.value = []

        await refreshList()
      } catch (e: any) {
        toast.add({
          severity: "error",
          summary: "Delete failed",
          detail: e?.response?.data?.error || e?.message || "Failed",
          life: 3000
        })
      } finally {
        editLoading.value = false
      }
    }
  })
}
</script>

<template>
  <div class="min-h-[calc(100vh-64px)] bg-gray-950 text-gray-100 p-4">
    <div class="max-w-6xl mx-auto">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div class="text-2xl font-semibold tracking-wide">Edit Packages</div>
          <div class="text-sm text-gray-400">Admin-only table of scanned InnerBox sessions</div>
        </div>

        <div class="flex items-center gap-2">
          <InputText v-model="adminPw" placeholder="Admin password" type="password"
            class="w-64 !bg-gray-900 !border-gray-700 !text-gray-100 rounded-xl" />
          <Button label="Load" :loading="loading" class="!rounded-xl !bg-emerald-500 !border-0 !text-gray-900"
            @click="doAuthAndLoad" />
        </div>
      </div>

      <!-- Table -->
      <div class="mt-4 bg-gray-900 border border-gray-800 rounded-2xl p-3">
        <DataTable :value="rows" :loading="loading" dataKey="id" paginator :rows="10" responsiveLayout="scroll"
          class="dark-table">
          <Column header="Date">
            <template #body="{ data }">
              <span class="text-gray-300">{{ dateLabel(data) }}</span>
            </template>
          </Column>

          <Column field="outerBoxId" header="OuterBox" />
          <Column field="innerBoxId" header="InnerBox" />

          <Column header="Qty">
            <template #body="{ data }">
              <span class="text-gray-200 font-semibold">{{ data.scannedQty }}</span>
              <span class="text-gray-400"> / {{ data.expectedQty }}</span>
            </template>
          </Column>

          <Column field="status" header="Status" />
          <Column field="lockedSku" header="Locked SKU" />

          <Column header="Actions">
            <template #body="{ data }">
              <Button label="Edit" size="small" :disabled="!authed"
                class="!rounded-xl !bg-emerald-500 !border-0 !text-gray-900"
                @click="openEdit(data)" />
            </template>
          </Column>
        </DataTable>
      </div>
    </div>

    <!-- Edit Package Dialog -->
    <Dialog v-model:visible="editOpen" modal header="Edit Package" :style="{ width: '950px' }" class="dark-dialog">
      <div v-if="editLoading" class="p-6 text-gray-400">Loading...</div>

      <div v-else-if="sessionDetail" class="space-y-4">
        <!-- Actions -->
        <div class="flex items-center justify-end gap-2">
          <Button label="Delete InnerBox" severity="danger"
            class="!rounded-xl !border-0"
            :loading="editLoading" @click="confirmDeleteSession" />
          <Button label="Save Changes"
            class="!rounded-xl !bg-emerald-500 !border-0 !text-gray-900"
            :loading="editLoading" @click="saveSessionEdits" />
        </div>

        <!-- Summary -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="bg-gray-950 border border-gray-800 rounded-2xl p-4">
            <div class="text-xs text-gray-400">OuterBox</div>
            <div class="text-lg font-semibold text-gray-100">{{ sessionDetail.outerBoxId }}</div>
          </div>
          <div class="bg-gray-950 border border-gray-800 rounded-2xl p-4">
            <div class="text-xs text-gray-400">InnerBox</div>
            <div class="text-lg font-semibold text-gray-100">{{ sessionDetail.innerBoxId }}</div>
          </div>
        </div>

        <!-- Edit fields -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <label class="text-xs text-gray-400">Expected Qty</label>
            <InputNumber v-model="expectedQtyEdit"
              class="w-full rounded-xl"
              inputClass="!bg-gray-900 !border-gray-700 !text-gray-100 rounded-xl"
              :min="0" />
          </div>

          <div class="flex items-center gap-2 sm:mt-6">
            <Checkbox v-model="clearLockedSku" :binary="true" />
            <span class="text-sm text-gray-300">Clear Locked SKU (unlock)</span>
          </div>

          <div class="text-sm text-gray-400 sm:text-right">
            Scanned: <span class="text-gray-100 font-semibold">{{ items.length }}</span>
          </div>
        </div>

        <!-- Items table -->
        <div class="border border-gray-800 rounded-2xl overflow-hidden">
          <div class="bg-gray-950 px-4 py-3 text-sm font-semibold text-gray-200">Scanned Items</div>

          <DataTable :value="items" dataKey="id" responsiveLayout="scroll" class="dark-table">
            <Column field="sku" header="SKU" />
            <Column field="serialNumber" header="Serial" />
            <Column field="packedBy" header="Packed By" />
            <Column field="createdAt" header="Created" />

            <Column header="Edit">
              <template #body="{ data }">
                <Button label="Edit" size="small"
                  class="!rounded-xl !bg-emerald-500 !border-0 !text-gray-900"
                  @click="openItemEditDialog(data)" />
              </template>
            </Column>

            <Column header="Remove">
              <template #body="{ data }">
                <Button label="Delete" severity="danger" size="small" class="!rounded-xl !border-0"
                  @click="deleteItem(data.id)" />
              </template>
            </Column>
          </DataTable>
        </div>
      </div>
    </Dialog>

    <!-- Edit Item Dialog -->
    <Dialog v-model:visible="editItemOpen" modal header="Edit Item" :style="{ width: '520px' }" class="dark-dialog">
      <div class="space-y-4">
        <div>
          <label class="text-xs text-gray-400">SKU</label>
          <InputText v-model="skuEdit"
            class="w-full !bg-gray-900 !border-gray-700 !text-gray-100 rounded-xl" />
        </div>

        <div>
          <label class="text-xs text-gray-400">Serial Number</label>
          <InputText v-model="serialEdit"
            class="w-full !bg-gray-900 !border-gray-700 !text-gray-100 rounded-xl" />
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <Button label="Cancel" severity="secondary"
            class="!rounded-xl !bg-gray-800 !border-gray-700 !text-gray-100"
            @click="editItemOpen = false" />
          <Button label="Save"
            class="!rounded-xl !bg-emerald-500 !border-0 !text-gray-900"
            :loading="editLoading"
            @click="saveItemEdits" />
        </div>
      </div>
    </Dialog>
  </div>
</template>

<style scoped>
/* Force PrimeVue to match gray UI */
:deep(.p-dialog) {
  background: #0b1220;
  border: 1px solid #1f2937;
  border-radius: 16px;
  color: #e5e7eb;
}
:deep(.p-dialog .p-dialog-header) {
  background: #111827;
  border-bottom: 1px solid #1f2937;
  color: #e5e7eb;
  padding: 14px 18px;
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
}
:deep(.p-dialog .p-dialog-content) {
  background: #0b1220;
  color: #e5e7eb;
  padding: 16px 18px;
}

/* DataTable */
:deep(.p-datatable) {
  background: transparent;
}
:deep(.p-datatable .p-datatable-thead > tr > th) {
  background: #111827;
  color: #e5e7eb;
  border-color: #1f2937;
  font-weight: 600;
}
:deep(.p-datatable .p-datatable-tbody > tr) {
  background: #0b1220;
  color: #e5e7eb;
}
:deep(.p-datatable .p-datatable-tbody > tr > td) {
  border-color: #1f2937;
}
:deep(.p-datatable .p-datatable-tbody > tr:hover) {
  background: #111827;
}

/* paginator */
:deep(.p-paginator) {
  background: transparent;
  border: none;
}
</style>
