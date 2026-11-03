import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  askAssistant,
  completeCheckout,
  attachOrder,
  getMe,
  listMyOrders,
  register,
  login,
  logout,
  getRestaurantMenu,
  listCuisines,
  listFulfilmentOrders,
  listMenuItems,
  lookupOrder,
  listRestaurants,
  startCheckout,
  transitionOrder,
} from './index'
import { ApiError } from './client'
import type {
  AssistantMessage,
  AssistantReply,
  MenuItem,
  NewOrder,
  Order,
  Page,
  Restaurant,
  RestaurantMenu,
} from './types'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_URL', '')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('listRestaurants', () => {
  const page: Page<Restaurant> = {
    count: 2,
    next: null,
    previous: null,
    results: [
      { id: 1, name: 'Corner Kitchen', address: '1 Main St', cuisine: 'Chinese', description: '', image_url: '', offers_delivery: false, delivery_fee: '0.00' },
      { id: 2, name: 'Noodle Bar', address: '2 Side St', cuisine: 'Noodles', description: '', image_url: '', offers_delivery: false, delivery_fee: '0.00' },
    ],
  }

  it('GETs the restaurants URL with the default base', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page))

    await listRestaurants()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/restaurants/')
    expect(init.method).toBe('GET')
  })

  it('GETs from the configured base URL', async () => {
    vi.stubEnv('VITE_API_URL', 'https://cafe.example/api/')
    fetchMock.mockResolvedValue(jsonResponse(page))

    await listRestaurants()

    expect(fetchMock.mock.calls[0][0]).toBe('https://cafe.example/api/restaurants/')
  })

  it('returns the page the API sent', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page))

    const result = await listRestaurants()

    expect(result).toEqual(page)
    expect(result.results).toHaveLength(2)
  })
})

describe('listMenuItems', () => {
  const page: Page<MenuItem> = {
    count: 1,
    next: null,
    previous: null,
    results: [
      {
        id: 7,
        restaurant: 3,
        restaurant_name: 'Corner Kitchen',
        name: 'Noodles',
        description: '',
        price: '9.99',
        is_available: true,
      },
    ],
  }

  it('filters by restaurant in the query string', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page))

    await listMenuItems(3)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/menu-items/?restaurant=3')
    expect(init.method).toBe('GET')
  })

  it('keeps the price as a string', async () => {
    fetchMock.mockResolvedValue(jsonResponse(page))

    const result = await listMenuItems(3)

    expect(result.results[0].price).toBe('9.99')
    expect(typeof result.results[0].price).toBe('string')
  })
})

describe('lookupOrder', () => {
  const found = {
    restaurant_name: 'Corner Kitchen',
    status: 'confirmed',
    created_at: '2026-11-01T10:00:00Z',
    fulfilment_type: 'pickup',
    items: [{ menu_item_name: 'Noodles', quantity: 2, unit_price: '9.99' }],
    delivery_fee: '0.00',
    total: '19.98',
    public_code: 'ABCD-EFGH-JKMN',
  }

  it('posts the code in the body, never in the address, and returns the order', async () => {
    fetchMock.mockResolvedValue(jsonResponse(found))

    const result = await lookupOrder('abcd-efgh-jkmn')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/orders/lookup/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ code: 'abcd-efgh-jkmn' })
    expect(String(url)).not.toMatch(/abcd/i)
    expect(result).toEqual(found)
  })

  it.each([404, 429])('turns a %i into an ApiError with its status', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'No.' }, status))

    await expect(lookupOrder('ABCD-EFGH-JKMN')).rejects.toMatchObject({ status })
  })
})

describe('startCheckout', () => {
  const newOrder: NewOrder = {
    restaurant: 1,
    customer_name: 'Sam',
    items: [{ menu_item: 7, quantity: 2 }],
  }

  it('POSTs JSON to the checkout create URL and returns the PayPal id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ paypal_order_id: 'PP-1' }))

    const result = await startCheckout(newOrder)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/checkout/paypal/create/')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(result).toEqual({ paypal_order_id: 'PP-1' })
  })

  it('sends only the restaurant, customer name and items, and never an amount', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ paypal_order_id: 'PP-1' }))

    await startCheckout(newOrder)

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent).toEqual({
      restaurant: 1,
      customer_name: 'Sam',
      items: [{ menu_item: 7, quantity: 2 }],
    })
  })

  it('turns a 400 or a 502 into an ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [{}] }, 400))
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'PayPal request failed.' }, 502))

    await expect(startCheckout(newOrder)).rejects.toMatchObject({ status: 400 })
    await expect(startCheckout(newOrder)).rejects.toBeInstanceOf(ApiError)
  })
})

