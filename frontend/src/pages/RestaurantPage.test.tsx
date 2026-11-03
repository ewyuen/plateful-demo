import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../testUtils'
import { aMenu, aPage, aRestaurant, jsonResponse, stubApi, type ApiHandler } from '../testApi'

const noodleBar = aRestaurant({ id: 3, name: 'Noodle Bar', cuisine: 'Noodles', address: '2 Side St.' })

const api: ApiHandler = (url) => {
  if (url.pathname === '/api/restaurants/1/menu/') return aMenu()
  if (url.pathname === '/api/restaurants/3/menu/') {
    return aMenu({
      restaurant: noodleBar,
      groups: [{ id: 5, name: 'Noodles', position: 1, items: [{ id: 19, name: 'Beef Noodles', description: '', price: '12.00' }] }],
    })
  }
  if (url.pathname === '/api/restaurants/2/menu/') {
    return aMenu({ restaurant: aRestaurant({ id: 2, name: 'Corner Kitchen East' }), groups: [] })
  }
  return jsonResponse({ detail: 'Not found.' }, 404)
}

const fetchMock = stubApi(api)

const scrollIntoView = vi.fn()
beforeEach(() => {
  scrollIntoView.mockReset()
  Element.prototype.scrollIntoView = scrollIntoView
})

const page = () => within(screen.getByRole('main'))

async function open(path = '/restaurants/1', draft = {}) {
  renderApp(path, draft)
  await screen.findByRole('heading', { level: 1 })
}

describe('the restaurant header', () => {
  it('shows the name, cuisine, address and description with a way back', async () => {
    await open()

    expect(page().getByRole('heading', { level: 1, name: 'Corner Kitchen' })).toBeInTheDocument()
    expect(page().getByText(/Chinese · 1 Main St/)).toBeInTheDocument()
    expect(page().getByText('Chinese classics.')).toBeInTheDocument()
    expect(page().getByRole('link', { name: /All restaurants/ })).toHaveAttribute('href', '/')
    expect(page().getByRole('banner').querySelector('img')).toHaveAttribute('alt', '')
  })
})

describe('the grouped menu', () => {
  it('shows a section for each group in the order the API gives, Other last', async () => {
    await open()

    const headings = page().getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings.slice(0, 3)).toEqual(['Appetizers', 'Soups', 'Other'])
  })

  it('shows each dish with its name, description and price in its own group', async () => {
    await open()

    const appetizers = page().getByRole('region', { name: 'Appetizers' })
    expect(within(appetizers).getByRole('heading', { name: 'Spring Rolls' })).toBeInTheDocument()
    expect(within(appetizers).getByText('Crisp rolls with vegetables')).toBeInTheDocument()
    expect(within(appetizers).getByText('$6.50')).toBeInTheDocument()
    expect(within(appetizers).queryByText('Miso Soup')).not.toBeInTheDocument()
  })

  it('says the menu is not ready when there are no groups', async () => {
    await open('/restaurants/2')

    expect(page().getByText(/menu is not ready yet/i)).toBeInTheDocument()
  })
})

describe('the category navigation', () => {
  it('has one button per group, in order', async () => {
    await open()

    const nav = page().getByRole('navigation', { name: 'Menu categories' })
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Appetizers', 'Soups', 'Other'])
  })

  it('is left out when there is only one group', async () => {
    await open('/restaurants/3')

    expect(screen.queryByRole('navigation', { name: 'Menu categories' })).not.toBeInTheDocument()
  })

  it('brings the group into view and marks its button as current', async () => {
    const user = userEvent.setup()
    await open()

    await user.click(page().getByRole('button', { name: 'Soups' }))

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('group-2'))
    expect(page().getByRole('button', { name: 'Soups' })).toHaveAttribute('aria-current', 'true')
    expect(page().getByRole('button', { name: 'Appetizers' })).not.toHaveAttribute('aria-current')
  })

  it('works from the keyboard', async () => {
    const user = userEvent.setup()
    await open()

    page().getByRole('button', { name: 'Other' }).focus()
    await user.keyboard('{Enter}')

    expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('group-other'))
    expect(page().getByRole('button', { name: 'Other' })).toHaveAttribute('aria-current', 'true')
  })
})

