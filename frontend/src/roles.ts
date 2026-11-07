import type { AuthUser } from './api/types'

// Staff are the two kitchen-side roles; a customer is signed in too, but is not staff.
export function isStaff(user: AuthUser | null): boolean {
  return user !== null && (user.role === 'fulfilment' || user.role === 'admin')
}

export function isCustomer(user: AuthUser | null): boolean {
  return user !== null && user.role === 'customer'
}

// The boss: the owner role (ADR-0020). The owner is not staff and sees the dashboard only; an admin does
// not. The server is the real guard.
export function isOwner(user: AuthUser | null): boolean {
  return user !== null && user.role === 'owner'
}
