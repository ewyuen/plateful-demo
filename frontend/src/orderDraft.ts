import type { AssistantSuggestion } from './api/types'
import { withQuantity, type Cart } from './cart'

// Everything the user has decided so far about the order they are building.
export interface OrderDraft {
  // The restaurant the cart belongs to (not the page being looked at), and its name for
  // places that have no menu loaded, such as the checkout.
  restaurantId: number | null
  restaurantName: string | null
  // The delivery fee of that restaurant as a decimal string, or null when it does not deliver.
  restaurantDeliveryFee: string | null
  cart: Cart
  customerName: string
  // A line telling the customer their kept cart was changed or removed; never kept.
  notice: string | null
}

export const initialOrderDraft: OrderDraft = {
  restaurantId: null,
  restaurantName: null,
  restaurantDeliveryFee: null,
  cart: {},
  customerName: '',
  notice: null,
}

// Actions are named for what happened, and the reducer decides what that means.
// A suggestion the page has looked up the price of in the menu it shows.
export type PricedSuggestion = AssistantSuggestion & { price?: string }

export type OrderDraftAction =
  // Starts a cart for this restaurant: the cart is emptied.
  | { type: 'restaurantChosen'; id: number; name?: string; deliveryFee?: string | null }
  | { type: 'quantitySet'; item: { id: number; name: string; price?: string }; quantity: number }
  | { type: 'nameChanged'; name: string }
  // A payment was confirmed and the server created the order: the cart and name are done with.
  | { type: 'orderPaid' }
  | { type: 'suggestionsAdded'; suggestions: PricedSuggestion[] }
  // The kept cart was checked against the restaurant's current menu (dishes by id).
  | {
      type: 'cartReconciled'
      restaurantName: string
      deliveryFee: string | null
      dishes: Record<number, { name: string; price: string }>
    }
  // The restaurant of the kept cart no longer exists.
  | { type: 'cartDiscarded' }
  | { type: 'noticeDismissed' }

export function orderDraftReducer(state: OrderDraft, action: OrderDraftAction): OrderDraft {
  switch (action.type) {
    case 'restaurantChosen':
      // The cart belongs to one restaurant, so it is emptied here and only here.
      // The customer name is kept.
      return {
        ...state,
        restaurantId: action.id,
        restaurantName: action.name ?? null,
        restaurantDeliveryFee: action.deliveryFee ?? null,
        cart: {},
      }
    case 'quantitySet':
      return {
        ...state,
        cart: withQuantity(
          state.cart,
          action.item.id,
          action.item.name,
          action.quantity,
          action.item.price,
        ),
      }
    case 'nameChanged':
      return { ...state, customerName: action.name }
    case 'suggestionsAdded':
      // The customer pressed "Add to cart": each suggested quantity is added to what the
      // cart already holds for that dish. Nothing else changes, and nothing is ordered.
      return {
        ...state,
        cart: action.suggestions.reduce(
          (cart, { menu_item, name, quantity, price }) =>
            withQuantity(
              cart,
              menu_item,
              name,
              (cart[menu_item]?.quantity ?? 0) + quantity,
              price,
            ),
          state.cart,
        ),
      }
    case 'cartReconciled': {
      const cart: Cart = {}
      const gone: string[] = []
      let changed = false
      for (const [id, entry] of Object.entries(state.cart)) {
        const dish = action.dishes[Number(id)]
        if (dish === undefined) {
          gone.push(entry.name)
          continue
        }
        // A price learned for the first time is not a surprise; a different one is.
        if (dish.name !== entry.name || (entry.price !== undefined && entry.price !== dish.price)) {
          changed = true
        }
        cart[Number(id)] = { name: dish.name, quantity: entry.quantity, price: dish.price }
      }
      if (action.deliveryFee !== state.restaurantDeliveryFee) changed = true
      const notice =
        gone.length > 0
          ? `Your saved cart was updated: ${gone.join(', ')} ${gone.length === 1 ? 'is' : 'are'} no longer available.`
          : changed
            ? 'Your saved cart was updated to the current menu.'
            : null
      return {
        ...state,
        restaurantName: action.restaurantName,
        restaurantDeliveryFee: action.deliveryFee,
        cart,
        notice,
      }
    }
    case 'cartDiscarded':
      return {
        ...state,
        restaurantId: null,
        restaurantName: null,
        restaurantDeliveryFee: null,
        cart: {},
        // The whole kept draft goes, the name too, so nothing of it stays stored.
        customerName: '',
        notice: 'Your saved cart was removed because that restaurant is no longer available.',
      }
    case 'noticeDismissed':
      return { ...state, notice: null }
    case 'orderPaid':
      // The order exists only now, so this is where the cart empties.
      return { ...state, cart: {}, customerName: '' }
  }
}