describe('completeCheckout', () => {
  it('POSTs the PayPal order id to the capture URL and returns the new order', async () => {
    const paid = { id: 9, payment_status: 'paid' }
    fetchMock.mockResolvedValue(jsonResponse(paid, 201))

    const result = await completeCheckout('PP-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/checkout/paypal/capture/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ paypal_order_id: 'PP-1' })
    expect(result).toEqual(paid)
  })

  it('turns a declined payment (402) into an ApiError', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Payment failed.' }, 402))

    await expect(completeCheckout('PP-1')).rejects.toMatchObject({ status: 402 })
  })
})

describe('askAssistant', () => {
  const messages: AssistantMessage[] = [
    { role: 'user', content: 'something light' },
    { role: 'assistant', content: 'Try the dumplings.' },
    { role: 'user', content: 'and a drink?' },
  ]
  const answer: AssistantReply = {
    reply: 'Green tea goes well.',
    suggestions: [{ menu_item: 5, name: 'Green tea', quantity: 1 }],
  }

  it('POSTs the restaurant and the whole conversation to the assistant URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(answer))

    await askAssistant(3, messages)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/assistant/')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({ restaurant: 3, messages })
  })

  it('returns the reply and the suggestions', async () => {
    fetchMock.mockResolvedValue(jsonResponse(answer))

    expect(await askAssistant(3, messages)).toEqual(answer)
  })

  it.each([502, 503, 429, 400])('turns a %i answer into an ApiError with that status', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'no' }, status))

    await expect(askAssistant(3, messages)).rejects.toMatchObject({ status })
    await expect(askAssistant(3, messages)).rejects.toBeInstanceOf(ApiError)
  })

  it('passes the abort signal on to fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse(answer))
    const controller = new AbortController()

    await askAssistant(3, messages, controller.signal)

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })
})

describe('listRestaurants filters', () => {
  const empty: Page<Restaurant> = { count: 0, next: null, previous: null, results: [] }

  it('sends search and cuisine as query parameters', async () => {
    fetchMock.mockResolvedValue(jsonResponse(empty))

    await listRestaurants({ search: 'wok', cuisine: 'Cantonese' })

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://localhost:8000/api/restaurants/?search=wok&cuisine=Cantonese',
    )
  })

  it('encodes spaces and leaves blank filters out', async () => {
    fetchMock.mockResolvedValue(jsonResponse(empty))

    await listRestaurants({ search: '  dim sum ', cuisine: '   ' })

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/api/restaurants/?search=dim+sum')
  })

  it('sends offers_delivery only when delivery is wanted', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(empty))

    await listRestaurants({ cuisine: 'Noodles', offersDelivery: true })
    await listRestaurants({ offersDelivery: false })

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://localhost:8000/api/restaurants/?cuisine=Noodles&offers_delivery=true',
    )
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:8000/api/restaurants/')
  })

  it('passes the abort signal after the filters', async () => {
    fetchMock.mockResolvedValue(jsonResponse(empty))
    const controller = new AbortController()

    await listRestaurants({}, controller.signal)

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/api/restaurants/')
  })
})

describe('listCuisines', () => {
  it('GETs the cuisines list and returns the strings', async () => {
    fetchMock.mockResolvedValue(jsonResponse(['Café', 'Chinese']))

    const result = await listCuisines()

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/api/restaurants/cuisines/')
    expect(result).toEqual(['Café', 'Chinese'])
  })
})

describe('getRestaurantMenu', () => {
  const menu: RestaurantMenu = {
    restaurant: { id: 6, name: 'Spice Lane', address: '21 Lantern Way', cuisine: 'Sichuan', description: '', image_url: '', offers_delivery: false, delivery_fee: '0.00' },
    groups: [
      { id: 15, name: 'Starters', position: 1, items: [{ id: 39, name: 'Spicy Cucumber', description: '', price: '5.50' }] },
      { id: null, name: 'Other', position: null, items: [] },
    ],
  }

  it('GETs the menu of that restaurant and returns the groups', async () => {
    fetchMock.mockResolvedValue(jsonResponse(menu))

    const result = await getRestaurantMenu(6)

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/api/restaurants/6/menu/')
    expect(result).toEqual(menu)
  })

  it('turns a 404 into an ApiError with the status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Not found.' }, 404))

    await expect(getRestaurantMenu(9999)).rejects.toMatchObject({ name: 'ApiError', status: 404 })
  })
})

