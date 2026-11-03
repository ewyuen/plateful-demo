import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Order } from '../api/types'
import { renderApp } from '../testUtils'
import { aMenu, aPage, aRestaurant, jsonResponse, stubApi, type ApiHandler, anAdmin } from '../testApi'

// The PayPal buttons are tested on their own; this stand-in starts and completes the checkout.
vi.mock('../components/PayForOrder', async () => import('../testPayStub'))

const plateful = aRestaurant({ id: 1, name: 'Corner Kitchen', offers_delivery: true, delivery_fee: '3.00' })
const noodleBar = aRestaurant({ id: 3, name: 'Noodle Bar', cuisine: 'Noodles' })

function anOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 42,
    restaurant: 1,
    restaurant_name: 'Corner Kitchen',
    customer_name: 'Sam',
    status: 'ready',
    payment_status: 'paid',
    paypal_order_id: 'PP-1',
    created_at: '2026-10-31T12:00:00Z',
    items: [{ menu_item: 10, menu_item_name: 'Spring Rolls', quantity: 1, unit_price: '6.50' }],
    total: '9.50',
    fulfilment_type: 'delivery',
    delivery_address: '5 Elm Road',
    delivery_fee: '3.00',
    ...overrides,
  }
}

let orders: Order[] = []
const guestOrder = {
  restaurant_name: 'Corner Kitchen',
  status: 'confirmed',
  created_at: '2026-11-01T10:00:00Z',
  fulfilment_type: 'delivery',
  items: [{ menu_item_name: 'Spring Rolls', quantity: 1, unit_price: '6.50' }],
  delivery_fee: '3.00',
  total: '9.50',
  public_code: 'ABCD-EFGH-JKMN',
}

const handler: ApiHandler = (url, init) => {
  if (url.pathname === '/api/restaurants/cuisines/') return ['Chinese', 'Noodles']
  if (url.pathname === '/api/restaurants/') {
    const onlyDelivery = url.searchParams.get('offers_delivery') === 'true'
    return aPage([plateful, noodleBar].filter((r) => !onlyDelivery || r.offers_delivery))
  }
  if (url.pathname === '/api/restaurants/1/menu/') return aMenu({ restaurant: plateful })
  if (url.pathname === '/api/checkout/paypal/create/') return { paypal_order_id: 'PP-1' }
  if (url.pathname === '/api/checkout/paypal/capture/') {
    return jsonResponse({ ...anOrder({ status: 'confirmed' }), public_code: 'ABCD-EFGH-JKMN' }, 201)
  }
  if (url.pathname === '/api/orders/lookup/') return guestOrder
  if (url.pathname === '/api/orders/') return aPage(orders)
  if (url.pathname === '/api/fulfilment/orders/') return aPage(orders)
  const move = url.pathname.match(/^\/api\/orders\/(\d+)\/transition\/$/)
  if (move && init?.method === 'POST') {
    const order = orders.find((o) => o.id === Number(move[1]))!
    order.status = JSON.parse(String(init.body)).status
    return { ...order }
  }
  return []
}

const fetchMock = stubApi((url, init) => handler(url, init))
const page = () => within(screen.getByRole('main'))

const delivering = {
  restaurantId: 1,
  restaurantName: 'Corner Kitchen',
  restaurantDeliveryFee: '3.00',
  cart: { 10: { name: 'Spring Rolls', quantity: 1, price: '6.50' }, 13: { name: 'Miso Soup', quantity: 2, price: '4.00' } },
}
const pickupOnly = { ...delivering, restaurantId: 3, restaurantName: 'Noodle Bar', restaurantDeliveryFee: null }

function posted() {
  return fetchMock.mock.calls.filter(
    ([url, init]) => init?.method === 'POST' && String(url).endsWith('/checkout/paypal/create/'),
  )
}

