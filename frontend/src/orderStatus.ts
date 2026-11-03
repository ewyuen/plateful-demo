import type { Order, OrderStatus } from './api/types'

// Status words as people read them; the API keeps the lower-case values.
export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

// The one forward step offered for an order, named for what it does. A ready pickup order
// is completed; a ready delivery order is sent out and then marked delivered.
export function nextStep(order: Pick<Order, 'status' | 'fulfilment_type'>): { label: string; to: OrderStatus } | undefined {
  switch (order.status) {
    case 'confirmed':
      return { label: 'Start preparing', to: 'preparing' }
    case 'preparing':
      return { label: 'Mark ready', to: 'ready' }
    case 'ready':
      return order.fulfilment_type === 'delivery'
        ? { label: 'Send out for delivery', to: 'out_for_delivery' }
        : { label: 'Mark completed', to: 'completed' }
    case 'out_for_delivery':
      return { label: 'Mark delivered', to: 'completed' }
    default:
      return undefined
  }
}

// How an order is fulfilled, in words, for cards and lists.
export function fulfilmentLine(order: Pick<Order, 'fulfilment_type' | 'delivery_address'>): string {
  return order.fulfilment_type === 'delivery' ? `Delivery to ${order.delivery_address}` : 'Pickup'
}

// The same for an order found by its code, which does not carry the address.
export function guestFulfilmentLine(order: Pick<Order, 'fulfilment_type'>): string {
  return order.fulfilment_type === 'delivery' ? 'Delivery' : 'Pickup'
}

// Orders that can still be cancelled by the kitchen.
export function canCancel(status: OrderStatus): boolean {
  return status === 'confirmed' || status === 'preparing'
}
