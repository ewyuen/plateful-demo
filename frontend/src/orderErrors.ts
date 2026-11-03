import { ApiError } from './api/client'

// What the order form shows after a failure: problems with the customer name
// (shown beside the input) and every other message (shown in an alert).
export interface OrderFormErrors {
  nameErrors: string[]
  messages: string[]
  // Problems with the delivery address (shown beside its field); left out when there are none.
  addressErrors?: string[]
}

export const NO_ERRORS: OrderFormErrors = { nameErrors: [], messages: [] }

export const GENERIC_ERROR = 'Could not place the order. Please try again.'

// DRF reports a 400 in different shapes (a list of strings, a list with one
// object per item, an object keyed by index, ...), so collect every string
// instead of assuming one shape.
function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectStrings)
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(collectStrings)
  }
  return []
}

export function describeOrderError(error: unknown): OrderFormErrors {
  const generic = { nameErrors: [], messages: [GENERIC_ERROR] }
  if (!(error instanceof ApiError) || error.status !== 400) return generic
  if (typeof error.body !== 'object' || error.body === null) return generic

  const {
    customer_name: name,
    delivery_address: address,
    ...rest
  } = error.body as Record<string, unknown>
  const nameErrors = collectStrings(name)
  const addressErrors = collectStrings(address)
  const messages = collectStrings(rest)
  if (nameErrors.length === 0 && addressErrors.length === 0 && messages.length === 0) return generic
  return { nameErrors, messages, ...(addressErrors.length > 0 ? { addressErrors } : {}) }
}
