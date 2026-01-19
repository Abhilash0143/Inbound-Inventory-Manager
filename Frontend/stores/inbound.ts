// stores/inbound.ts
import { defineStore } from "pinia";
import { isValidSku } from "../utils/skuValidator";
import { claimSession, createInboundItem, completeSession, heartbeat as apiHeartbeat } from "../src/api/inbounds";
import { resetSession } from "../src/api/inbounds";

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

    // backend session lock id (critical for realtime locking/resume)
    sessionId: null as number | null,

    // scan state flags
    scanCompleted: false as boolean,
    scanLocked: false as boolean,

    // per-item SKU validation state (NOT per innerbox)
    skuValidated: false as boolean,
   // locked for the current scan cycle only
    dbLockedSku: "" as string,
    operatorName: "" as string,

    // current (in-progress) innerbox
    current: {
      innerBoxId: "",
      expectedQty: 0,
      sku: "",
      items: [] as ScannedItem[],
    },

    error: "" as string,
    success: "" as string,
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

    // Unique serial across current+done (UI-side convenience)
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
      !s.scanLocked,
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

    clearOperator() {
      this.operatorName = "";
    },

    startOrResumeOuterbox(outerBoxId: string) {
      const id = outerBoxId.trim();
      if (!id) {
        this.error = "Outer Box ID is required.";
        return false;
      }

      // Keep existing session if same outerbox
      if (this.session && this.session.outerBoxId === id) {
        this.clearMessages();
        return true;
      }

      this.session = {
        date: todayISO(),
        outerBoxId: id,
        innerBoxes: [],
      };

      this.resetCurrentInnerbox();
      this.clearMessages();
      return true;
    },

    /**
     * ✅ Claims/resumes an innerbox session from backend.
     * - If another operator is scanning same outer+inner => 409 error (blocked)
     * - If same operator comes back => resumes scanned items
     */
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

        const { session, items } = r.data;

        // ✅ lock SKU from DB (source of truth)
        this.dbLockedSku = String(session.lockedSku ?? "").trim().toUpperCase()
        if (!this.dbLockedSku && Array.isArray(items) && items.length > 0) {
          this.dbLockedSku = String(items[0].sku ?? "").toUpperCase()
        }


        // store server lock id
        this.sessionId = session.id;

        // normalize fields (server returns camelCase)
        this.current.innerBoxId = session.innerBoxId ?? inner;
        this.current.expectedQty = session.expectedQty ?? qty;

        // load already scanned items (resume)
        this.current.items = Array.isArray(items) ? items : [];

        // reset scan-cycle sku state
        this.current.sku = "";
        this.skuValidated = false;

        // scanning is open
        this.scanLocked = false;
        this.scanCompleted = false;

        return true;
      } catch (err: any) {
        this.error = err?.response?.data?.error || err?.message || "Failed to claim session";
        return false;
      }
    },

    /**
     * ✅ SKU is per-item: must be scanned before each serial
     */
    setSku(incoming: string) {
      this.clearMessages()

      const sku = incoming.trim().toUpperCase()
      if (!sku) return false

      if (!isValidSku(sku)) {
        this.skuValidated = false
        this.error = `Invalid SKU: "${sku}"`
        return false
      }

      this.current.sku = sku
      this.skuValidated = true
      return true
    },

    /**
     * ✅ Saves each serial immediately to DB.
     * After success: resets SKU scan cycle (forces SKU again next item)
     */
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

      // ✅ No local lockedSku requirement anymore
      if (!this.skuValidated || !this.current.sku) {
        this.error = "Scan valid SKU first.";
        return false;
      }

      if (sn === this.current.sku.toUpperCase()) {
        this.error = "Serial number cannot be the same as SKU.";
        return false;
      }

      // UI duplicate check (server also enforces globally unique serial)
      if (this.current.items.some((i) => i.serial === sn)) {
        this.error = `Duplicate serial in this InnerBox: ${sn}`;
        return false;
      }

      try {
        await createInboundItem({
          sessionId: this.sessionId,
          sku: this.current.sku,          // ✅ send scanned SKU, server enforces lock
          serialNumber: sn,
          packedBy: this.operatorName,
        });

        // only push after server confirms
        this.current.items.push({ sku: this.current.sku, serial: sn }); // ✅ store scanned SKU

        // ✅ reset SKU cycle (forces SKU again next product)
        this.current.sku = "";
        this.skuValidated = false;

        return true;
      } catch (err: any) {
        // ✅ Server mismatch error (409) will land here and show in UI
        this.error = err?.response?.data?.error || err?.message || "Failed to save scan";
        return false;
      }
    },

    /**
     * ✅ Keeps session lock alive while scanning
     * Call from UI interval when step === 'SCAN'
     */
    async heartbeat() {
      if (!this.sessionId) return;
      if (!this.operatorName) return;
      try {
        await apiHeartbeat(this.sessionId, this.operatorName);
      } catch {
        // ignore silently; UI can still proceed
      }
    },

    /**
     * ✅ Server-side completion: checks qty == scanned and marks session CONFIRMED
     * This is what your "Scan Complete" should call.
     */
    async scanComplete() {
      this.clearMessages();

      if (!this.sessionId) {
        this.error = "No active session.";
        return false;
      }
      if (!this.current.innerBoxId) {
        this.error = "Inner Box ID is required.";
        return false;
      }
      if (this.current.expectedQty <= 0) {
        this.error = "Expected quantity must be greater than 0.";
        return false;
      }

      try {
        await completeSession(this.sessionId, this.operatorName);

        // lock local scanning
        this.scanLocked = true;
        this.scanCompleted = true;

        // stop SKU cycle
        this.dbLockedSku = "";
        this.current.sku = "";
        this.skuValidated = false;

        this.success = "Scan complete. Quantity matched & confirmed.";
        return true;
      } catch (err: any) {
        this.error = err?.response?.data?.error || err?.message || "Failed to complete session";
        return false;
      }
    },

    /**
     * ✅ On Confirm page: just finalize local history and reset UI
     * (DB is already saved item-by-item + session already completed)
     */
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

      // push to local session history
      this.session.innerBoxes.push({
        innerBoxId: this.current.innerBoxId,
        expectedQty: this.current.expectedQty,
        items: [...this.current.items],
        verifiedAt: new Date().toISOString(),
      });

      this.success = "Verified & Confirmed.";
      this.error = "";

      // reset current (keep outerbox session)
      this.resetCurrentInnerboxLocal();

      return true;
    },

    resetCurrentInnerboxLocal() {
      this.current = {
        innerBoxId: "",
        expectedQty: 0,
        sku: "",
        items: [],
      }

      this.sessionId = null
      this.dbLockedSku = ""
      this.skuValidated = false
      this.scanLocked = false
      this.scanCompleted = false

      this.clearMessages()
    },


    async finalizeInnerbox() {
      this.clearMessages()
      if (!this.sessionId) {
        this.error = "No active session."
        return false
      }

      try {
        await completeSession(this.sessionId, this.operatorName) // ✅ server confirm + qty check
        this.scanLocked = true
        this.scanCompleted = true
        this.success = "Confirmed successfully."
        return true
      } catch (err: any) {
        this.error = err?.response?.data?.error || err?.message || "Failed to confirm"
        return false
      }
    },
    /**
     * Resets only current innerbox state (keeps outerbox session + history)
     */
    async resetCurrentInnerbox() {
      this.clearMessages();

      // ✅ if session exists, rollback server data too
      if (this.sessionId) {
        try {
          await resetSession(this.sessionId, this.operatorName);
        } catch (err: any) {
          this.error = err?.response?.data?.error || err?.message || "Failed to reset on server";
          return false
          // even if server failed, still allow UI reset if you want
        }
      }

      // local reset
      this.current = { innerBoxId: "", expectedQty: 0, sku: "", items: [] };
      this.sessionId = null;
      this.dbLockedSku = ""
      this.skuValidated = false;
      this.scanLocked = false;
      this.scanCompleted = false;
      this.clearMessages();

      return true;
    },

    /**
     * Resets everything
     */
    resetAll() {
      this.session = null;
      this.resetCurrentInnerbox();
      this.clearMessages();
    },
  },
});
