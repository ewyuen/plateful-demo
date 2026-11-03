import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OrderForm from './OrderForm'
import type { CompletedOrder } from '../api/types'
import { loadCodes } from '../deviceOrders'
import type { Cart } from '../cart'
import { renderWithProvider } from '../testUtils'

// The PayPal buttons have their own tests. Here they are a stand-in that does what the
// buttons do with the form's callbacks and shows what came back.
vi.mock('./PayForOrder', async () => {
  const { useState } = await import('react')
  function PayStandIn({
    beforePay,
    startPayment,
    onPaid,
  }: {
    beforePay: () => boolean
    startPayment: () => Promise<string>
    onPaid: (order: CompletedOrder) => void
  }) {
    const [result, setResult] = useState('')
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            if (!beforePay()) {
              setResult('blocked')
              return
            }
            startPayment().then(
              (id) => setResult(`started ${id}`),
              () => setResult('start failed'),
            )
          }}
        >
          Pay with PayPal
        </button>
        <button type="button" onClick={() => onPaid({ id: 7, public_code: 'ABCD-EFGH-JKMN' } as CompletedOrder)}>
          Mark paid
        </button>
        <p data-testid="pay-result">{result}</p>
      </div>
    )
  }
  return { default: PayStandIn }
})

const fetchMock = vi.fn()

const cart: Cart = {
  4: { name: 'Ramen', quantity: 2 },
  5: { name: 'Dumplings', quantity: 1 },
}

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

async function pressPay(user: ReturnType<typeof userEvent.setup>, name = 'Ann') {
  if (name !== '') await user.type(screen.getByLabelText(/your name/i), name)
  await user.click(screen.getByRole('button', { name: /pay with paypal/i }))
}

const started = () => screen.getByTestId('pay-result')

