import { defineStore } from 'pinia'

export type InnerBox = {
  innerBoxId: string
  expectedQty: number
  sku: string
  serials: string[]
  verifiedAt: string
}

export type Session = {
  date: string
  outerBoxId: string
  innerBoxes: InnerBox[]
}

const todayISO = () => new Date().toISOString().slice(0, 10)

export const useInboundStore = defineStore('inbound', {
  state: () => ({
    session: null as Session | null,

    // current (in-progress) innerbox
    current: {
      innerBoxId: '',
      expectedQty: 0,
      sku: '' as string,
      serials: [] as string[],
    },

    error: '' as string,
    success: '' as string,
  }),

  getters: {
    date: () => todayISO(),

    scannedInnerboxesCount: (s) => s.session?.innerBoxes.length ?? 0,

    allProductsCount: (s) => {
      const done = s.session?.innerBoxes ?? []
      const doneCount = done.reduce((sum, b) => sum + b.serials.length, 0)
      return doneCount
    },

    scannedProductsCurrent: (s) => s.current.serials.length,

    // total products (done + current)
    allProductsCountIncludingCurrent(): number {
      return this.allProductsCount + this.scannedProductsCurrent
    },

    // unique serial across outerbox (recommended)
    allSerialsSet: (s) => {
      const set = new Set<string>()
      for (const b of s.session?.innerBoxes ?? []) for (const sn of b.serials) set.add(sn)
      for (const sn of s.current.serials) set.add(sn)
      return set
    },

    canGoScan: (s) => !!s.session?.outerBoxId && !!s.current.innerBoxId && s.current.expectedQty > 0,

    canGoConfirm: (s) =>
      s.current.expectedQty > 0 &&
      s.current.sku.trim().length > 0 &&
      s.current.serials.length === s.current.expectedQty,

    canFinishInnerbox(): boolean {
      // confirm button condition (same as canGoConfirm)
      return this.canGoConfirm
    },
  },

  actions: {
    clearMessages() {
      this.error = ''
      this.success = ''
    },

    startOrResumeOuterbox(outerBoxId: string) {
      const id = outerBoxId.trim()
      if (!id) {
        this.error = 'Outer Box ID is required.'
        return
      }

      // If session exists and same outerbox, keep it
      if (this.session && this.session.outerBoxId === id) {
        this.clearMessages()
        return
      }

      // Start new session for this outerbox
      this.session = {
        date: todayISO(),
        outerBoxId: id,
        innerBoxes: [],
      }

      this.resetCurrentInnerbox()
      this.clearMessages()
    },

beginInnerbox(innerBoxId: string, expectedQty: number) {
  const inner = innerBoxId.trim()
  const qty = Math.max(0, Math.floor(expectedQty))

  if (!this.session?.outerBoxId) {
    this.error = 'Start outer box session first.'
    return
  }
  if (!inner) {
    this.error = 'Inner Box ID is required.'
    return
  }
  if (!qty || qty <= 0) {
    this.error = 'Quantity must be greater than 0.'
    return
  }

  // ✅ NEW: InnerBox must be unique in the same outerbox session
  const alreadyUsed =
    this.session.innerBoxes.some(b => b.innerBoxId === inner) ||
    (this.current.innerBoxId && this.current.innerBoxId === inner) // prevents reusing current too

  if (alreadyUsed) {
    this.error = `Inner Box ID "${inner}" already exists in Outer Box "${this.session.outerBoxId}". Please scan a different Inner Box.`
    return
  }

  this.current.innerBoxId = inner
  this.current.expectedQty = qty
  this.current.sku = ''
  this.current.serials = []
  this.clearMessages()
},


    setSku(incoming: string) {
      const sku = incoming.trim()
      if (!sku) return

      // lock behavior
      if (this.current.sku && this.current.sku !== sku) {
        this.error = `SKU locked for this InnerBox: ${this.current.sku}. You entered: ${sku}`
        return
      }

      this.current.sku = sku
      this.error = ''
    },

    addSerial(incoming: string) {
      const sn = incoming.trim()
      if (!sn) return

      if (!this.current.sku.trim()) {
        this.error = 'Enter SKU first.'
        return
      }

      // prevent beyond expected qty
      if (this.current.serials.length >= this.current.expectedQty) {
        this.error = `Quantity already reached (${this.current.expectedQty}).`
        return
      }

      // unique within current innerbox
      if (this.current.serials.includes(sn)) {
        this.error = `Duplicate serial in this InnerBox: ${sn}`
        return
      }

      // unique across entire outerbox
      for (const b of this.session?.innerBoxes ?? []) {
        if (b.serials.includes(sn)) {
          this.error = `Serial already used in this OuterBox: ${sn}`
          return
        }
      }

      this.current.serials.push(sn)
      this.error = ''
    },

    removeSerial(sn: string) {
      this.current.serials = this.current.serials.filter(x => x !== sn)
    },

    confirmInnerbox() {
      if (!this.session) {
        this.error = 'No active session.'
        return false
      }
      if (!this.canFinishInnerbox) {
        this.error = 'Cannot confirm. Check SKU and scanned count.'
        return false
      }

      this.session.innerBoxes.push({
        innerBoxId: this.current.innerBoxId,
        expectedQty: this.current.expectedQty,
        sku: this.current.sku,
        serials: [...this.current.serials],
        verifiedAt: new Date().toISOString(),
      })

      this.success = 'Verified & Confirmed. Thank you!'
      this.error = ''
      return true
    },

    // resets only current innerbox (keeps saved innerboxes)
    resetCurrentInnerbox() {
      this.current = {
        innerBoxId: '',
        expectedQty: 0,
        sku: '',
        serials: [],
      }
      this.clearMessages()
    },

    // resets everything (home fresh)
    resetAll() {
      this.session = null
      this.resetCurrentInnerbox()
      this.clearMessages()
    },
  },
})
