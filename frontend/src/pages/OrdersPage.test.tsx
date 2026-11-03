import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { addCode, loadCodes } from '../deviceOrders'
import { renderApp } from '../testUtils'
import { jsonResponse, stubApi, type ApiHandler } from '../testApi'
import { ENTER_CODE, LOOKUP_FAILED, NOT_FOUND, TOO_MANY } from '../components/FindOrder'
import { GONE } from '../components/DeviceOrders'

const A = 'ABCDEFGHJKMN'
const B = 'PQRSTUVWXYZ2'

function guestOrder(code: string, overrides: Record<string, unknown> = {}) {
  return {
    restaurant_name: code === A ? 'Corner Kitchen' : 'Noodle Bar',
    status: 'confirmed',
    created_at: '2026-11-01T10:00:00Z',
    fulfilment_type: 'pickup',
    items: [{ menu_item_name: 'Spring Rolls', quantity: 2, unit_price: '6.50' }],
    delivery_fee: '0.00',
    total: '13.00',
    public_code: code,
    ...overrides,
  }
}

let lookup: (code: string) => Response | object = (code) => guestOrder(code)
const handler: ApiHandler = (url, init) => {
  if (url.pathname === '/api/orders/lookup/') {
    const typed = JSON.parse(String(init?.body)).code as string
    return lookup(typed.replace(/[\s-]/g, '').toUpperCase())
  }
  return []
}
const fetchMock = stubApi((url, init) => handler(url, init))
const page = () => within(screen.getByRole('main'))
const lookups = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/orders/lookup/')).map(([, init]) => JSON.parse(String(init?.body)).code)

beforeEach(() => {
  lookup = (code) => guestOrder(code)
})
afterEach(() => vi.restoreAllMocks())