describe('listFulfilmentOrders', () => {
  const empty: Page<Order> = { count: 0, next: null, previous: null, results: [] }

  it('GETs the plain queue when no filter is set', async () => {
    fetchMock.mockResolvedValue(jsonResponse(empty))

    await listFulfilmentOrders()

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/api/fulfilment/orders/')
  })

  it('sends the status and the restaurant as query parameters', async () => {
    fetchMock.mockResolvedValue(jsonResponse(empty))

    await listFulfilmentOrders({ status: 'completed', restaurant: 3 })

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://localhost:8000/api/fulfilment/orders/?status=completed&restaurant=3',
    )
  })

  it('passes the abort signal', async () => {
    fetchMock.mockResolvedValue(jsonResponse(empty))
    const controller = new AbortController()

    await listFulfilmentOrders({}, controller.signal)

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })
})

describe('transitionOrder', () => {
  it('POSTs the target status to the order and returns the order', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 42, status: 'preparing' }))

    const result = await transitionOrder(42, 'preparing')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/orders/42/transition/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ status: 'preparing' })
    expect(result).toMatchObject({ id: 42, status: 'preparing' })
  })

  it('turns a 409 into an ApiError with the status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'no', allowed: ['ready'] }, 409))

    await expect(transitionOrder(42, 'preparing')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
    })
  })
})

describe('staff login', () => {
  const cook = { username: 'cook', role: 'fulfilment', restaurants: [{ id: 1, name: 'Corner Kitchen' }] }

  it('getMe asks who is signed in and answers the user', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: cook }))

    const user = await getMe()

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/api/auth/me/')
    expect(user).toEqual(cook)
  })

  it('getMe answers null when nobody is signed in', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user: null }))

    expect(await getMe()).toBeNull()
  })

  it('login posts the username and password and answers the user', async () => {
    fetchMock.mockResolvedValue(jsonResponse(cook))

    const user = await login('cook', 'secret')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/auth/login/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ username: 'cook', password: 'secret' })
    expect(user).toEqual(cook)
  })

  it('login turns a refusal into an ApiError with the status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Wrong username or password.' }, 400))

    await expect(login('cook', 'nope')).rejects.toMatchObject({ status: 400 })
  })

  it('logout posts to the logout address', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await logout()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/auth/logout/')
    expect(init.method).toBe('POST')
  })
})

describe('customer accounts', () => {
  const shopper = { username: 'shopper', role: 'customer', restaurants: [] }
  const order = { restaurant_name: 'Corner Kitchen', public_code: 'ABCD-EFGH-JKMN' }

  it('register posts the username and password and answers the user', async () => {
    fetchMock.mockResolvedValue(jsonResponse(shopper, 201))

    const user = await register('shopper', 'a-good-password-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/auth/register/')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ username: 'shopper', password: 'a-good-password-1' })
    expect(init.credentials).toBe('include')
    expect(user).toEqual(shopper)
  })

  it('register keeps the status and the server words of a refusal', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'That username is taken.' }, 400))

    await expect(register('shopper', 'x')).rejects.toMatchObject({
      status: 400,
      body: { detail: 'That username is taken.' },
    })
  })

  it('attachOrder posts the code in the body and never in the address', async () => {
    fetchMock.mockResolvedValue(jsonResponse(order))

    const answer = await attachOrder('ABCD-EFGH-JKMN')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/my-orders/attach/')
    expect(url).not.toContain('ABCD')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ code: 'ABCD-EFGH-JKMN' })
    expect(answer).toEqual(order)
  })

  it('attachOrder turns a 404 into an ApiError', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'No order was found for that code.' }, 404))

    await expect(attachOrder('ZZZZ-ZZZZ-ZZZZ')).rejects.toMatchObject({ status: 404 })
  })

  it('listMyOrders reads the list with the session cookie', async () => {
    fetchMock.mockResolvedValue(jsonResponse([order]))

    const orders = await listMyOrders()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/my-orders/')
    expect(init.credentials).toBe('include')
    expect(orders).toEqual([order])
  })
})
