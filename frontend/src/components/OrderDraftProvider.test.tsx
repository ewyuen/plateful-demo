import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OrderDraftProvider from './OrderDraftProvider'
import { STORAGE_KEY, saveDraft } from '../draftStorage'
import { initialOrderDraft, type OrderDraft } from '../orderDraft'
import { useOrderDraft } from '../orderDraftContext'
import { aMenu, aRestaurant, jsonResponse, stubApi } from '../testApi'

const kept: OrderDraft = {
  ...initialOrderDraft,
  restaurantId: 1,
  restaurantName: 'Corner Kitchen',
  cart: { 10: { name: 'Spring Rolls', quantity: 2, price: '6.50' } },
  customerName: 'Ann',
}

// Menu answers; a test replaces it to make the check fail or find changes.
let menuAnswer: () => unknown = () => aMenu()
const fetchMock = stubApi((url) => {
  if (url.pathname === '/api/restaurants/1/menu/') return menuAnswer()
  return []
})

function Probe() {
  const { state, dispatch } = useOrderDraft()
  return (
    <>
      <p data-testid="name">{state.customerName}</p>
      <p data-testid="cart">{JSON.stringify(state.cart)}</p>
      <p data-testid="notice">{state.notice ?? ''}</p>
      <button type="button" onClick={() => dispatch({ type: 'nameChanged', name: 'Bo' })}>
        rename
      </button>
      <button type="button" onClick={() => dispatch({ type: 'orderPaid' })}>
        paid
      </button>
    </>
  )
}

function renderProvider(initialState?: OrderDraft) {
  menuAnswer = () => aMenu()
  return render(
    <OrderDraftProvider initialState={initialState}>
      <Probe />
    </OrderDraftProvider>,
  )
}

const raw = () => window.localStorage.getItem(STORAGE_KEY)
const menuCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/restaurants/1/menu/'))

describe('restoring the kept draft', () => {
  it('starts from the kept cart, restaurant and name', async () => {
    saveDraft(kept)

    renderProvider()

    expect(screen.getByTestId('name')).toHaveTextContent('Ann')
    expect(JSON.parse(screen.getByTestId('cart').textContent!)).toEqual(kept.cart)
  })

  it('starts empty when nothing is kept', () => {
    renderProvider()

    expect(screen.getByTestId('cart')).toHaveTextContent('{}')
    expect(menuCalls()).toHaveLength(0)
  })

  it('starts empty and removes a copy older than 24 hours', () => {
    saveDraft(kept, Date.now() - 25 * 60 * 60 * 1000)

    renderProvider()

    expect(screen.getByTestId('cart')).toHaveTextContent('{}')
    expect(raw()).toBeNull()
  })

  it('does not read the kept draft when one is given', () => {
    saveDraft(kept)

    renderProvider({ ...initialOrderDraft, customerName: 'Given' })

    expect(screen.getByTestId('name')).toHaveTextContent('Given')
    expect(menuCalls()).toHaveLength(0)
  })

  it('does not write the restored copy back, so a reload does not extend its time', async () => {
    saveDraft(kept, Date.now() - 60 * 60 * 1000)
    const before = raw()

    renderProvider()
    await waitFor(() => expect(menuCalls()).toHaveLength(1))

    expect(raw()).toBe(before)
  })
})

describe('keeping the draft', () => {
  it('saves a change to the name', async () => {
    const user = userEvent.setup()
    renderProvider()

    await user.click(screen.getByRole('button', { name: 'rename' }))

    expect(JSON.parse(raw()!).draft.customerName).toBe('Bo')
  })

  it('removes the kept copy once a payment is confirmed', async () => {
    saveDraft(kept)
    const user = userEvent.setup()
    renderProvider()
    await waitFor(() => expect(menuCalls()).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: 'paid' }))

    expect(raw()).toBeNull()
    expect(screen.getByTestId('cart')).toHaveTextContent('{}')
  })

  it('keeps working when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    const user = userEvent.setup()
    renderProvider()

    await user.click(screen.getByRole('button', { name: 'rename' }))

    expect(screen.getByTestId('name')).toHaveTextContent('Bo')
    vi.restoreAllMocks()
  })
})