describe('the Orders page', () => {
  it('has a heading, the find form and says nothing is on this device', () => {
    renderApp('/orders')

    expect(page().getByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument()
    expect(page().getByLabelText('Order code')).toBeInTheDocument()
    expect(page().getByText(/no orders on this device/i)).toBeInTheDocument()
    expect(lookups()).toEqual([])
  })

  it('never asks for a list of orders and shows no order number, name or address', async () => {
    addCode(A)
    renderApp('/orders')

    await page().findByRole('heading', { name: /Corner Kitchen/ })

    expect(fetchMock.mock.calls.some(([url]) => /\/orders\/(\?|$)/.test(String(url)))).toBe(false)
    expect(page().queryByText(/Order #/)).not.toBeInTheDocument()
  })

  it('shows no payment confirmation when opened normally', () => {
    renderApp('/orders')

    expect(screen.queryByText(/Payment received/)).not.toBeInTheDocument()
  })
})

describe('orders on this device', () => {
  it('lists the remembered orders, each fetched by its code, newest first', async () => {
    addCode(A, 1)
    addCode(B, 2)
    renderApp('/orders')

    const headings = await screen.findAllByRole('heading', { level: 3 })

    expect(headings.map((h) => h.textContent)).toEqual([
      expect.stringContaining('Noodle Bar'),
      expect.stringContaining('Corner Kitchen'),
    ])
    expect(lookups().sort()).toEqual([A, B].sort())
  })

  it('shows what was ordered, the status in words, pickup and the total', async () => {
    addCode(A)
    renderApp('/orders')

    const card = (await page().findByRole('heading', { name: /Corner Kitchen/ })).closest('li') as HTMLElement
    expect(within(card).getByText('Confirmed')).toBeInTheDocument()
    expect(within(card).getByText('Pickup')).toBeInTheDocument()
    expect(within(card).getByText('Spring Rolls × 2')).toBeInTheDocument()
    expect(within(card).getByText('Total $13.00')).toBeInTheDocument()
    expect(within(card).getByText(/Code ABCD-EFGH-JKMN/)).toBeInTheDocument()
  })

  it('says Delivery for a delivery order, without an address', async () => {
    addCode(A)
    lookup = (code) => guestOrder(code, { fulfilment_type: 'delivery', delivery_fee: '3.00', total: '16.00' })
    renderApp('/orders')

    const card = (await page().findByRole('heading', { name: /Corner Kitchen/ })).closest('li') as HTMLElement
    expect(within(card).getByText('Delivery')).toBeInTheDocument()
    expect(page().queryByText(/ Road| Street| Lane/)).not.toBeInTheDocument()
  })

  it('says an order was not found any more, and lets it be forgotten', async () => {
    addCode(A)
    lookup = () => jsonResponse({ detail: 'No order was found for that code.' }, 404)
    const user = userEvent.setup()
    renderApp('/orders')

    expect(await page().findByText(GONE)).toBeInTheDocument()
    await user.click(page().getByRole('button', { name: 'Forget' }))

    expect(page().queryByText(GONE)).not.toBeInTheDocument()
    expect(loadCodes()).toEqual([])
  })

  it('forgets one order and keeps the other', async () => {
    addCode(A, 1)
    addCode(B, 2)
    const user = userEvent.setup()
    renderApp('/orders')
    const card = (await page().findByRole('heading', { name: /Noodle Bar/ })).closest('li') as HTMLElement

    await user.click(within(card).getByRole('button', { name: 'Forget' }))

    expect(page().queryByRole('heading', { name: /Noodle Bar/ })).not.toBeInTheDocument()
    expect(page().getByRole('heading', { name: /Corner Kitchen/ })).toBeInTheDocument()
    expect(loadCodes()).toEqual([A])
  })

  it('shows an error for another failure, with a way to forget', async () => {
    addCode(A)
    lookup = () => jsonResponse({ detail: 'Server error.' }, 500)
    renderApp('/orders')

    expect(await page().findByText(/Could not load the order \(error 500\)/)).toBeInTheDocument()
    expect(page().getByRole('button', { name: 'Forget' })).toBeInTheDocument()
  })

  it('fetches again when Refresh is pressed and shows the new status', async () => {
    addCode(A)
    const user = userEvent.setup()
    renderApp('/orders')
    await page().findByText('Confirmed')
    lookup = (code) => guestOrder(code, { status: 'ready' })

    await user.click(page().getByRole('button', { name: 'Refresh' }))

    expect(await page().findByText('Ready')).toBeInTheDocument()
    expect(lookups()).toHaveLength(2)
  })

  it('does not break when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    renderApp('/orders')

    expect(page().getByText(/no orders on this device/i)).toBeInTheDocument()
  })
})

describe('finding an order by its code', () => {
  async function find(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.type(page().getByLabelText('Order code'), text)
    await user.click(page().getByRole('button', { name: 'Find' }))
  }

  it('shows the order that matches, however the code was typed', async () => {
    const user = userEvent.setup()
    renderApp('/orders')

    await find(user, 'abcd efgh-jkmn')

    expect(await page().findByRole('heading', { name: /Corner Kitchen/ })).toBeInTheDocument()
    expect(lookups()).toEqual(['abcd efgh-jkmn'])
  })

  it('offers to remember it, and then lists it with the device orders', async () => {
    const user = userEvent.setup()
    renderApp('/orders')
    await find(user, A)

    await user.click(await page().findByRole('button', { name: 'Remember on this device' }))

    expect(loadCodes()).toEqual([A])
    expect(await page().findByText('Remembered on this device.')).toBeInTheDocument()
    expect(page().getAllByRole('heading', { name: /Corner Kitchen/ })).toHaveLength(2)
  })

  it('says so when the code is already remembered', async () => {
    addCode(A)
    const user = userEvent.setup()
    renderApp('/orders')
    await find(user, 'abcd-efgh-jkmn')

    expect(await page().findByText('Remembered on this device.')).toBeInTheDocument()
    expect(page().queryByRole('button', { name: 'Remember on this device' })).not.toBeInTheDocument()
  })

  it('gives one message when no order was found, whatever the reason', async () => {
    lookup = () => jsonResponse({ detail: 'No order was found for that code.' }, 404)
    const user = userEvent.setup()
    renderApp('/orders')

    await find(user, 'whatever')

    expect(await page().findByRole('alert')).toHaveTextContent(NOT_FOUND)
  })

  it('asks the customer to wait after too many tries', async () => {
    lookup = () => jsonResponse({ detail: 'Throttled.' }, 429)
    const user = userEvent.setup()
    renderApp('/orders')

    await find(user, A)

    expect(await page().findByRole('alert')).toHaveTextContent(TOO_MANY)
  })

  it('shows one generic message for any other failure', async () => {
    lookup = () => jsonResponse({ detail: 'Server error.' }, 500)
    const user = userEvent.setup()
    renderApp('/orders')

    await find(user, A)

    expect(await page().findByRole('alert')).toHaveTextContent(LOOKUP_FAILED)
  })

  it('asks for a code instead of sending an empty one', async () => {
    const user = userEvent.setup()
    renderApp('/orders')

    await user.click(page().getByRole('button', { name: 'Find' }))

    expect(page().getByRole('alert')).toHaveTextContent(ENTER_CODE)
    expect(lookups()).toEqual([])
  })

  it('disables the button while looking and sends one request', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    renderApp('/orders')

    await find(user, A)
    const button = page().getByRole('button', { name: 'Looking…' })
    expect(button).toBeDisabled()
    await user.click(button)

    expect(lookups()).toHaveLength(1)
  })

  it('removes an old result when a new search starts', async () => {
    const user = userEvent.setup()
    renderApp('/orders')
    await find(user, A)
    await page().findByRole('heading', { name: /Corner Kitchen/ })
    lookup = () => jsonResponse({ detail: 'No.' }, 404)

    await user.clear(page().getByLabelText('Order code'))
    await find(user, B)

    expect(await page().findByRole('alert')).toBeInTheDocument()
    expect(page().queryByRole('heading', { name: /Corner Kitchen/ })).not.toBeInTheDocument()
  })
})

describe('right after paying', () => {
  const arrive = () => renderApp({ pathname: '/orders', state: { paidCode: 'ABCD-EFGH-JKMN' } })

  it('shows that payment was received with the code and says to keep it', () => {
    arrive()

    const notice = page().getByRole('status')
    expect(notice).toHaveTextContent('Payment received.')
    expect(notice).toHaveTextContent('ABCD-EFGH-JKMN')
    expect(notice).toHaveTextContent(/keep this code to find your order later/i)
  })

  it('has a link that opens the mail program with the code in the message', () => {
    arrive()

    const href = page().getByRole('link', { name: 'Email it to myself' }).getAttribute('href')!
    expect(href.startsWith('mailto:?subject=')).toBe(true)
    expect(decodeURIComponent(href)).toContain('ABCD-EFGH-JKMN')
  })

  it('copies the code and says so', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    // After setup, because user-event installs its own clipboard stand-in there.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    arrive()

    await user.click(page().getByRole('button', { name: 'Copy code' }))

    expect(writeText).toHaveBeenCalledWith('ABCD-EFGH-JKMN')
    expect(await page().findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('keeps the code on screen and shows no error when copying is refused', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    arrive()

    await user.click(page().getByRole('button', { name: 'Copy code' }))

    expect(page().getByText('ABCD-EFGH-JKMN')).toBeInTheDocument()
    expect(page().queryByRole('alert')).not.toBeInTheDocument()
  })

  it('ignores something in the router state that is not a code', () => {
    renderApp({ pathname: '/orders', state: { paidCode: '<script>' } })

    expect(screen.queryByText(/Payment received/)).not.toBeInTheDocument()
  })
})
