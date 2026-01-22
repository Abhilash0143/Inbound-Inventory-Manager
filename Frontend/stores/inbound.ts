// stores/inbound.ts
import { defineStore } from "pinia";
import { isValidSku } from "../utils/skuValidator";
import {
  claimSession,
  createInboundItem,
  completeSession,
  heartbeat as apiHeartbeat,
  resetSession,
  deleteBatchItems,
  deleteInboundItems,
} from "../src/api/inbounds";

export type ScannedItem = {
  sku: string;
  serial: string;
};

export type InnerBox = {
  innerBoxId: string;
  expectedQty: number;
  items: ScannedItem[];
  verifiedAt: string;
};

export type Session = {
  date: string;
  outerBoxId: string;
  innerBoxes: InnerBox[];
};

const todayISO = () => new Date().toISOString().slice(0, 10);

export const useInboundStore = defineStore("inbound", {
  state: () => ({
    session: null as Session | null,
    sessionId: null as number | null,

    scanCompleted: false as boolean,
    scanLocked: false as boolean,

    skuValidated: false as boolean,
    dbLockedSku: "" as string,

    operatorName: "" as string,

    current: {
      innerBoxId: "",
      expectedQty: 0,
      sku: "",
      items: [] as ScannedItem[],
    },

    error: "" as string,
    success: "" as string,

    goOperatorRequested: false as boolean,
    goHomeRequested: false as boolean,

    batchSize: 5 as number,
    confirmedCount: 0 as number,
    batchLocked: false as boolean,

    qtyLocked: false as boolean,
  }),

  getters: {
    date: () => todayISO(),

    scannedInnerboxesCount: (s) => s.session?.innerBoxes.length ?? 0,

    allProductsCount: (s) => {
      const done = s.session?.innerBoxes ?? [];
      return done.reduce((sum, b) => sum + b.items.length, 0);
    },

    scannedProductsCurrent: (s) => s.current.items.length,

    allProductsCountIncludingCurrent(): number {
      return this.allProductsCount + this.scannedProductsCurrent;
    },

    allSerialsSet: (s) => {
      const set = new Set<string>();
      for (const b of s.session?.innerBoxes ?? []) for (const it of b.items) set.add(it.serial);
      for (const it of s.current.items) set.add(it.serial);
      return set;
    },

    canGoScan: (s) => !!s.session?.outerBoxId && !!s.current.innerBoxId && s.current.expectedQty > 0,
    canGoConfirm: (s) => s.scanCompleted === true,
    canFinishInnerbox(): boolean {
      return this.canGoConfirm;
    },

    canScanSerial: (s) =>
      !!s.current.innerBoxId &&
      s.current.expectedQty > 0 &&
      s.skuValidated &&
      !!s.current.sku &&
      !s.scanLocked &&
      !s.batchLocked,

    pendingCount: (s) => Math.max(0, s.current.items.length - s.confirmedCount),
    pendingItems: (s) => s.current.items.slice(s.confirmedCount),

    isBatchFull: (s) => (s.current.items.length - s.confirmedCount) >= s.batchSize,

    totalBatches(): number {
      const q = this.current.expectedQty || 0;
      return q > 0 ? Math.ceil(q / this.batchSize) : 0;
    },

    currentBatchIndex(): number {
      const total = this.totalBatches || 0;
      if (total <= 0) return 1;

      const confirmed = this.confirmedCount || 0;
      const idx = this.batchSize > 0 ? Math.floor(confirmed / this.batchSize) + 1 : 1;
      return Math.min(idx, total);
    },

    isLastBatch(): boolean {
      const total = this.totalBatches || 0;
      return total > 0 && this.currentBatchIndex === total;
    },

    canShowScanComplete(): boolean {
      return this.isLastBatch;
    },

    canEnableScanComplete(): boolean {
      const expected = this.current.expectedQty || 0;
      const scanned = this.current.items.length;
      const pending = Math.max(0, scanned - (this.confirmedCount || 0));

      return (
        expected > 0 &&
        scanned === expected &&
        pending === 0 &&
        this.isLastBatch &&
        !this.scanLocked
      );
    },

    canConfirmBatch: (s) => {
      const pending = Math.max(0, s.current.items.length - s.confirmedCount);
      return pending > 0 && pending <= s.batchSize;
    },
  },

  actions: {
    clearMessages() {
      this.error = "";
      this.success = "";
    },

    setOperator(name: string) {
      const v = name.trim();
      if (!v) {
        this.error = "Username is required.";
        return false;
      }
      this.operatorName = v;
      this.error = "";
      return true;
    },

    requestGoOperator() {
      this.goOperatorRequested = true;
    },
    clearGoOperatorRequest() {
      this.goOperatorRequested = false;
    },

    requestGoHome() {
      this.goHomeRequested = true;
    },
    clearGoHomeRequest() {
      this.goHomeRequested = false;
    },

    startOrResumeOuterbox(outerBoxId: string) {
      const id = outerBoxId.trim();
      if (!id) {
        this.error = "Outer Box ID is required.";
        return false;
      }

      if (this.session && this.session.outerBoxId === id) {
        this.clearMessages();
        return true;
      }

      this.session = {
        date: todayISO(),
        outerBoxId: id,
        innerBoxes: [],
      };

      this.resetCurrentInnerboxLocal();
      this.clearMessages();
      return true;
    },

    async beginInnerbox(innerBoxId: string, expectedQty: number) {
      this.clearMessages();

      const inner = innerBoxId.trim();
      const qty = Math.max(0, Math.floor(Number(expectedQty) || 0));

      if (!this.session?.outerBoxId) {
        this.error = "Start outer box session first.";
        return false;
      }
      if (!this.operatorName) {
        this.error = "Operator required.";
        return false;
      }
      if (!inner) {
        this.error = "Inner Box ID is required.";
        return false;
      }
      if (!qty || qty < 1) {
        this.error = "Quantity must be >= 1.";
        return false;
      }

      try {
        const r = await claimSession({
          outerBoxId: this.session.outerBoxId,
          innerBoxId: inner,
          expectedQty: qty,
          packedBy: this.operatorName,
        });
        
console.log("CLAIM SESSION RESPONSE:", r.data)
console.log("RESUMED ITEMS LENGTH:", Array.isArray(r.data?.items) ? r.data.items.length : "not-array")

        const { session, items } = r.data;

        this.dbLockedSku = String(session.lockedSku ?? "").trim().toUpperCase();
        if (!this.dbLockedSku && Array.isArray(items) && items.length > 0) {
          this.dbLockedSku = String(items[0].sku ?? "").toUpperCase();
        }

        this.sessionId = session.id;

        this.current.innerBoxId = session.innerBoxId ?? inner;
        this.current.expectedQty = session.expectedQty ?? qty;
        this.qtyLocked = true;

        this.current.items = Array.isArray(items) ? items : [];

        // ✅ resume state: everything already in DB is treated as confirmed
        this.confirmedCount = this.current.items.length;
        this.batchLocked = false;

        this.current.sku = "";
        this.skuValidated = false;

        this.scanLocked = false;
        this.scanCompleted = false;

        return true;
      } catch (err: any) {
        this.error = err?.response?.data?.error || err?.message || "Failed to claim session";
        return false;
      }
    },

    setSku(incoming: string) {
      this.clearMessages();

      const sku = incoming.trim().toUpperCase();
      if (!sku) return false;

      if (!isValidSku(sku)) {
        this.skuValidated = false;
        this.error = `Invalid SKU: "${sku}"`;
        return false;
      }

      this.current.sku = sku;
      this.skuValidated = true;
      return true;
    },

    async addSerial(incoming: string) {
      this.clearMessages();

      if (this.scanLocked) {
        this.error = "Scanning is locked. Complete or reset.";
        return false;
      }

      const sn = incoming.trim().toUpperCase();
      if (!sn) return false;

      if (!this.sessionId) {
        this.error = "No active session. Please start InnerBox again.";
        return false;
      }

      if (!this.skuValidated || !this.current.sku) {
        this.error = "Scan valid SKU first.";
        return false;
      }

      if (sn === this.current.sku.toUpperCase()) {
        this.error = "Serial number cannot be the same as SKU.";
        return false;
      }

      if (this.current.items.some((i) => i.serial === sn)) {
        this.error = `Duplicate serial in this InnerBox: ${sn}`;
        return false;
      }

      try {
        await createInboundItem({
          sessionId: this.sessionId,
          sku: this.current.sku,
          serialNumber: sn,
          packedBy: this.operatorName,
        });

        this.current.items.push({ sku: this.current.sku, serial: sn });

        // reset SKU cycle
        this.current.sku = "";
        this.skuValidated = false;

        const pending = this.current.items.length - this.confirmedCount;
        if (pending >= this.batchSize) this.batchLocked = true;

        return true;
      } catch (err: any) {
        this.error = err?.response?.data?.error || err?.message || "Failed to save scan";
        return false;
      }
    },

    async confirmBatch() {
      this.clearMessages();

      const pending = this.current.items.length - this.confirmedCount;
      if (pending <= 0) {
        this.error = "No items to confirm in the current batch.";
        return false;
      }
      if (pending > this.batchSize) {
        this.error = `Batch cannot exceed ${this.batchSize} items. Reset batch.`;
        return false;
      }

      this.confirmedCount += pending;
      this.batchLocked = false;
      this.success = "Batch confirmed.";
      return true;
    },

    async resetBatch() {
      this.clearMessages();

      if (!this.sessionId) {
        this.error = "No active session.";
        return false;
      }

      const pendingItems = this.current.items.slice(this.confirmedCount);
      if (pendingItems.length === 0) {
        this.error = "No pending batch items to reset.";
        return false;
      }

      try {
        await deleteBatchItems({
          sessionId: this.sessionId,
          packedBy: this.operatorName,
          serialNumbers: pendingItems.map((i) => i.serial),
        });

        this.current.items.splice(this.confirmedCount);
        this.batchLocked = false;

        // ✅ If this was first batch (no confirmed items), clear local locked SKU too
if (this.confirmedCount === 0) {
  this.dbLockedSku = "";
}


        this.success = "Current batch reset.";
        
        return true;
      } catch (err: any) {
        this.error = err?.response?.data?.error || err?.message || "Failed to reset batch";
        return false;
      }
    },

    // Kept for API completeness (not used in UI now)
    async deletePendingItem(serial: string) {
      this.clearMessages();

      if (!this.sessionId) {
        this.error = "No active session.";
        return false;
      }

      const idx = this.current.items.findIndex((i) => i.serial === serial);
      if (idx < 0) return false;

      if (idx < this.confirmedCount) {
        this.error = "Cannot delete confirmed items.";
        return false;
      }

      try {
        await deleteInboundItems(this.sessionId, this.operatorName, [serial]);
        this.current.items.splice(idx, 1);

        const pending = this.current.items.length - this.confirmedCount;
        if (pending < this.batchSize) this.batchLocked = false;

        this.success = "Item deleted.";
        return true;
      } catch (err: any) {
        this.error = err?.response?.data?.error || err?.message || "Failed to delete item";
        return false;
      }
    },

    async heartbeat() {
      if (!this.sessionId) return;
      if (!this.operatorName) return;
      try {
        await apiHeartbeat(this.sessionId, this.operatorName);
      } catch {
        // ignore
      }
    },

    async finalizeInnerbox() {
      this.clearMessages();
      if (!this.sessionId) {
        this.error = "No active session.";
        return false;
      }

      try {
        await completeSession(this.sessionId, this.operatorName);
        this.scanLocked = true;
        this.scanCompleted = true;
        this.success = "Confirmed successfully.";
        return true;
      } catch (err: any) {
        this.error = err?.response?.data?.error || err?.message || "Failed to confirm";
        return false;
      }
    },

    async confirmInnerbox() {
      this.clearMessages();

      if (!this.session) {
        this.error = "No active session.";
        return false;
      }
      if (!this.canFinishInnerbox) {
        this.error = "Cannot confirm. Please complete scanning first.";
        return false;
      }

      this.session.innerBoxes.push({
        innerBoxId: this.current.innerBoxId,
        expectedQty: this.current.expectedQty,
        items: [...this.current.items],
        verifiedAt: new Date().toISOString(),
      });

      this.success = "Verified & Confirmed.";
      this.error = "";

      this.resetCurrentInnerboxLocal();
      return true;
    },

    resetCurrentInnerboxLocal() {
      this.current = { innerBoxId: "", expectedQty: 0, sku: "", items: [] };
      this.sessionId = null;

      this.dbLockedSku = "";
      this.skuValidated = false;

      this.scanLocked = false;
      this.scanCompleted = false;

      this.qtyLocked = false;
      this.confirmedCount = 0;
      this.batchLocked = false;

      this.clearMessages();
    },

    async resetCurrentInnerbox() {
      this.clearMessages();

      if (this.sessionId) {
        try {
          await resetSession(this.sessionId, this.operatorName);
        } catch (err: any) {
          this.error = err?.response?.data?.error || err?.message || "Failed to reset on server";
          return false;
        }
      }

      this.resetCurrentInnerboxLocal();
      return true;
    },

    // ✅ IMPORTANT: make resetAll async so UI can await server reset
    async resetAll() {
      this.session = null;
      await this.resetCurrentInnerbox();
      this.clearMessages();
    },
  },
});
