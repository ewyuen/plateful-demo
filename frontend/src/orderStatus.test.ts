import { describe, expect, it } from 'vitest'
import type { OrderStatus } from './api/types'
import { canCancel, fulfilmentLine, nextStep, STATUS_LABELS } from './orderStatus'

describe('orderStatus', () => {
  it('names every status in words', () => {
    expect(STATUS_LABELS.confirmed).toBe('Confirmed')
    expect(Object.keys(STATUS_LABELS)).toHaveLength(7)
    expect(STATUS_LABELS.out_for_delivery).toBe('Out for delivery')
  })

  it('offers one forward step for confirmed, preparing and ready orders', () => {
    const pickup = (status: OrderStatus) => nextStep({ status, fulfilment_type: 'pickup' })
    expect(pickup('confirmed')).toEqual({ label: 'Start preparing', to: 'preparing' })
    expect(pickup('preparing')).toEqual({ label: 'Mark ready', to: 'ready' })
    expect(pickup('ready')).toEqual({ label: 'Mark completed', to: 'completed' })
    expect(pickup('completed')).toBeUndefined()
    expect(pickup('cancelled')).toBeUndefined()
    expect(pickup('pending')).toBeUndefined()
  })

  it('sends a ready delivery order out and then marks it delivered', () => {
    expect(nextStep({ status: 'ready', fulfilment_type: 'delivery' })).toEqual({
      label: 'Send out for delivery',
      to: 'out_for_delivery',
    })
    expect(nextStep({ status: 'out_for_delivery', fulfilment_type: 'delivery' })).toEqual({
      label: 'Mark delivered',
      to: 'completed',
    })
  })

  it('names how an order is fulfilled', () => {
    expect(fulfilmentLine({ fulfilment_type: 'pickup', delivery_address: '' })).toBe('Pickup')
    expect(fulfilmentLine({ fulfilment_type: 'delivery', delivery_address: '5 Elm Road' })).toBe(
      'Delivery to 5 Elm Road',
    )
  })

  it('lets confirmed and preparing orders be cancelled, nothing else', () => {
    expect(canCancel('confirmed')).toBe(true)
    expect(canCancel('preparing')).toBe(true)
    expect(['pending', 'ready', 'out_for_delivery', 'completed', 'cancelled'].some((s) => canCancel(s as never))).toBe(false)
  })
})
