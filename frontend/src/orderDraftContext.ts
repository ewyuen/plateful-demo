import { createContext, useContext, type Dispatch } from 'react'
import type { OrderDraft, OrderDraftAction } from './orderDraft'

export interface OrderDraftContextValue {
  state: OrderDraft
  dispatch: Dispatch<OrderDraftAction>
}

export const OrderDraftContext = createContext<OrderDraftContextValue | null>(null)

// The only way components read the draft. Throwing here gives a clear message
// instead of a confusing "cannot read properties of null" further down.
export function useOrderDraft(): OrderDraftContextValue {
  const value = useContext(OrderDraftContext)
  if (value === null) {
    throw new Error('useOrderDraft must be used inside an OrderDraftProvider')
  }
  return value
}
