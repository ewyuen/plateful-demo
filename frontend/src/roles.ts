import type { AuthUser } from './api/types'

// Staff are the two kitchen-side roles; a customer is signed in too, but is not staff.
export function isStaff(user: AuthUser | null): boolean {
  return user !== null && (user.role === 'fulfilment' || user.role === 'admin')
}

export function isCustomer(user: AuthUser | null): boolean {
  return user !== null && user.role === 'customer'
}
