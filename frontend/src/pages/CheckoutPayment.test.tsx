import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../testUtils'
import { jsonResponse, stubApi } from '../testApi'

// The PayPal buttons are tested on their own; here a stand-in starts and completes the
// checkout, so the page's next step can be checked.
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

describe('after paying', () => {
  it('goes to the Orders page, which shows the order code and the order', async () => {
    const user = userEvent.setup()
    renderApp('/checkout', {
      restaurantId: 1,
      restaurantName: 'Corner Kitchen',
      cart: { 10: { name: 'Spring Rolls', quantity: 1, price: '6.50' } },
    })
    const main = () => within(screen.getByRole('main'))
    await user.type(main().getByLabelText('Your name'), 'Sam')
    await user.click(main().getByRole('button', { name: 'Pay with PayPal' }))

    expect(await main().findByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument()
    expect(main().getByRole('status')).toHaveTextContent('Payment received.')
    expect(main().getByRole('status')).toHaveTextContent('ABCD-EFGH-JKMN')
    // The order is listed among this device's orders, fetched by its code.
    expect(await main().findByRole('heading', { name: /Corner Kitchen/ })).toBeInTheDocument()
    expect(main().getByText('Confirmed')).toBeInTheDocument()
    const lookup = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/orders/lookup/'))!
    expect(JSON.parse(String(lookup[1].body))).toEqual({ code: 'ABCDEFGHJKMN' })
    // No list of orders is ever requested, and no order number is shown.
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/orders/') && init?.method === 'GET')).toBe(false)
    expect(main().queryByText(/Order #/)).not.toBeInTheDocument()
  })
})
