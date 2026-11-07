import { request } from './client'
import type {
  AssistantMessage,
  AuthUser,
  CompletedOrder,
  DashboardOrders,
  GuestOrder,
  AssistantReply,
  CreatedPayment,
  FulfilmentFilters,
  MenuItem,
  NewOrder,
  Order,
  OrderStatus,
  Page,
  Restaurant,
  RestaurantFilters,
  RestaurantMenu,
} from './types'

// Blank filters are left out, so the address stays the plain list when nothing is set.
export function listRestaurants(
  filters: RestaurantFilters = {},
  signal?: AbortSignal,
): Promise<Page<Restaurant>> {
  const query = new URLSearchParams()
  if (filters.search?.trim()) query.set('search', filters.search.trim())
  if (filters.cuisine?.trim()) query.set('cuisine', filters.cuisine.trim())
  if (filters.offersDelivery) query.set('offers_delivery', 'true')
  const suffix = query.size > 0 ? `?${query}` : ''
  return request<Page<Restaurant>>(`/restaurants/${suffix}`, { signal })
}

// The distinct cuisines of all restaurants, for the filter chips.
export function listCuisines(signal?: AbortSignal): Promise<string[]> {
  return request<string[]>('/restaurants/cuisines/', { signal })
}

// One restaurant and its available dishes grouped by category, in a single request.
export function getRestaurantMenu(id: number, signal?: AbortSignal): Promise<RestaurantMenu> {
  return request<RestaurantMenu>(`/restaurants/${id}/menu/`, { signal })
}

export function listMenuItems(
  restaurantId: number,
  signal?: AbortSignal,
): Promise<Page<MenuItem>> {
  const query = new URLSearchParams({ restaurant: String(restaurantId) })
  return request<Page<MenuItem>>(`/menu-items/?${query}`, { signal })
}

// Starts paying for this cart: the server checks it, freezes the prices and creates the
// PayPal order for the total it works out. No order exists yet, and the amount is never
// sent. Answers the PayPal order id for the PayPal buttons to open.
export function startCheckout(order: NewOrder, signal?: AbortSignal): Promise<CreatedPayment> {
  return request<CreatedPayment>('/checkout/paypal/create/', { method: 'POST', body: order, signal })
}

// Finishes paying after the customer approved at PayPal. The server captures the payment
// and, only if PayPal confirms it, creates the order and answers it (paid). A declined
// payment or an unreachable PayPal is an ApiError (402 or 502) and no order exists.
export function completeCheckout(paypalOrderId: string, signal?: AbortSignal): Promise<CompletedOrder> {
  return request<CompletedOrder>('/checkout/paypal/capture/', {
    method: 'POST',
    body: { paypal_order_id: paypalOrderId },
    signal,
  })
}

// Asks the assistant about this restaurant's menu. `messages` is the whole conversation
// so far and must end with the customer's question. It answers with a reply and dishes
// to suggest; it never places an order.
export function askAssistant(
  restaurantId: number,
  messages: AssistantMessage[],
  signal?: AbortSignal,
): Promise<AssistantReply> {
  return request<AssistantReply>('/assistant/', {
    method: 'POST',
    body: { restaurant: restaurantId, messages },
    signal,
  })
}

// The orders restaurants have to work on, from every restaurant (open in alpha2). Filters
// that are not set are left out of the address.
export function listFulfilmentOrders(
  filters: FulfilmentFilters = {},
  signal?: AbortSignal,
): Promise<Page<Order>> {
  const query = new URLSearchParams()
  if (filters.status) query.set('status', filters.status)
  if (filters.restaurant !== undefined) query.set('restaurant', String(filters.restaurant))
  const suffix = query.size > 0 ? `?${query}` : ''
  return request<Page<Order>>(`/fulfilment/orders/${suffix}`, { signal })
}

// Every restaurant's paid orders, for the admin dashboard (admin only, S34).
export function listDashboardOrders(signal?: AbortSignal): Promise<DashboardOrders> {
  return request<DashboardOrders>('/dashboard/orders/', { signal })
}

// Moves an order to its next step. A step that is not allowed (often because someone else
// just moved the order) is an ApiError with status 409.
export function transitionOrder(
  orderId: number,
  status: OrderStatus,
  signal?: AbortSignal,
): Promise<Order> {
  return request<Order>(`/orders/${orderId}/transition/`, {
    method: 'POST',
    body: { status },
    signal,
  })
}

// Finds an order by the code its buyer was given. The code goes in the body, never in the
// address. Answers 404 for any code that is wrong or unknown, and 429 for too many tries.
export function lookupOrder(code: string, signal?: AbortSignal): Promise<GuestOrder> {
  return request<GuestOrder>('/orders/lookup/', { method: 'POST', body: { code }, signal })
}

// Who is signed in, or null. Also makes the server set the CSRF cookie, which signing in needs.
export async function getMe(signal?: AbortSignal): Promise<AuthUser | null> {
  const answer = await request<{ user: AuthUser | null }>('/auth/me/', { signal })
  return answer.user ?? null
}

// Signs staff in. A wrong username or password is an ApiError with status 400, an account
// that may not use the staff pages 403, and too many attempts 429.
export function login(username: string, password: string, signal?: AbortSignal): Promise<AuthUser> {
  return request<AuthUser>('/auth/login/', { method: 'POST', body: { username, password }, signal })
}

export function logout(signal?: AbortSignal): Promise<void> {
  return request<void>('/auth/logout/', { method: 'POST', signal })
}

// Makes a customer account and signs it in (ADR-0014). A refusal (a taken username, a weak
// password) is an ApiError with status 400 and the server's words in `detail`; too many
// attempts is 429.
export function register(username: string, password: string, signal?: AbortSignal): Promise<AuthUser> {
  return request<AuthUser>('/auth/register/', { method: 'POST', body: { username, password }, signal })
}

// Adds the order with this code to the signed-in customer's account. The first claim wins:
// a code that is wrong, unknown or already taken is the same ApiError with status 404.
export function attachOrder(code: string, signal?: AbortSignal): Promise<GuestOrder> {
  return request<GuestOrder>('/my-orders/attach/', { method: 'POST', body: { code }, signal })
}

// The signed-in customer's own orders, newest first, in the same shape as a lookup.
export function listMyOrders(signal?: AbortSignal): Promise<GuestOrder[]> {
  return request<GuestOrder[]>('/my-orders/', { signal })
}
