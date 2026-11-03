import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import App from '../App'
import { STORAGE_KEY } from '../draftStorage'
import { aMenu, stubApi } from '../testApi'

let menu = aMenu()
stubApi((url) => (url.pathname === '/api/restaurants/1/menu/' ? menu : []))

// What a reload does: the app is built again with no draft given, so it reads the kept one.
function openApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

const main = () => within(screen.getByRole('main'))

describe('the cart across a reload', () => {
  it('is still there after a reload, with the restaurant and the name', async () => {
    menu = aMenu()
    const user = userEvent.setup()
    const first = openApp('/restaurants/1')
    await user.click(await screen.findByRole('button', { name: 'Increase quantity of Spring Rolls' }))
    first.unmount()
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull()

    openApp('/checkout')

    expect(await main().findByText(/Spring Rolls × 1/)).toBeInTheDocument()
    expect(main().getByRole('link', { name: 'Corner Kitchen' })).toBeInTheDocument()
  })

  it('shows the current price and a notice when the price changed while it was kept', async () => {
    menu = aMenu()
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: Date.now() - 1000,
        draft: {
          restaurantId: 1,
          restaurantName: 'Corner Kitchen',
          restaurantDeliveryFee: null,
          cart: { 10: { name: 'Spring Rolls', quantity: 2, price: '5.00' } },
          customerName: 'Sam',
        },
      }),
    )

    openApp('/checkout')

    expect(await screen.findByText(/saved cart was updated/i)).toBeInTheDocument()
    await waitFor(() => expect(main().getAllByText('$13.00').length).toBeGreaterThan(0))
    expect(main().getByLabelText('Your name')).toHaveValue('Sam')
  })

  it('starts empty when nothing is kept', () => {
    openApp('/checkout')

    expect(main().getByText('Your order is empty')).toBeInTheDocument()
  })
})