describe('checking a restored cart against the menu', () => {
  it('asks once for the menu of the cart\'s restaurant', async () => {
    saveDraft(kept)

    renderProvider()

    await waitFor(() => expect(menuCalls()).toHaveLength(1))
    expect(screen.getByTestId('notice')).toHaveTextContent('')
  })

  it('does not ask when the restored draft has no dishes', () => {
    saveDraft({ ...initialOrderDraft, customerName: 'Ann' })

    renderProvider()

    expect(menuCalls()).toHaveLength(0)
  })

  it('takes up a new price and shows a notice', async () => {
    saveDraft({ ...kept, cart: { 10: { name: 'Spring Rolls', quantity: 2, price: '5.00' } } })
    renderProvider()

    await waitFor(() => expect(screen.getByTestId('notice')).toHaveTextContent(/updated/i))
    expect(JSON.parse(screen.getByTestId('cart').textContent!)[10].price).toBe('6.50')
  })

  it('removes a dish that is gone and says which', async () => {
    saveDraft({ ...kept, cart: { 10: kept.cart[10], 99: { name: 'Old Special', quantity: 1, price: '9.00' } } })

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('notice')).toHaveTextContent('Old Special is no longer available'))
    expect(Object.keys(JSON.parse(screen.getByTestId('cart').textContent!))).toEqual(['10'])
  })

  it('empties the cart and says so when the restaurant no longer exists', async () => {
    saveDraft(kept)
    fetchMock.mockImplementation(async () => jsonResponse({ detail: 'Not found.' }, 404))

    render(
      <OrderDraftProvider>
        <Probe />
      </OrderDraftProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('notice')).toHaveTextContent(/no longer available/i))
    expect(screen.getByTestId('cart')).toHaveTextContent('{}')
    await waitFor(() => expect(raw()).toBeNull())
  })

  it('keeps the cart and shows nothing when the server cannot be reached', async () => {
    saveDraft(kept)
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    render(
      <OrderDraftProvider>
        <Probe />
      </OrderDraftProvider>,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(screen.getByTestId('cart').textContent!)).toEqual(kept.cart)
    expect(screen.getByTestId('notice')).toHaveTextContent('')
  })

  it('keeps the cart and shows nothing on a server error', async () => {
    saveDraft(kept)
    fetchMock.mockImplementation(async () => jsonResponse({ detail: 'Server error.' }, 500))

    render(
      <OrderDraftProvider>
        <Probe />
      </OrderDraftProvider>,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(screen.getByTestId('cart').textContent!)).toEqual(kept.cart)
    expect(screen.getByTestId('notice')).toHaveTextContent('')
  })

  it('cancels the check when the provider is removed', async () => {
    saveDraft(kept)
    fetchMock.mockReturnValue(new Promise(() => {}))

    const { unmount } = render(
      <OrderDraftProvider>
        <Probe />
      </OrderDraftProvider>,
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const signal: AbortSignal = fetchMock.mock.calls[0][1].signal
    unmount()

    expect(signal.aborted).toBe(true)
  })
})

// The fee in the menu answer is what the draft shows after the check.
describe('the restaurant\'s delivery fee after the check', () => {
  it('is refreshed from the menu', async () => {
    saveDraft({ ...kept, restaurantDeliveryFee: '2.00' })
    fetchMock.mockImplementation(async () =>
      jsonResponse(aMenu({ restaurant: aRestaurant({ id: 1, offers_delivery: true, delivery_fee: '3.00' }) })),
    )

    render(
      <OrderDraftProvider>
        <Probe />
      </OrderDraftProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('notice')).toHaveTextContent(/updated/i))
  })
})
