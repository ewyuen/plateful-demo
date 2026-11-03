import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { POLL_INTERVAL_MS } from '../components/OrderQueue'
import type { Order, OrderStatus } from '../api/types'
import { renderApp } from '../testUtils'
import { aPage, aRestaurant, jsonResponse, stubApi, type ApiHandler, anAdmin } from '../testApi'

function anOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 42,
    restaurant: 1,
    restaurant_name: 'Corner Kitchen',
    customer_name: 'Sam',
    status: 'confirmed',
    payment_status: 'paid',
    paypal_order_id: 'PP-1',
    created_at: '2026-10-31T12:00:00Z',
    items: [{ menu_item: 10, menu_item_name: 'Spring Rolls', quantity: 1, unit_price: '6.50' }],
    total: '6.50',
    fulfilment_type: 'pickup',
    delivery_address: '',
    delivery_fee: '0.00',
    ...overrides,
  }
}

const restaurants = [aRestaurant({ id: 1, name: 'Corner Kitchen' }), aRestaurant({ id: 3, name: 'Noodle Bar' })]

// A small fake of the server: a list of orders, filtered like the real queue, and a
// transition that follows the workflow.
let orders: Order[]
const NEXT: Record<string, string[]> = {
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['completed'],
}

const handler: ApiHandler = (url, init) => {
  if (url.pathname === '/api/restaurants/') return aPage(restaurants)
  if (url.pathname === '/api/fulfilment/orders/') {
    const wanted = url.searchParams.get('status')?.split(',') ?? ['confirmed', 'preparing', 'ready']
    const restaurant = url.searchParams.get('restaurant')
    return aPage(
      orders.filter(
        (o) => wanted.includes(o.status) && (restaurant === null || String(o.restaurant) === restaurant),
      ),
    )
  }
  const match = url.pathname.match(/^\/api\/orders\/(\d+)\/transition\/$/)
  if (match && init?.method === 'POST') {
    const order = orders.find((o) => o.id === Number(match[1]))!
    const target = JSON.parse(String(init.body)).status as OrderStatus
    if (!(NEXT[order.status] ?? []).includes(target)) {
      return jsonResponse({ detail: 'no', allowed: NEXT[order.status] ?? [] }, 409)
    }
    order.status = target
    return { ...order }
  }
  return aPage([])
}

const fetchMock = stubApi((url, init) => handler(url, init))

function queueUrls(): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/fulfilment/orders/'))
}

function setUp(list: Order[]) {
  orders = list.map((o) => ({ ...o }))
}

const page = () => within(screen.getByRole('main'))

afterEach(() => {
  vi.useRealTimers()
})

describe('the queue', () => {
  it('shows a heading, who is signed in and a card for each order', async () => {
    setUp([anOrder()])
    renderApp('/fulfilment', {}, anAdmin())

    expect(page().getByRole('heading', { level: 1, name: 'Order queue' })).toBeInTheDocument()
    expect(page().getByText(/Signed in as boss\. Showing the orders of every restaurant/)).toBeInTheDocument()
    expect(page().queryByText(/open to everyone/i)).not.toBeInTheDocument()
    const card = (await page().findByRole('heading', { name: 'Order #42' })).closest('li') as HTMLElement
    expect(within(card).getByText('Confirmed')).toBeInTheDocument()
    expect(within(card).getByText(/Corner Kitchen · Sam/)).toBeInTheDocument()
    expect(within(card).getByText('Spring Rolls × 1')).toBeInTheDocument()
    expect(within(card).getByText('$6.50')).toBeInTheDocument()
  })

  it('shows the newest first, as the API gives them', async () => {
    setUp([anOrder({ id: 44 }), anOrder({ id: 43 })])
    renderApp('/fulfilment', {}, anAdmin())

    await page().findByRole('heading', { name: 'Order #44' })
    const numbers = page().getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(numbers).toEqual(['Order #44', 'Order #43'])
  })

  it('says it is loading, then that the view is empty', async () => {
    setUp([])
    renderApp('/fulfilment', {}, anAdmin())

    expect(screen.getByText('Loading orders…')).toBeInTheDocument()
    expect(await page().findByText('There are no orders in this view.')).toBeInTheDocument()
  })

  it('shows an alert when the first request fails', async () => {
    setUp([])
    fetchMock.mockImplementation(async (input: string) =>
      String(input).includes('/fulfilment/') ? jsonResponse({}, 500) : jsonResponse(aPage(restaurants)),
    )
    renderApp('/fulfilment', {}, anAdmin())

    expect(await screen.findByRole('alert')).toHaveTextContent(/orders/i)
  })
})