describe('the quantity buttons', () => {
  const quantityOf = (name: string) => page().getByRole('status', { name: `Quantity of ${name}` })

  it('start at zero with decrease disabled', async () => {
    await open()

    expect(quantityOf('Spring Rolls')).toHaveTextContent('0')
    expect(page().getByRole('button', { name: 'Decrease quantity of Spring Rolls' })).toBeDisabled()
  })

  it('increase adds the dish to the cart', async () => {
    const user = userEvent.setup()
    await open()

    await user.click(page().getByRole('button', { name: 'Increase quantity of Spring Rolls' }))
    await user.click(page().getByRole('button', { name: 'Increase quantity of Spring Rolls' }))

    expect(quantityOf('Spring Rolls')).toHaveTextContent('2')
    const cart = page().getByRole('list', { name: 'Cart' })
    expect(within(cart).getByText('Spring Rolls × 2')).toBeInTheDocument()
  })

  it('decrease to zero takes the dish out of the cart', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(page().getByRole('button', { name: 'Increase quantity of Miso Soup' }))

    await user.click(page().getByRole('button', { name: 'Decrease quantity of Miso Soup' }))

    expect(quantityOf('Miso Soup')).toHaveTextContent('0')
    expect(page().getByRole('button', { name: 'Decrease quantity of Miso Soup' })).toBeDisabled()
    expect(page().queryByRole('list', { name: 'Cart' })).not.toBeInTheDocument()
  })

  it('show zero when the cart belongs to another restaurant', async () => {
    await open('/restaurants/1', {
      restaurantId: 3,
      restaurantName: 'Noodle Bar',
      cart: { 10: { name: 'Spring Rolls', quantity: 4, price: '6.50' } },
    })

    expect(quantityOf('Spring Rolls')).toHaveTextContent('0')
  })
})

