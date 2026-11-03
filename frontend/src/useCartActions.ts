import { useState } from 'react'
import { useOrderDraft } from './orderDraftContext'
import type { AssistantSuggestion } from './api/types'

// One way to add to the cart from a restaurant's page, whether from a quantity button or
// from the assistant. A cart holds one restaurant (ADR-0016): if it holds dishes of another
// one, the change waits in `pending` until the customer confirms or keeps their cart.
type Change =
  | { kind: 'quantity'; item: { id: number; name: string; price?: string }; quantity: number }
  | { kind: 'suggestions'; suggestions: AssistantSuggestion[] }

export interface CartActions {
  quantityOf: (dishId: number) => number
  setQuantity: (item: { id: number; name: string; price?: string }, quantity: number) => void
  addSuggestions: (suggestions: AssistantSuggestion[]) => void
  // Set while the customer is being asked whether to start a new order.
  pending: boolean
  // The name of the restaurant the cart belongs to now, for the question.
  cartRestaurantName: string | null
  confirm: () => void
  keep: () => void
}

export function useCartActions(
  restaurant: { id: number; name: string; offers_delivery?: boolean; delivery_fee?: string },
  // Looks a dish's price up in the menu the page shows, so suggestions get prices too.
  priceOf: (dishId: number) => string | undefined = () => undefined,
): CartActions {
  const { state, dispatch } = useOrderDraft()
  const [pending, setPending] = useState<Change | null>(null)

  const cartIsHere = state.restaurantId === restaurant.id
  const holdsOtherDishes = !cartIsHere && Object.keys(state.cart).length > 0

  function apply(change: Change) {
    // Starting a cart for this restaurant also empties anything left of another one.
    if (!cartIsHere) {
      dispatch({
        type: 'restaurantChosen',
        id: restaurant.id,
        name: restaurant.name,
        deliveryFee: restaurant.offers_delivery ? (restaurant.delivery_fee ?? null) : null,
      })
    }
    if (change.kind === 'quantity') {
      dispatch({ type: 'quantitySet', item: change.item, quantity: change.quantity })
    } else {
      dispatch({
        type: 'suggestionsAdded',
        suggestions: change.suggestions.map((suggestion) => ({
          ...suggestion,
          price: priceOf(suggestion.menu_item),
        })),
      })
    }
  }

  function request(change: Change) {
    if (holdsOtherDishes) setPending(change)
    else apply(change)
  }

  return {
    quantityOf: (dishId) => (cartIsHere ? (state.cart[dishId]?.quantity ?? 0) : 0),
    setQuantity: (item, quantity) => request({ kind: 'quantity', item, quantity }),
    addSuggestions: (suggestions) => request({ kind: 'suggestions', suggestions }),
    pending: pending !== null,
    cartRestaurantName: state.restaurantName,
    confirm: () => {
      if (pending !== null) apply(pending)
      setPending(null)
    },
    keep: () => setPending(null),
  }
}