describe('the filters', () => {
  it('starts on Active with the default request, and Active is the pressed chip', async () => {
    setUp([anOrder()])
    renderApp('/fulfilment', {}, anAdmin())
    await page().findByRole('heading', { name: 'Order #42' })

    const chips = page().getByRole('group', { name: 'Filter by status' })
    const pressed = within(chips).getAllByRole('button', { pressed: true })
    expect(pressed).toHaveLength(1)
    expect(pressed[0]).toHaveTextContent('Active')
    expect(pressed[0]).toHaveTextContent('✓')
    expect(queueUrls()[0]).toBe('http://localhost:8000/api/fulfilment/orders/')
  })

  it('has one chip for each view', async () => {
    setUp([])
    renderApp('/fulfilment', {}, anAdmin())

    const chips = page().getByRole('group', { name: 'Filter by status' })
    const names = within(chips).getAllByRole('button').map((b) => b.textContent?.replace('✓ ', ''))
    expect(names).toEqual(['Active', 'Confirmed', 'Preparing', 'Ready', 'Completed', 'Cancelled'])
  })

  it('asks for the chosen status and shows only those orders', async () => {
    const user = userEvent.setup()
    setUp([anOrder({ id: 1 }), anOrder({ id: 2, status: 'completed' })])
    renderApp('/fulfilment', {}, anAdmin())
    await page().findByRole('heading', { name: 'Order #1' })

    await user.click(page().getByRole('button', { name: 'Completed' }))

    expect(await page().findByRole('heading', { name: 'Order #2' })).toBeInTheDocument()
    expect(page().queryByRole('heading', { name: 'Order #1' })).not.toBeInTheDocument()
    expect(queueUrls().at(-1)).toBe('http://localhost:8000/api/fulfilment/orders/?status=completed')
    expect(page().getByRole('button', { name: 'Completed' })).toHaveAttribute('aria-pressed', 'true')
    expect(page().getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('lists the restaurants in the selector and asks for the chosen one', async () => {
    const user = userEvent.setup()
    setUp([anOrder({ id: 1, restaurant: 1 }), anOrder({ id: 2, restaurant: 3, restaurant_name: 'Noodle Bar' })])
    renderApp('/fulfilment', {}, anAdmin())
    await page().findByRole('heading', { name: 'Order #2' })
    const select = page().getByRole('combobox', { name: 'Restaurant' })
    await within(select).findByRole('option', { name: 'Noodle Bar' })
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All restaurants',
      'Corner Kitchen',
      'Noodle Bar',
    ])

    await user.selectOptions(select, 'Noodle Bar')

    await waitFor(() => expect(page().queryByRole('heading', { name: 'Order #1' })).not.toBeInTheDocument())
    expect(page().getByRole('heading', { name: 'Order #2' })).toBeInTheDocument()
    expect(queueUrls().at(-1)).toBe('http://localhost:8000/api/fulfilment/orders/?restaurant=3')
  })

  it('opens an address with a status and a restaurant already applied', async () => {
    setUp([
      anOrder({ id: 1, status: 'ready', restaurant: 3, restaurant_name: 'Noodle Bar' }),
      anOrder({ id: 2, status: 'confirmed', restaurant: 3, restaurant_name: 'Noodle Bar' }),
      anOrder({ id: 3, status: 'ready', restaurant: 1 }),
    ])
    renderApp('/fulfilment?status=ready&restaurant=3', {}, anAdmin())

    expect(await page().findByRole('heading', { name: 'Order #1' })).toBeInTheDocument()
    expect(page().getAllByRole('heading', { level: 3 })).toHaveLength(1)
    expect(page().getByRole('button', { name: 'Ready' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(page().getByRole('combobox', { name: 'Restaurant' })).toHaveValue('3'))
    expect(queueUrls()[0]).toBe('http://localhost:8000/api/fulfilment/orders/?status=ready&restaurant=3')
  })

  it('ignores a status or restaurant in the address that makes no sense', async () => {
    setUp([anOrder()])
    renderApp('/fulfilment?status=pending&restaurant=abc', {}, anAdmin())

    await page().findByRole('heading', { name: 'Order #42' })
    expect(queueUrls()[0]).toBe('http://localhost:8000/api/fulfilment/orders/')
  })

  it('still offers All restaurants when the restaurants cannot load', async () => {
    setUp([anOrder()])
    fetchMock.mockImplementation(async (input: string) =>
      String(input).includes('/fulfilment/') ? jsonResponse(aPage(orders)) : jsonResponse({}, 500),
    )
    renderApp('/fulfilment', {}, anAdmin())

    await page().findByRole('heading', { name: 'Order #42' })
    expect(page().getByRole('option', { name: 'All restaurants' })).toBeInTheDocument()
  })
})

describe('the buttons on a card', () => {
  const card = async (id: number) =>
    within((await page().findByRole('heading', { name: `Order #${id}` })).closest('li') as HTMLElement)

  it.each([
    ['confirmed', ['Start preparing', 'Cancel']],
    ['preparing', ['Mark ready', 'Cancel']],
    ['ready', ['Mark completed']],
  ])('a %s order offers %j', async (status, labels) => {
    setUp([anOrder({ status: status as OrderStatus })])
    renderApp('/fulfilment', {}, anAdmin())

    const c = await card(42)
    expect(c.getAllByRole('button').map((b) => b.textContent)).toEqual(labels)
  })

  it.each(['completed', 'cancelled'])('a %s order has no buttons', async (status) => {
    setUp([anOrder({ status: status as OrderStatus })])
    renderApp(`/fulfilment?status=${status}`, {}, anAdmin())

    const c = await card(42)
    expect(c.queryAllByRole('button')).toHaveLength(0)
  })

  it('moves the order on and shows its new state', async () => {
    const user = userEvent.setup()
    setUp([anOrder()])
    renderApp('/fulfilment', {}, anAdmin())

    await user.click((await card(42)).getByRole('button', { name: 'Start preparing' }))

    const c = await card(42)
    await waitFor(() => expect(c.getByText('Preparing')).toBeInTheDocument())
    expect(c.getByRole('button', { name: 'Mark ready' })).toBeInTheDocument()
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(String(post[0])).toBe('http://localhost:8000/api/orders/42/transition/')
    expect(JSON.parse(post[1].body)).toEqual({ status: 'preparing' })
  })

  it('shows a cancelled order as Cancelled even though it leaves the Active view', async () => {
    const user = userEvent.setup()
    setUp([anOrder({ status: 'preparing' })])
    renderApp('/fulfilment', {}, anAdmin())

    await user.click((await card(42)).getByRole('button', { name: 'Cancel' }))

    await waitFor(async () => expect((await card(42)).getByText('Cancelled')).toBeInTheDocument())
    expect((await card(42)).queryAllByRole('button')).toHaveLength(0)
  })

  it('disables the card buttons while the request is pending, so it cannot be sent twice', async () => {
    const user = userEvent.setup()
    setUp([anOrder()])
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      if (init?.method === 'POST') await gate
      return base(input, init)
    })
    renderApp('/fulfilment', {}, anAdmin())

    await user.click((await card(42)).getByRole('button', { name: 'Start preparing' }))

    const c = await card(42)
    expect(c.getByRole('button', { name: 'Start preparing' })).toBeDisabled()
    expect(c.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    release()
    await waitFor(() => expect(c.getByRole('button', { name: 'Mark ready' })).toBeEnabled())
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('explains a clash with another person and shows the real state', async () => {
    const user = userEvent.setup()
    setUp([anOrder()])
    renderApp('/fulfilment', {}, anAdmin())
    const c = await card(42)
    orders[0].status = 'preparing' // someone else got there first
    const before = queueUrls().length

    await user.click(c.getByRole('button', { name: 'Start preparing' }))

    expect(await page().findByRole('status')).toHaveTextContent(/already moved on/i)
    await waitFor(async () => expect((await card(42)).getByText('Preparing')).toBeInTheDocument())
    expect(queueUrls().length).toBeGreaterThan(before)
  })

  it('announces another failure and leaves the card as it was', async () => {
    const user = userEvent.setup()
    setUp([anOrder()])
    renderApp('/fulfilment', {}, anAdmin())
    const c = await card(42)
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) =>
      init?.method === 'POST' ? jsonResponse({}, 500) : base(input, init),
    )

    await user.click(c.getByRole('button', { name: 'Start preparing' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/left it as it was|left as it was/i)
    expect((await card(42)).getByText('Confirmed')).toBeInTheDocument()
    expect((await card(42)).getByRole('button', { name: 'Start preparing' })).toBeEnabled()
  })
})

describe('the refresh', () => {
  it('shows a new order at the next tick without reloading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setUp([anOrder({ id: 1 })])
    renderApp('/fulfilment', {}, anAdmin())
    await page().findByRole('heading', { name: 'Order #1' })

    orders = [anOrder({ id: 2 }), ...orders]
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    })

    expect(await page().findByRole('heading', { name: 'Order #2' })).toBeInTheDocument()
    expect(page().getByRole('heading', { name: 'Order #1' })).toBeInTheDocument()
  })

  it('keeps the cards and shows an error when a refresh fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setUp([anOrder()])
    renderApp('/fulfilment', {}, anAdmin())
    await page().findByRole('heading', { name: 'Order #42' })
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) =>
      String(input).includes('/fulfilment/') ? jsonResponse({}, 500) : base(input, init),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    })

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(page().getByRole('heading', { name: 'Order #42' })).toBeInTheDocument()
  })

  it('makes no more requests once the page is left', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setUp([anOrder()])
    renderApp('/fulfilment', {}, anAdmin())
    await page().findByRole('heading', { name: 'Order #42' })

    fireEvent.click(screen.getByRole('link', { name: 'Orders' }))
    await screen.findByRole('heading', { level: 1, name: 'Orders' })
    const before = queueUrls().length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    })

    expect(queueUrls()).toHaveLength(before)
  })
})

describe('the page in the app', () => {
  it('has a header link that opens it, marked as the current page', async () => {
    setUp([])
    renderApp('/', {}, anAdmin())

    fireEvent.click(screen.getByRole('link', { name: 'Fulfilment' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Order queue' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Fulfilment' })).toHaveAttribute('aria-current', 'page')
  })
})
