import { defineStore } from 'pinia'
import { isValidSku } from '../utils/skuValidator'


export type InnerBox = {
  innerBoxId: string
  expectedQty: number
  items: ScannedItem[]
  verifiedAt: string
}

export type Session = {
  date: string
  outerBoxId: string
  innerBoxes: InnerBox[]
}

export type ScannedItem = {
  sku: string
  serial: string
}


const todayISO = () => new Date().toISOString().slice(0, 10)


export const useInboundStore = defineStore('inbound', {
  state: () => ({
    session: null as Session | null,
    scanCompleted: false as boolean,
    skuValidated: false as boolean,
    lockedSku: '' as string,
    scanLocked: false as boolean,

    // current (in-progress) innerbox
    current: {
  innerBoxId: '',
  expectedQty: 0,
  sku: '',
  items: [] as { sku: string; serial: string }[],
},


    error: '' as string,
    success: '' as string,
  }),

  getters: {
    date: () => todayISO(),

    scannedInnerboxesCount: (s) => s.session?.innerBoxes.length ?? 0,

    allProductsCount: (s) => {
      const done = s.session?.innerBoxes ?? []
      const doneCount = done.reduce((sum, b) => sum + b.items.length, 0)
      return doneCount
    },

    scannedProductsCurrent: (s) => s.current.items.length,

    // total products (done + current)
    allProductsCountIncludingCurrent(): number {
      return this.allProductsCount + this.scannedProductsCurrent
    },

    // unique serial across outerbox (recommended)
    allSerialsSet: (s) => {
  const set = new Set<string>()
  for (const b of s.session?.innerBoxes ?? []) {
    for (const it of b.items) set.add(it.serial)
  }
  for (const it of s.current.items) set.add(it.serial)
  return set
},


    canGoScan: (s) => !!s.session?.outerBoxId && !!s.current.innerBoxId && s.current.expectedQty > 0,

    canGoConfirm: (s) => s.scanCompleted === true,



    canFinishInnerbox(): boolean {
      // confirm button condition (same as canGoConfirm)
      return this.canGoConfirm
    },

    canScanSerial: (s) =>
  !!s.current.innerBoxId &&
  s.current.expectedQty > 0 &&
  s.skuValidated &&
  !!s.current.sku,

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
this.current.items = []
this.skuValidated = false
this.lockedSku = ''
this.scanCompleted = false
this.scanLocked = false

  this.clearMessages()
},


    setSku(incoming: string) {
  const sku = incoming.trim().toUpperCase()
  if (!sku) return false

  // must be a valid SKU from list
  if (!isValidSku(sku)) {
    this.skuValidated = false
    this.error = `Invalid SKU: "${sku}"`
    return false
  }

  // first time: lock SKU for this innerbox
  if (!this.lockedSku) {
    this.lockedSku = sku
  }

  // subsequent scans: must match locked SKU
  if (sku !== this.lockedSku) {
    this.skuValidated = false
    this.error = `SKU mismatch. Locked SKU is ${this.lockedSku}. You scanned ${sku}`
    return false
  }

  // ✅ OK for this cycle
  this.current.sku = sku
  this.skuValidated = true
  this.error = ''
  return true
},



    addSerial(incoming: string) {
  const sn = incoming.trim().toUpperCase()
  if (!sn) return false

  if (!this.skuValidated || !this.lockedSku) {
  this.error = 'Scan valid SKU first.'
  return false
}


  if (!this.current.sku.trim()) {
    this.error = 'Enter SKU first.'
    return false
  }

  if (sn === this.current.sku.toUpperCase()) {
    this.error = 'Serial number cannot be the same as SKU.'
    return false
  }

  // if (this.current.items.length >= this.current.expectedQty) {
  //   this.error = `Quantity already reached (${this.current.expectedQty}).`
  //   return false
  // }

  if (this.current.items.some(i => i.serial === sn)) {
    this.error = `Duplicate serial in this InnerBox: ${sn}`
    return false
  }

  for (const b of this.session?.innerBoxes ?? []) {
  if (b.items.some(i => i.serial === sn)) {
    this.error = `Serial already used in this OuterBox: ${sn}`
    return false
  }
}


  this.current.items.push({
  sku: this.lockedSku,
  serial: sn,
})


  this.error = ''
  return true
},

scanComplete() {
    this.scanLocked = true
  if (!this.session) {
    this.error = 'No active session.'
    return false
  }

  if (!this.current.innerBoxId) {
    this.error = 'Inner Box ID is required.'
    return false
  }

  if (this.current.expectedQty <= 0) {
    this.error = 'Expected quantity must be greater than 0.'
    return false
  }

  const scanned = this.current.items.length
  const expected = this.current.expectedQty

  if (scanned !== expected) {
    this.error = `Quantity Mismatched: scanned ${scanned} of ${expected}.\n Please Reset`
    return false
  }


  this.skuValidated = false        // no more scanning
  this.current.sku = ''   
  this.scanCompleted = true
  this.error = ''
  this.success = 'Scan complete. Quantity matched.'
  return true
},

nextProduct() {
  // Move to next scan cycle (new SKU required)
  this.current.sku = ''
  this.skuValidated = false

  // ✅ DO NOT clear serials here, or you'll lose what you just saved
  // this.current.serials = []  ❌ remove this

  this.error = ''
  this.success = ''
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
  items: [...this.current.items],
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
        items: [],
      }
      this.lockedSku = ''
this.skuValidated = false
this.scanLocked = false

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