describe('pickup or delivery at checkout', () => {
  it('shows the group, with pickup chosen and the fee stated, only when the restaurant delivers', () => {
    renderApp('/checkout', delivering)

    const group = page().getByRole('group', { name: 'Pickup or delivery' })
    expect(within(group).getByRole('radio', { name: 'Pickup' })).toBeChecked()
    expect(within(group).getByRole('radio', { name: /Delivery \(\$3\.00\)/ })).not.toBeChecked()
    expect(page().queryByLabelText('Delivery address')).not.toBeInTheDocument()
    expect(page().queryByText('Delivery fee')).not.toBeInTheDocument()
  })

  it('has the group between the details and the summary', () => {
    renderApp('/checkout', delivering)

    const names = [...document.querySelectorAll('main fieldset legend, main section h3')].map((n) => n.textContent)
    expect(names).toEqual(['Your details', 'Pickup or delivery', 'Order summary'])
  })

  it('shows no pickup or delivery control for a restaurant that does not deliver', () => {
    renderApp('/checkout', pickupOnly)

    expect(page().queryByRole('group', { name: 'Pickup or delivery' })).not.toBeInTheDocument()
    expect(page().queryByText(/deliver/i)).not.toBeInTheDocument()
  })

  it('asks for an address, shows the fee line and adds the fee to the total when delivery is chosen', async () => {
    const user = userEvent.setup()
    renderApp('/checkout', delivering)
    expect(within(page().getByRole('region', { name: 'Order summary' })).getByText('$14.50')).toBeInTheDocument()

    await user.click(page().getByRole('radio', { name: /Delivery/ }))

    expect(page().getByLabelText('Delivery address')).toBeRequired()
    const summary = page().getByRole('region', { name: 'Order summary' })
    expect(within(summary).getByText('Delivery fee')).toBeInTheDocument()
    expect(within(summary).getAllByText('$3.00').length).toBeGreaterThan(0)
    expect(within(summary).getByText('$17.50')).toBeInTheDocument()
  })

  it('does not start a delivery checkout without an address, and keeps the cart', async () => {
    const user = userEvent.setup()
    renderApp('/checkout', delivering)
    await user.type(page().getByLabelText('Your name'), 'Sam')
    await user.click(page().getByRole('radio', { name: /Delivery/ }))

    await user.click(page().getByRole('button', { name: 'Pay with PayPal' }))

    expect(page().getByText('Enter a delivery address.')).toBeInTheDocument()
    expect(page().getByLabelText('Delivery address')).toHaveAttribute('aria-invalid', 'true')
    expect(posted()).toHaveLength(0)
    expect(page().getByText('Spring Rolls × 1')).toBeInTheDocument()
  })

  it('sends the type and the address for a delivery checkout', async () => {
    const user = userEvent.setup()
    renderApp('/checkout', delivering)
    await user.type(page().getByLabelText('Your name'), 'Sam')
    await user.click(page().getByRole('radio', { name: /Delivery/ }))
    await user.type(page().getByLabelText('Delivery address'), '  5 Elm Road ')

    await user.click(page().getByRole('button', { name: 'Pay with PayPal' }))

    expect(await page().findByText('Payment received.')).toBeInTheDocument()
    expect(JSON.parse(String(posted()[0][1]?.body))).toEqual({
      restaurant: 1,
      customer_name: 'Sam',
      items: [
        { menu_item: 10, quantity: 1 },
        { menu_item: 13, quantity: 2 },
      ],
      fulfilment_type: 'delivery',
      delivery_address: '5 Elm Road',
    })
  })

  it('sends a plain pickup checkout after switching back, with no address', async () => {
    const user = userEvent.setup()
    renderApp('/checkout', delivering)
    await user.type(page().getByLabelText('Your name'), 'Sam')
    await user.click(page().getByRole('radio', { name: /Delivery/ }))
    await user.type(page().getByLabelText('Delivery address'), '5 Elm Road')

    await user.click(page().getByRole('radio', { name: 'Pickup' }))

    expect(page().queryByLabelText('Delivery address')).not.toBeInTheDocument()
    expect(page().queryByText('Delivery fee')).not.toBeInTheDocument()
    await user.click(page().getByRole('button', { name: 'Pay with PayPal' }))
    await page().findByText('Payment received.')
    const body = JSON.parse(String(posted()[0][1]?.body))
    expect(body.fulfilment_type).toBeUndefined()
    expect(body.delivery_address).toBeUndefined()
  })

  it('shows the server\'s complaint about the address beside the field', async () => {
    const user = userEvent.setup()
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) =>
      init?.method === 'POST' && String(input).endsWith('/checkout/paypal/create/')
        ? jsonResponse({ delivery_address: ['Enter a delivery address.'] }, 400)
        : base(input, init),
    )
    renderApp('/checkout', delivering)
    await user.type(page().getByLabelText('Your name'), 'Sam')
    await user.click(page().getByRole('radio', { name: /Delivery/ }))
    await user.type(page().getByLabelText('Delivery address'), 'x')

    await user.click(page().getByRole('button', { name: 'Pay with PayPal' }))

    expect(await page().findByText('Enter a delivery address.')).toBeInTheDocument()
    expect(page().getByLabelText('Delivery address')).toHaveAttribute('aria-invalid', 'true')
  })

  it('offers delivery after the cart was started on the restaurant page', async () => {
    const user = userEvent.setup()
    renderApp('/restaurants/1')
    await screen.findByRole('heading', { level: 1, name: 'Corner Kitchen' })

    await user.click(page().getByRole('button', { name: 'Increase quantity of Spring Rolls' }))
    await user.click(screen.getByRole('link', { name: /Cart/ }))

    expect(page().getByRole('group', { name: 'Pickup or delivery' })).toBeInTheDocument()
    expect(page().getByRole('radio', { name: /Delivery \(\$3\.00\)/ })).toBeInTheDocument()
  })
})

