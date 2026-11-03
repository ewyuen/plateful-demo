// Shapes of the JSON the Django API sends and accepts. They mirror
// backend/cafe/serializers.py. Money is a decimal string ("9.99"), never a number.

export interface Page<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface Restaurant {
  id: number
  name: string
  address: string
  // Cuisine, description and image link may be empty strings.
  cuisine: string
  description: string
  image_url: string
  offers_delivery: boolean
  // A decimal string such as "3.00"; "0.00" when the restaurant does not deliver.
  delivery_fee: string
}

// What the restaurant list can be narrowed by. Both go to the server, which matches
// `search` against name and cuisine and `cuisine` against the whole cuisine.
export interface RestaurantFilters {
  search?: string
  cuisine?: string
  // true narrows the list to restaurants that offer delivery.
  offersDelivery?: boolean
}

// One dish in the grouped menu. Only available dishes are sent.
export interface MenuGroupItem {
  id: number
  name: string
  description: string
  price: string
}

// A category of the grouped menu; the server calls the dishes without a category
// "Other" and gives that group no id and no position.
export interface MenuGroup {
  id: number | null
  name: string
  position: number | null
  items: MenuGroupItem[]
}

export interface RestaurantMenu {
  restaurant: Restaurant
  groups: MenuGroup[]
}

export interface MenuItem {
  id: number
  restaurant: number
  restaurant_name: string
  name: string
  description: string
  price: string
  is_available: boolean
}

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'completed'
  | 'cancelled'

export interface OrderItem {
  menu_item: number
  menu_item_name: string
  quantity: number
  unit_price: string
}

export type FulfilmentType = 'pickup' | 'delivery'

export type PaymentStatus = 'pending' | 'paid' | 'failed'

export interface Order {
  id: number
  restaurant: number
  restaurant_name: string
  customer_name: string
  status: OrderStatus
  payment_status: PaymentStatus
  paypal_order_id: string | null
  created_at: string
  items: OrderItem[]
  // Items plus the delivery fee, worked out by the server.
  total: string
  fulfilment_type: FulfilmentType
  delivery_address: string
  delivery_fee: string
}

// What completing a checkout answers: the order, and the code the buyer keeps to find it
// again (grouped as XXXX-XXXX-XXXX). No other response carries the code (ADR-0014).
export interface CompletedOrder extends Order {
  public_code: string
}

// What looking an order up by its code answers: no customer name, no delivery address and
// no order number, so a code that gets shared shows what was ordered and not who ordered it.
export interface GuestOrderItem {
  menu_item_name: string
  quantity: number
  unit_price: string
}

export interface GuestOrder {
  restaurant_name: string
  status: OrderStatus
  created_at: string
  fulfilment_type: FulfilmentType
  items: GuestOrderItem[]
  delivery_fee: string
  total: string
  public_code: string
}

// What the client sends to start a checkout. The server decides unit_price, status, created_at and total.
export interface NewOrderItem {
  menu_item: number
  quantity: number
}

export interface NewOrder {
  restaurant: number
  customer_name: string
  items: NewOrderItem[]
  // Pickup when left out. The fee is never sent: the server copies it from the restaurant.
  fulfilment_type?: FulfilmentType
  delivery_address?: string
}

// What POST /checkout/paypal/create/ answers. The amount is never sent either way:
// the server charges the total it worked out from the frozen cart.
export interface CreatedPayment {
  paypal_order_id: string
}

// The menu assistant (POST /assistant/). The conversation is held by the client and
// sent again on every question; the server stores nothing.
export interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
}

// A dish the assistant suggests. The server has already checked that it is an
// available item on the chosen restaurant's menu and took the name from the menu.
export interface AssistantSuggestion {
  menu_item: number
  name: string
  quantity: number
}

export interface AssistantReply {
  reply: string
  suggestions: AssistantSuggestion[]
}

// What the fulfilment queue can be narrowed by. Without a status the server gives the active
// orders (confirmed, preparing, ready); a status is one of the queue statuses.
export interface FulfilmentFilters {
  status?: Exclude<OrderStatus, 'pending'>
  restaurant?: number
}

// Login (ADR-0014). `role` is null for an account that may use neither the staff pages nor My orders.
export type AuthRole = 'fulfilment' | 'admin' | 'customer'

export interface AuthUser {
  username: string
  role: AuthRole | null
  // The restaurants this user works for (all of them for an admin).
  restaurants: { id: number; name: string }[]
}
