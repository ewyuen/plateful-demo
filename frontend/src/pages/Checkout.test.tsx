import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../testUtils'
import { jsonResponse, stubApi } from '../testApi'

// The PayPal buttons are tested on their own; this stand-in starts and completes the checkout.
vi.mock('../components/PayForOrder', async () => import('../testPayStub'))

const order = {
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
}

const guestOrder = {
  restaurant_name: 'Corner Kitchen',
  status: 'confirmed',
  created_at: '2026-10-31T12:00:00Z',
  fulfilment_type: 'pickup',
  items: [{ menu_item_name: 'Spring Rolls', quantity: 1, unit_price: '6.50' }],
  delivery_fee: '0.00',
  total: '6.50',
  public_code: 'ABCD-EFGH-JKMN',
}

const fetchMock = stubApi((url) => {
  if (url.pathname === '/api/checkout/paypal/create/') return { paypal_order_id: 'PP-1' }
  if (url.pathname === '/api/checkout/paypal/capture/') return jsonResponse({ ...order, public_code: 'ABCD-EFGH-JKMN' }, 201)
  if (url.pathname === '/api/orders/lookup/') return guestOrder
  return []
})

const cart = {
  restaurantId: 1,
  restaurantName: 'Corner Kitchen',
  cart: {
    10: { name: 'Spring Rolls', quantity: 1, price: '6.50' },
    13: { name: 'Miso Soup', quantity: 2, price: '4.00' },
  },
}

const page = () => within(screen.getByRole('main'))

describe('the checkout page', () => {
  it('shows the restaurant, the details group and the summary with prices and total', () => {
    renderApp('/checkout', cart)

    expect(page().getByRole('heading', { level: 1, name: 'Checkout' })).toBeInTheDocument()
    expect(page().getByRole('link', { name: 'Corner Kitchen' })).toHaveAttribute('href', '/restaurants/1')
    expect(page().getByRole('group', { name: 'Your details' })).toBeInTheDocument()
    const summary = page().getByRole('region', { name: 'Order summary' })
    expect(within(summary).getByText('Spring Rolls × 1')).toBeInTheDocument()
    expect(within(summary).getByText('$8.00')).toBeInTheDocument()
    expect(within(summary).getByText('$14.50')).toBeInTheDocument()
    expect(page().getByRole('button', { name: 'Pay with PayPal' })).toBeInTheDocument()
    expect(page().queryByRole('button', { name: 'Place order' })).not.toBeInTheDocument()
  })

  it('has no delivery or pickup control', () => {
    renderApp('/checkout', cart)

    expect(page().queryByText(/deliver/i)).not.toBeInTheDocument()
    expect(page().queryByText(/pickup/i)).not.toBeInTheDocument()
  })

  it('says the order is empty, with a way back, instead of the form', () => {
    renderApp('/checkout')

    expect(page().getByText('Your order is empty')).toBeInTheDocument()
    expect(page().getByRole('link', { name: 'See all restaurants' })).toHaveAttribute('href', '/')
    expect(page().queryByRole('button', { name: 'Pay with PayPal' })).not.toBeInTheDocument()
  })

  it('creates no order until the payment is confirmed, then moves on to the orders page', async () => {
    const user = userEvent.setup()
    renderApp('/checkout', cart)

    await user.type(page().getByLabelText('Your name'), 'Sam')
    await user.click(page().getByRole('button', { name: 'Pay with PayPal' }))

    expect(await page().findByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument()
    await page().findByRole('heading', { name: /Corner Kitchen/ })
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => String(url))
    expect(posts).toEqual([
      'http://localhost:8000/api/checkout/paypal/create/',
      'http://localhost:8000/api/checkout/paypal/capture/',
      // The Orders page then looks the new order up by its code.
      'http://localhost:8000/api/orders/lookup/',
    ])
  })

  it('does not start a checkout when the name is missing', async () => {
    const user = userEvent.setup()
    renderApp('/checkout', cart)

    await user.click(page().getByRole('button', { name: 'Pay with PayPal' }))

    expect(page().getByText('Enter your name.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  })
})
