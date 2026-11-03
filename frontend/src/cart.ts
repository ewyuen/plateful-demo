// The cart: menu item id -> what the form needs to show and send. An item whose
// quantity is 0 is not in the cart.
export interface CartEntry {
  name: string
  quantity: number
  // A decimal string such as "6.50". Missing for a dish added without a known price
  // (an assistant suggestion before the menu is loaded); a total then cannot be shown.
  price?: string
}

export type Cart = Record<number, CartEntry>

// Turns what the user typed into a quantity: a whole number of 0 or more.
// Empty, negative, decimal and non-numeric input never reaches the cart as is.
export function parseQuantity(input: string): number {
  const quantity = Number.parseInt(input, 10)
  return quantity > 0 ? quantity : 0
}

// Returns a new cart (never changes the old one) with the item set to the
// quantity; a quantity of 0 takes the item out.
export function withQuantity(
  cart: Cart,
  id: number,
  name: string,
  quantity: number,
  price?: string,
): Cart {
  const next = { ...cart }
  if (quantity > 0) {
    // A price learned earlier is kept when the new change does not know it.
    const known = price ?? cart[id]?.price
    next[id] = known === undefined ? { name, quantity } : { name, quantity, price: known }
  } else {
    delete next[id]
  }
  return next
}

// How many dishes the cart holds, counting each quantity.
export function cartCount(cart: Cart): number {
  return Object.values(cart).reduce((sum, entry) => sum + entry.quantity, 0)
}

// What one cart line costs, "13.00", or null when its price is not known.
export function lineTotal(entry: CartEntry): string | null {
  if (entry.price === undefined) return null
  return ((Math.round(Number(entry.price) * 100) * entry.quantity) / 100).toFixed(2)
}

// The total for display, as "14.50", or null when any dish has no known price or the
// cart is empty. It is added in whole cents; the server still works out the real total.
export function cartTotal(cart: Cart): string | null {
  const entries = Object.values(cart)
  if (entries.length === 0) return null
  let cents = 0
  for (const entry of entries) {
    if (entry.price === undefined) return null
    cents += Math.round(Number(entry.price) * 100) * entry.quantity
  }
  return (cents / 100).toFixed(2)
}

// The total for display with a delivery fee added ("17.50" and "3.00" give "20.50"), or null
// when the cart total is not known. The server works out the real total.
export function totalWithFee(cart: Cart, fee: string | null): string | null {
  const total = cartTotal(cart)
  if (total === null) return null
  if (fee === null) return total
  return ((Math.round(Number(total) * 100) + Math.round(Number(fee) * 100)) / 100).toFixed(2)
}
