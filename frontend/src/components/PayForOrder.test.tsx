import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import PayForOrder, { CANCELLED, DECLINED, FAILED, UNAVAILABLE } from './PayForOrder'

// The real PayPal buttons load a script from paypal.com, so the SDK is replaced:
// the test reads the callbacks the component hands to PayPalButtons and calls them.
interface ButtonProps {
  onClick: (data: object, actions: { resolve: () => unknown; reject: () => unknown }) => unknown
  createOrder: () => Promise<string>
  onApprove: (data: { orderID: string }) => Promise<void>
  onCancel: () => void
  onError: () => void
}

const sdk = vi.hoisted(() => ({
  script: { isPending: false, isRejected: false },
  buttons: null as ButtonProps | null,
}))

vi.mock('@paypal/react-paypal-js', () => ({
  PayPalScriptProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  usePayPalScriptReducer: () => [sdk.script, vi.fn()],
  PayPalButtons: (props: ButtonProps) => {
    sdk.buttons = props
    return <div data-testid="paypal-buttons" />
  },
}))

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function buttons(): ButtonProps {
  if (sdk.buttons === null) throw new Error('PayPal buttons were not rendered')
  return sdk.buttons
}

beforeEach(() => {
  fetchMock.mockReset()
  sdk.script = { isPending: false, isRejected: false }
  sdk.buttons = null
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_URL', '')
  vi.stubEnv('VITE_PAYPAL_CLIENT_ID', 'sandbox-client-id')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const beforePay = vi.fn()
const startPayment = vi.fn()

function renderPay(onPaid = vi.fn()) {
  render(<PayForOrder beforePay={beforePay} startPayment={startPayment} onPaid={onPaid} />)
  return onPaid
}

const paidOrder = { id: 7, payment_status: 'paid' }

describe('PayForOrder', () => {
  beforeEach(() => {
    beforePay.mockReset().mockReturnValue(true)
    startPayment.mockReset().mockResolvedValue('PP-1')
  })

  it('shows the PayPal buttons', () => {
    renderPay()

    expect(screen.getByTestId('paypal-buttons')).toBeInTheDocument()
  })

  it('says payment is unavailable and orders cannot be placed when there is no client ID', () => {
    vi.stubEnv('VITE_PAYPAL_CLIENT_ID', '')

    renderPay()

    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument()
    expect(UNAVAILABLE).toMatch(/orders cannot be placed/i)
    expect(screen.queryByTestId('paypal-buttons')).not.toBeInTheDocument()
  })

  it('says payment is unavailable when the PayPal script fails to load', () => {
    sdk.script = { isPending: false, isRejected: true }

    renderPay()

    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument()
    expect(screen.queryByTestId('paypal-buttons')).not.toBeInTheDocument()
  })

  it('says PayPal is loading while the script loads', () => {
    sdk.script = { isPending: true, isRejected: false }

    renderPay()

    expect(screen.getByText(/loading paypal/i)).toBeInTheDocument()
  })

  it('lets PayPal open when the form is valid', () => {
    renderPay()
    const actions = { resolve: vi.fn(), reject: vi.fn() }

    buttons().onClick({}, actions)

    expect(actions.resolve).toHaveBeenCalledTimes(1)
    expect(actions.reject).not.toHaveBeenCalled()
  })

  it('stops PayPal from opening when the form is not valid', () => {
    beforePay.mockReturnValue(false)
    renderPay()
    const actions = { resolve: vi.fn(), reject: vi.fn() }

    buttons().onClick({}, actions)

    expect(actions.reject).toHaveBeenCalledTimes(1)
    expect(actions.resolve).not.toHaveBeenCalled()
  })

  it('starts the checkout and hands PayPal the id the server returns', async () => {
    renderPay()

    const id = await buttons().createOrder()

    expect(id).toBe('PP-1')
    expect(startPayment).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('completes the checkout with the PayPal order id on approval and tells the parent', async () => {
    fetchMock.mockResolvedValue(jsonResponse(paidOrder, 201))
    const onPaid = renderPay()

    await act(async () => {
      await buttons().onApprove({ orderID: 'PP-1' })
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/checkout/paypal/capture/')
    expect(JSON.parse(init.body)).toEqual({ paypal_order_id: 'PP-1' })
    expect(onPaid).toHaveBeenCalledWith(paidOrder)
  })

  it('shows a declined message and keeps the buttons when the server says 402', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Payment failed.' }, 402))
    const onPaid = renderPay()

    await act(async () => {
      await buttons().onApprove({ orderID: 'PP-1' })
    })

    expect(screen.getByRole('alert')).toHaveTextContent(DECLINED)
    expect(screen.getByTestId('paypal-buttons')).toBeInTheDocument()
    expect(onPaid).not.toHaveBeenCalled()
  })

  it('shows a generic failure and keeps the buttons when PayPal is unreachable (502)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'PayPal is unavailable.' }, 502))
    const onPaid = renderPay()

    await act(async () => {
      await buttons().onApprove({ orderID: 'PP-1' })
    })

    expect(screen.getByRole('alert')).toHaveTextContent(FAILED)
    expect(screen.getByTestId('paypal-buttons')).toBeInTheDocument()
    expect(onPaid).not.toHaveBeenCalled()
  })

  it('shows a cancelled message and keeps the buttons when the user closes PayPal', () => {
    renderPay()

    act(() => buttons().onCancel())

    expect(screen.getByRole('alert')).toHaveTextContent(CANCELLED)
    expect(screen.getByTestId('paypal-buttons')).toBeInTheDocument()
  })

  it('shows a failure message when PayPal reports an error', () => {
    renderPay()

    act(() => buttons().onError())

    expect(screen.getByRole('alert')).toHaveTextContent(FAILED)
  })

  it('shows no second message when the checkout could not start, because the form already did', async () => {
    startPayment.mockRejectedValue(new Error('rejected'))
    renderPay()

    await expect(buttons().createOrder()).rejects.toThrow('rejected')
    act(() => buttons().onError())

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears an old message when a new payment starts', async () => {
    renderPay()
    act(() => buttons().onCancel())
    expect(screen.getByRole('alert')).toHaveTextContent(CANCELLED)

    await act(async () => {
      await buttons().createOrder()
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