describe('OrderForm', () => {
  it('asks the user to choose a restaurant when none is chosen', () => {
    renderWithProvider(<OrderForm />)

    expect(screen.getByText(/choose a restaurant/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay with paypal/i })).not.toBeInTheDocument()
  })

  it('shows what is in the cart', () => {
    renderWithProvider(<OrderForm />, { restaurantId: 3, cart })

    const list = screen.getByRole('list', { name: /cart/i })
    expect(list).toHaveTextContent('Ramen × 2')
    expect(list).toHaveTextContent('Dumplings × 1')
  })

  it('has the pay buttons and no place-order button', () => {
    renderWithProvider(<OrderForm />, { restaurantId: 3, cart })

    expect(screen.getByRole('button', { name: /pay with paypal/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /place order/i })).not.toBeInTheDocument()
  })

  it('offers no payment for an empty cart', () => {
    renderWithProvider(<OrderForm />, { restaurantId: 3, cart: {} })

    expect(screen.queryByRole('button', { name: /pay with paypal/i })).not.toBeInTheDocument()
    expect(screen.getByText(/your cart is empty/i)).toBeInTheDocument()
  })

  it('starts the checkout with the restaurant, the trimmed name and the cart items, and no amount', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ paypal_order_id: 'PP-1' }))
    const user = userEvent.setup()
    renderWithProvider(<OrderForm />, { restaurantId: 3, cart })

    await pressPay(user, '  Ann  ')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/checkout\/paypal\/create\/$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      restaurant: 3,
      customer_name: 'Ann',
      items: [
        { menu_item: 4, quantity: 2 },
        { menu_item: 5, quantity: 1 },
      ],
    })
    expect(await screen.findByText('started PP-1')).toBeInTheDocument()
  })

  it('sends no request when the name is blank, and says what is missing', async () => {
    const user = userEvent.setup()
    renderWithProvider(<OrderForm />, { restaurantId: 3, cart })

    await pressPay(user, '   ')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(started()).toHaveTextContent('blocked')
    expect(screen.getByText(/enter your name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/your name/i)).toHaveAttribute('aria-invalid', 'true')
  })

  it('uses the name typed after the buttons first appeared', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ paypal_order_id: 'PP-1' }))
    const user = userEvent.setup()
    renderWithProvider(<OrderForm />, { restaurantId: 3, cart })

    await user.type(screen.getByLabelText(/your name/i), 'Ann')
    await user.type(screen.getByLabelText(/your name/i), 'ie')
    await user.click(screen.getByRole('button', { name: /pay with paypal/i }))

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).customer_name).toBe('Annie')
  })

  it('starts only one checkout when pressed again while the first is pending', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    renderWithProvider(<OrderForm />, { restaurantId: 3, cart })

    await pressPay(user)
    await user.click(screen.getByRole('button', { name: /pay with paypal/i }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows one generic message and keeps the cart when the server cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const user = userEvent.setup()
    renderWithProvider(<OrderForm />, { restaurantId: 3, cart })

    await pressPay(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not place the order/i)
    expect(started()).toHaveTextContent('start failed')
    expect(screen.getByLabelText(/your name/i)).toHaveValue('Ann')
    expect(screen.getByRole('list', { name: /cart/i })).toHaveTextContent('Ramen × 2')
  })

  it('shows the same generic message for a server error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Server error.' }, 500))
    const user = userEvent.setup()
    renderWithProvider(<OrderForm />, { restaurantId: 3, cart })

    await pressPay(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not place the order/i)
    expect(alert).not.toHaveTextContent(/server error/i)
  })

  it('shows a name problem from the server beside the name field', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ customer_name: ['This field may not be blank.'] }, 400),
    )
    const user = userEvent.setup()
    renderWithProvider(<OrderForm />, { restaurantId: 3, cart })

    await pressPay(user)

    const message = await screen.findByText('This field may not be blank.')
    const input = screen.getByLabelText(/your name/i)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('This field may not be blank.')
    expect(message).not.toHaveAttribute('role', 'alert')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the message for a rejected item and keeps the cart', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [{}, { menu_item: ['Seasonal Soup is unavailable.'] }] }, 400),
    )
    const user = userEvent.setup()
    renderWithProvider(<OrderForm />, { restaurantId: 3, cart })

    await pressPay(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Seasonal Soup is unavailable.')
    expect(screen.getByRole('list', { name: /cart/i })).toHaveTextContent('Ramen × 2')
  })

  it('removes an old error when the user starts again', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ paypal_order_id: 'PP-2' }))
    const user = userEvent.setup()
    renderWithProvider(<OrderForm />, { restaurantId: 3, cart })
    await pressPay(user)
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /pay with paypal/i }))

    expect(await screen.findByText('started PP-2')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('OrderForm when the form is removed', () => {
  it('cancels the request when the form is removed from the page', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    const { unmount } = renderWithProvider(<OrderForm />, { restaurantId: 3, cart })
    await pressPay(user)
    const signal: AbortSignal = fetchMock.mock.calls[0][1].signal

    expect(signal.aborted).toBe(false)
    unmount()

    expect(signal.aborted).toBe(true)
  })
})

describe('OrderForm after the payment', () => {
  it('creates no order by itself: nothing is shown as placed before a payment', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ paypal_order_id: 'PP-1' }))
    const user = userEvent.setup()
    renderWithProvider(<OrderForm />, { restaurantId: 3, cart })

    await pressPay(user)

    expect(await screen.findByText('started PP-1')).toBeInTheDocument()
    expect(screen.queryByText(/is paid/i)).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: /cart/i })).toHaveTextContent('Ramen × 2')
  })

  it('confirms the payment with the order code, empties the cart and the name, and tells the page', async () => {
    const onPaid = vi.fn()
    const user = userEvent.setup()
    renderWithProvider(<OrderForm onPaid={onPaid} />, { restaurantId: 3, cart })
    await user.type(screen.getByLabelText(/your name/i), 'Ann')

    await user.click(screen.getByRole('button', { name: /mark paid/i }))

    expect(screen.getByText('Payment received. Your order code is ABCD-EFGH-JKMN.')).toBeInTheDocument()
    expect(screen.queryByText(/order #/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/your name/i)).toHaveValue('')
    expect(screen.getByText(/your cart is empty/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay with paypal/i })).not.toBeInTheDocument()
    expect(onPaid).toHaveBeenCalledWith(expect.objectContaining({ public_code: 'ABCD-EFGH-JKMN' }))
  })

  it('remembers the code on this device', async () => {
    const user = userEvent.setup()
    renderWithProvider(<OrderForm />, { restaurantId: 3, cart })

    await user.click(screen.getByRole('button', { name: /mark paid/i }))

    expect(loadCodes()).toEqual(['ABCDEFGHJKMN'])
  })
})
