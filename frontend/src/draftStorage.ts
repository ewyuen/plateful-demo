import type { Cart } from './cart'
import { initialOrderDraft, type OrderDraft } from './orderDraft'

// The order draft kept in the browser's local storage, so a reload does not empty the cart.
// The stored value is the only input that comes from outside the app's own code, so it is
// checked strictly, and every storage call is guarded: a browser that blocks storage, a
// full disk or a private window means "nothing is kept", never an error on the page.
export const STORAGE_KEY = 'plateful.orderDraft'
const VERSION = 1
export const MAX_AGE_MS = 24 * 60 * 60 * 1000
// A saved time this far ahead of the clock is not believable.
const CLOCK_SKEW_MS = 60 * 1000

// What is kept: the decisions the customer made. The orders-list counter and any notice
// belong to this page load only.
type Persisted = Pick<
  OrderDraft,
  'restaurantId' | 'restaurantName' | 'restaurantDeliveryFee' | 'cart' | 'customerName'
>

function store(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function remove() {
  try {
    store()?.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do: the stored copy cannot be reached either way.
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isDecimal = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{1,6}(\.\d{1,2})?$/.test(value)
const isWhole = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

function parseCart(value: unknown): Cart | null {
  if (!isRecord(value)) return null
  const cart: Cart = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[1-9]\d{0,15}$/.test(key) || !isRecord(entry)) return null
    const { name, quantity, price } = entry
    if (typeof name !== 'string' || name === '' || name.length > 255) return null
    if (!isWhole(quantity, 1, 999)) return null
    if (price !== undefined && !isDecimal(price)) return null
    cart[Number(key)] = price === undefined ? { name, quantity } : { name, quantity, price }
  }
  return cart
}

function parseDraft(value: unknown): Persisted | null {
  if (!isRecord(value)) return null
  const { restaurantId, restaurantName, restaurantDeliveryFee, cart, customerName } = value
  if (restaurantId !== null && !isWhole(restaurantId, 1, Number.MAX_SAFE_INTEGER)) return null
  if (restaurantName !== null && (typeof restaurantName !== 'string' || restaurantName.length > 255)) return null
  if (restaurantDeliveryFee !== null && !isDecimal(restaurantDeliveryFee)) return null
  if (typeof customerName !== 'string' || customerName.length > 255) return null
  const parsed = parseCart(cart)
  // Dishes with no restaurant to belong to cannot be ordered.
  if (parsed === null || (restaurantId === null && Object.keys(parsed).length > 0)) return null
  return { restaurantId, restaurantName, restaurantDeliveryFee, cart: parsed, customerName }
}

// The kept draft, or null when there is none, it is damaged or it is older than 24 hours
// (a bad or old copy is also removed, so it is not read again).
export function loadDraft(now: number = Date.now()): OrderDraft | null {
  try {
    const raw = store()?.getItem(STORAGE_KEY)
    if (raw === null || raw === undefined) return null
    const value: unknown = JSON.parse(raw)
    if (
      isRecord(value) &&
      value.version === VERSION &&
      typeof value.savedAt === 'number' &&
      value.savedAt <= now + CLOCK_SKEW_MS &&
      now - value.savedAt < MAX_AGE_MS
    ) {
      const draft = parseDraft(value.draft)
      if (draft !== null) return { ...initialOrderDraft, ...draft }
    }
  } catch {
    // Not JSON, or storage refused the read: treated as no kept draft.
  }
  remove()
  return null
}

// Keeps the draft, or removes the kept copy when there is nothing worth keeping.
export function saveDraft(draft: OrderDraft, now: number = Date.now()) {
  try {
    if (Object.keys(draft.cart).length === 0 && draft.customerName.trim() === '') {
      remove()
      return
    }
    const persisted: Persisted = {
      restaurantId: draft.restaurantId,
      restaurantName: draft.restaurantName,
      restaurantDeliveryFee: draft.restaurantDeliveryFee,
      cart: draft.cart,
      customerName: draft.customerName,
    }
    store()?.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, savedAt: now, draft: persisted }))
  } catch {
    // Storage is full or blocked: the cart still works in memory.
  }
}

export function clearDraft() {
  remove()
}
