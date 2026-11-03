import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { getRestaurantMenu } from '../api'
import { ApiError } from '../api/client'
import { loadDraft, saveDraft } from '../draftStorage'
import { initialOrderDraft, orderDraftReducer, type OrderDraft } from '../orderDraft'
import { OrderDraftContext } from '../orderDraftContext'

interface OrderDraftProviderProps {
  children: ReactNode
  // Lets a test start from a given draft and skip the kept one; the app passes nothing and
  // starts from the draft kept in this browser, if there is a good one.
  initialState?: OrderDraft
}

function OrderDraftProvider({ children, initialState }: OrderDraftProviderProps) {
  // The draft kept in this browser, read once. A draft given explicitly (a test) wins and
  // nothing is read.
  const [kept] = useState(() => (initialState === undefined ? loadDraft() : null))
  const [state, dispatch] = useReducer(orderDraftReducer, initialState ?? kept ?? initialOrderDraft)
  // Set while a kept cart still has to be checked against the menu.
  const restored = useRef(kept !== null && Object.keys(kept.cart).length > 0)

  // Keep what the customer decided. The copy loaded above is not written back, so a reload
  // does not extend its 24 hours; only a change does.
  const saved = useRef(state)
  useEffect(() => {
    const before = saved.current
    if (
      before.restaurantId === state.restaurantId &&
      before.restaurantName === state.restaurantName &&
      before.restaurantDeliveryFee === state.restaurantDeliveryFee &&
      before.cart === state.cart &&
      before.customerName === state.customerName
    ) {
      return
    }
    saved.current = state
    saveDraft(state)
  }, [state])

  // A kept cart may be out of date: check it once against the restaurant's current menu so
  // the prices and total on screen are what will be charged.
  const restaurantId = state.restaurantId
  useEffect(() => {
    if (!restored.current || restaurantId === null) return
    const controller = new AbortController()
    getRestaurantMenu(restaurantId, controller.signal).then(
      (menu) => {
        restored.current = false
        const dishes: Record<number, { name: string; price: string }> = {}
        for (const group of menu.groups) {
          for (const item of group.items) dishes[item.id] = { name: item.name, price: item.price }
        }
        dispatch({
          type: 'cartReconciled',
          restaurantName: menu.restaurant.name,
          deliveryFee: menu.restaurant.offers_delivery ? menu.restaurant.delivery_fee : null,
          dishes,
        })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        // Only a restaurant that is gone clears the cart; being offline keeps it as it is.
        if (error instanceof ApiError && error.status === 404) {
          restored.current = false
          dispatch({ type: 'cartDiscarded' })
        }
      },
    )
    return () => controller.abort()
    // The check belongs to the first render only: the cart it checks is the kept one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <OrderDraftContext value={{ state, dispatch }}>{children}</OrderDraftContext>
}

export default OrderDraftProvider