describe('delivery when browsing', () => {
  it('says Delivery with the fee, or Pickup only, on each card', async () => {
    renderApp('/')

    const cornerCard = (await page().findByRole('link', { name: 'Corner Kitchen' })).closest('li') as HTMLElement
    const barCard = (await page().findByRole('link', { name: 'Noodle Bar' })).closest('li') as HTMLElement
    expect(within(cornerCard).getByText(/Delivery \$3\.00/)).toBeInTheDocument()
    expect(within(barCard).getByText('Pickup only')).toBeInTheDocument()
  })

  it('has a Delivery chip that narrows the list, marks itself and is kept in the address', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await page().findByRole('link', { name: 'Noodle Bar' })

    await user.click(page().getByRole('button', { name: 'Delivery' }))

    await waitFor(() => expect(page().queryByRole('link', { name: 'Noodle Bar' })).not.toBeInTheDocument())
    expect(page().getByRole('link', { name: 'Corner Kitchen' })).toBeInTheDocument()
    const chip = page().getByRole('button', { name: /Delivery/ })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(chip).toHaveTextContent('✓')
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('offers_delivery=true')
  })

  it('opens an address with delivery already chosen, and combines it with a cuisine', async () => {
    renderApp('/?delivery=true&cuisine=Chinese')

    await page().findByRole('link', { name: 'Corner Kitchen' })
    expect(page().getByRole('button', { name: /Delivery/ })).toHaveAttribute('aria-pressed', 'true')
    const url = new URL(String(fetchMock.mock.calls.find(([u]) => String(u).includes('offers_delivery'))?.[0]))
    expect(url.searchParams.get('offers_delivery')).toBe('true')
    expect(url.searchParams.get('cuisine')).toBe('Chinese')
  })

  it('shows the delivery fee, or Pickup only, in the restaurant header', async () => {
    renderApp('/restaurants/1')

    expect(await screen.findByText(/Delivery \$3\.00 · Pickup/)).toBeInTheDocument()
  })
})

describe('delivery in the fulfilment queue', () => {
  it('shows Pickup or the address on each card', async () => {
    orders = [
      anOrder({ id: 2, fulfilment_type: 'pickup', delivery_address: '', status: 'confirmed' }),
      anOrder({ id: 1, status: 'confirmed' }),
    ]
    renderApp('/fulfilment', {}, anAdmin())

    const pickup = (await page().findByRole('heading', { name: 'Order #2' })).closest('li') as HTMLElement
    const delivery = (await page().findByRole('heading', { name: 'Order #1' })).closest('li') as HTMLElement
    expect(within(pickup).getByText('Pickup')).toBeInTheDocument()
    expect(within(delivery).getByText('Delivery to 5 Elm Road')).toBeInTheDocument()
  })

  it('takes a ready delivery order out for delivery and then marks it delivered', async () => {
    const user = userEvent.setup()
    orders = [anOrder({ status: 'ready' })]
    renderApp('/fulfilment', {}, anAdmin())
    const card = async () =>
      within((await page().findByRole('heading', { name: 'Order #42' })).closest('li') as HTMLElement)

    await user.click((await card()).getByRole('button', { name: 'Send out for delivery' }))
    await waitFor(async () => expect((await card()).getByText('Out for delivery')).toBeInTheDocument())
    expect((await card()).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    await user.click((await card()).getByRole('button', { name: 'Mark delivered' }))

    await waitFor(async () => expect((await card()).getByText('Completed')).toBeInTheDocument())
    const bodies = fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)).status)
    expect(bodies).toEqual(['out_for_delivery', 'completed'])
  })

  it('keeps Mark completed for a ready pickup order', async () => {
    orders = [anOrder({ status: 'ready', fulfilment_type: 'pickup', delivery_address: '' })]
    renderApp('/fulfilment', {}, anAdmin())

    const card = within((await page().findByRole('heading', { name: 'Order #42' })).closest('li') as HTMLElement)
    expect(card.getByRole('button', { name: 'Mark completed' })).toBeInTheDocument()
    expect(card.queryByRole('button', { name: 'Send out for delivery' })).not.toBeInTheDocument()
  })
})
