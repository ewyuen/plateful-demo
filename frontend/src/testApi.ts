import { afterEach, beforeEach, vi } from 'vitest'
import type { AuthUser, Page, Restaurant, RestaurantMenu } from './api/types'

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// What the fake API does with one request: an object is sent as JSON with status 200, a
// Response is sent as it is, and a promise is waited for first (so a test can answer late).
export type ApiHandler = (
  url: URL,
  init?: RequestInit,
) => unknown | Response | Promise<unknown | Response>

// Call once at the top of a test file. Every `fetch` goes to `handler`, nothing reaches
// the network, and the stubs are removed after each test. Returns the mock so a test can
// read `mock.calls`.
export function stubApi(handler?: ApiHandler) {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_URL', '')
    if (handler) respondWith(fetchMock, handler)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  return fetchMock
}

export function respondWith(fetchMock: ReturnType<typeof vi.fn>, handler: ApiHandler) {
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    const answer = await handler(new URL(input), init)
    return answer instanceof Response ? answer : jsonResponse(answer)
  })
}

export function aRestaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: 1,
    name: 'Corner Kitchen',
    address: '1 Main St',
    cuisine: 'Chinese',
    description: 'Chinese classics.',
    image_url: '',
    offers_delivery: false,
    delivery_fee: '0.00',
    ...overrides,
  }
}

export function aPage<T>(results: T[], overrides: Partial<Page<T>> = {}): Page<T> {
  return { count: results.length, next: null, previous: null, results, ...overrides }
}

export function aMenu(overrides: Partial<RestaurantMenu> = {}): RestaurantMenu {
  return {
    restaurant: aRestaurant({ id: 1, name: 'Corner Kitchen', cuisine: 'Chinese', description: 'Chinese classics.' }),
    groups: [
      {
        id: 1,
        name: 'Appetizers',
        position: 1,
        items: [
          { id: 10, name: 'Spring Rolls', description: 'Crisp rolls with vegetables', price: '6.50' },
          { id: 11, name: 'Pot Stickers', description: 'Pan-fried pork dumplings', price: '7.50' },
        ],
      },
      {
        id: 2,
        name: 'Soups',
        position: 2,
        items: [{ id: 13, name: 'Miso Soup', description: 'Light broth with tofu', price: '4.00' }],
      },
      {
        id: null,
        name: 'Other',
        position: null,
        items: [{ id: 18, name: "Chef's Special", description: '', price: '14.00' }],
      },
    ],
    ...overrides,
  }
}

// Signed-in staff for page tests: an admin sees every restaurant, a cook only their own.
export function anAdmin(overrides: Partial<AuthUser> = {}): AuthUser {
  return { username: 'boss', role: 'admin', restaurants: [], ...overrides }
}

export function aCook(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    username: 'cook',
    role: 'fulfilment',
    restaurants: [{ id: 1, name: 'Corner Kitchen' }],
    ...overrides,
  }
}

export function aCustomer(overrides: Partial<AuthUser> = {}): AuthUser {
  return { username: 'shopper', role: 'customer', restaurants: [], ...overrides }
}