describe('the cart panel', () => {
  it('lists dishes with prices and shows the total and the checkout link', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(page().getByRole('button', { name: 'Increase quantity of Spring Rolls' }))
    await user.click(page().getByRole('button', { name: 'Increase quantity of Miso Soup' }))
    await user.click(page().getByRole('button', { name: 'Increase quantity of Miso Soup' }))

    const panel = page().getByRole('complementary', { name: 'Your order' })
    expect(within(panel).getByText('Spring Rolls × 1')).toBeInTheDocument()
    expect(within(panel).getByText('$6.50')).toBeInTheDocument()
    expect(within(panel).getByText('Miso Soup × 2')).toBeInTheDocument()
    expect(within(panel).getByText('$8.00')).toBeInTheDocument()
    expect(within(panel).getByText('$14.50')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Go to checkout' })).toHaveAttribute('href', '/checkout')
    expect(within(panel).getByRole('link', { name: 'Corner Kitchen' })).toHaveAttribute('href', '/restaurants/1')
  })

  it('says the order is empty and offers no checkout', async () => {
    await open()

    const panel = page().getByRole('complementary', { name: 'Your order' })
    expect(within(panel).getByText('Your order is empty')).toBeInTheDocument()
    expect(within(panel).queryByRole('link', { name: 'Go to checkout' })).not.toBeInTheDocument()
  })

  it('shows no total when a price is not known', async () => {
    await open('/restaurants/1', {
      restaurantId: 1,
      restaurantName: 'Corner Kitchen',
      cart: { 10: { name: 'Spring Rolls', quantity: 1 } },
    })

    const panel = page().getByRole('complementary', { name: 'Your order' })
    expect(within(panel).getByText('Spring Rolls × 1')).toBeInTheDocument()
    expect(within(panel).queryByText('Total')).not.toBeInTheDocument()
  })

  it('has a bar toggle that says whether the panel is expanded', async () => {
    const user = userEvent.setup()
    await open('/restaurants/1', {
      restaurantId: 1,
      restaurantName: 'Corner Kitchen',
      cart: { 10: { name: 'Spring Rolls', quantity: 2, price: '6.50' } },
    })

    const toggle = page().getByRole('button', { name: /Your order · 2 items · \$13.00/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('one cart holds one restaurant', () => {
  const fromNoodleBar = {
    restaurantId: 3,
    restaurantName: 'Noodle Bar',
    cart: { 19: { name: 'Beef Noodles', quantity: 1, price: '12.00' } },
  }

  it('asks first, and changes nothing before the answer', async () => {
    const user = userEvent.setup()
    await open('/restaurants/1', fromNoodleBar)

    await user.click(page().getByRole('button', { name: 'Increase quantity of Spring Rolls' }))

    const dialog = screen.getByRole('dialog', { name: 'Start a new order?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveTextContent('Noodle Bar')
    expect(dialog).toHaveTextContent('Corner Kitchen')
    expect(screen.getByText('Beef Noodles × 1')).toBeInTheDocument()
    expect(screen.queryByText('Spring Rolls × 1')).not.toBeInTheDocument()
  })

  it('puts keyboard focus on the safe choice', async () => {
    const user = userEvent.setup()
    await open('/restaurants/1', fromNoodleBar)

    await user.click(page().getByRole('button', { name: 'Increase quantity of Spring Rolls' }))

    expect(screen.getByRole('button', { name: 'Keep my cart' })).toHaveFocus()
  })

  it('replaces the cart when confirmed', async () => {
    const user = userEvent.setup()
    await open('/restaurants/1', fromNoodleBar)
    await user.click(page().getByRole('button', { name: 'Increase quantity of Spring Rolls' }))

    await user.click(screen.getByRole('button', { name: 'Empty cart and add' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const cart = page().getByRole('list', { name: 'Cart' })
    expect(within(cart).getByText('Spring Rolls × 1')).toBeInTheDocument()
    expect(within(cart).queryByText(/Beef Noodles/)).not.toBeInTheDocument()
    expect(page().getByRole('status', { name: 'Quantity of Spring Rolls' })).toHaveTextContent('1')
  })

  it('keeps the cart when told to', async () => {
    const user = userEvent.setup()
    await open('/restaurants/1', fromNoodleBar)
    await user.click(page().getByRole('button', { name: 'Increase quantity of Spring Rolls' }))

    await user.click(screen.getByRole('button', { name: 'Keep my cart' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Beef Noodles × 1')).toBeInTheDocument()
    expect(page().getByRole('status', { name: 'Quantity of Spring Rolls' })).toHaveTextContent('0')
  })

  it('keeps the cart on Escape', async () => {
    const user = userEvent.setup()
    await open('/restaurants/1', fromNoodleBar)
    await user.click(page().getByRole('button', { name: 'Increase quantity of Spring Rolls' }))

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Beef Noodles × 1')).toBeInTheDocument()
  })

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup()
    await open('/restaurants/1', fromNoodleBar)
    await user.click(page().getByRole('button', { name: 'Increase quantity of Spring Rolls' }))

    await user.tab()
    expect(screen.getByRole('button', { name: 'Empty cart and add' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Keep my cart' })).toHaveFocus()
  })

  it('does not ask for an empty cart', async () => {
    const user = userEvent.setup()
    await open('/restaurants/1', { restaurantId: 3, restaurantName: 'Noodle Bar', cart: {} })

    await user.click(page().getByRole('button', { name: 'Increase quantity of Spring Rolls' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(page().getByRole('status', { name: 'Quantity of Spring Rolls' })).toHaveTextContent('1')
  })

  it('does not ask for the same restaurant', async () => {
    const user = userEvent.setup()
    await open('/restaurants/1', {
      restaurantId: 1,
      restaurantName: 'Corner Kitchen',
      cart: { 13: { name: 'Miso Soup', quantity: 1, price: '4.00' } },
    })

    await user.click(page().getByRole('button', { name: 'Increase quantity of Spring Rolls' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(page().getByText('Miso Soup × 1')).toBeInTheDocument()
    expect(page().getByText('Spring Rolls × 1')).toBeInTheDocument()
  })

  it('does not change the cart just by opening another restaurant', async () => {
    await open('/restaurants/1', fromNoodleBar)

    expect(screen.getByText('Beef Noodles × 1')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('loading, errors and missing restaurants', () => {
  it('says it is loading until the menu arrives', async () => {
    renderApp('/restaurants/1')

    expect(screen.getByText('Loading menu…')).toBeInTheDocument()
    await screen.findByRole('heading', { level: 1, name: 'Corner Kitchen' })
    expect(screen.queryByText('Loading menu…')).not.toBeInTheDocument()
  })

  it('shows an alert when the menu cannot be loaded', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({}, 500))
    renderApp('/restaurants/1')

    expect(await screen.findByRole('alert')).toHaveTextContent(/menu/i)
  })

  it('says the restaurant was not found on a 404', async () => {
    renderApp('/restaurants/9999')

    expect(await screen.findByRole('heading', { name: 'Restaurant not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all restaurants' })).toHaveAttribute('href', '/')
  })

  it('says the restaurant was not found for an address that is not a number, without asking the API', () => {
    renderApp('/restaurants/abc')

    expect(screen.getByRole('heading', { name: 'Restaurant not found' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('moving between restaurants', () => {
  it('shows only the new restaurant and ignores a late answer for the old one', async () => {
    const user = userEvent.setup()
    let answerLate: () => void = () => {}
    const late = new Promise<void>((resolve) => (answerLate = resolve))
    fetchMock.mockImplementation(async (input: string) => {
      const url = new URL(input)
      if (url.pathname === '/api/restaurants/1/menu/') {
        await late // the first restaurant's menu is slow
        return jsonResponse(aMenu())
      }
      if (url.pathname === '/api/restaurants/cuisines/') return jsonResponse([])
      if (url.pathname === '/api/restaurants/') return jsonResponse(aPage([noodleBar]))
      return jsonResponse(await api(url))
    })
    renderApp('/restaurants/1')
    expect(screen.getByText('Loading menu…')).toBeInTheDocument()

    // Leave before the menu arrives: Restaurants, then Noodle Bar.
    await user.click(screen.getByRole('link', { name: 'Restaurants' }))
    await user.click(await page().findByRole('link', { name: 'Noodle Bar' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Noodle Bar' })).toBeInTheDocument()

    answerLate()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(screen.getByRole('heading', { level: 1, name: 'Noodle Bar' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Spring Rolls' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Beef Noodles' })).toBeInTheDocument()
  })

  it('does not show the earlier restaurant while the next one loads', async () => {
    const user = userEvent.setup()
    await open('/restaurants/1', {
      restaurantId: 3,
      restaurantName: 'Noodle Bar',
      cart: { 19: { name: 'Beef Noodles', quantity: 1, price: '12.00' } },
    })
    let answerNext: () => void = () => {}
    const next = new Promise<void>((resolve) => (answerNext = resolve))
    fetchMock.mockImplementation(async (input: string) => {
      await next
      return jsonResponse(await api(new URL(input)))
    })

    await user.click(page().getByRole('link', { name: 'Noodle Bar' }))

    expect(screen.getByText('Loading menu…')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Spring Rolls' })).not.toBeInTheDocument()
    answerNext()
    expect(await screen.findByRole('heading', { level: 1, name: 'Noodle Bar' })).toBeInTheDocument()
  })
})
