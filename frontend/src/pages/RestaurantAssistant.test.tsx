import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../testUtils'
import { aMenu, aPage, aRestaurant, jsonResponse, stubApi } from '../testApi'

const noodleBar = aRestaurant({ id: 3, name: 'Noodle Bar', cuisine: 'Noodles' })
const fromNoodleBar = {
  restaurantId: 3,
  restaurantName: 'Noodle Bar',
  cart: { 19: { name: 'Beef Noodles', quantity: 1, price: '12.00' } },
}

const springRolls = { menu_item: 10, name: 'Spring Rolls', quantity: 2 }

const fetchMock = stubApi((url) => {
  if (url.pathname === '/api/assistant/') return { reply: 'Try the spring rolls.', suggestions: [springRolls] }
  if (url.pathname === '/api/restaurants/1/menu/') return aMenu()
  if (url.pathname === '/api/restaurants/3/menu/') {
    return aMenu({
      restaurant: noodleBar,
      groups: [{ id: 5, name: 'Noodles', position: 1, items: [{ id: 19, name: 'Beef Noodles', description: '', price: '12.00' }] }],
    })
  }
  if (url.pathname === '/api/restaurants/') return aPage([noodleBar])
  return []
})

const page = () => within(screen.getByRole('main'))

async function open(path = '/restaurants/1', draft = {}) {
  renderApp(path, draft)
  await screen.findByRole('heading', { level: 1 })
}

async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByLabelText(/your question/i), text)
  await user.click(screen.getByRole('button', { name: /^send$/i }))
}

describe('opening and closing the assistant', () => {
  it('offers a button, and the panel is not shown until it is pressed', async () => {
    await open()

    const button = screen.getByRole('button', { name: /ask the assistant/i })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog', { name: 'Assistant' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /your question/i })).not.toBeInTheDocument()
  })

  it('shows the message box and the send control, with focus on Close', async () => {
    const user = userEvent.setup()
    await open()

    await user.click(screen.getByRole('button', { name: /ask the assistant/i }))

    expect(screen.getByRole('dialog', { name: 'Assistant' })).toBeInTheDocument()
    expect(screen.getByLabelText(/your question/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^send$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  it('closes on Escape, gives focus back, and keeps the conversation', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(screen.getByRole('button', { name: /ask the assistant/i }))
    await ask(user, 'something light')
    await screen.findByText(/Try the spring rolls/)

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Assistant' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ask the assistant/i })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: /ask the assistant/i }))
    expect(screen.getByText(/Try the spring rolls/)).toBeInTheDocument()
    expect(screen.getByText('something light')).toBeInTheDocument()
  })

  it('closes with the Close button', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(screen.getByRole('button', { name: /ask the assistant/i }))

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog', { name: 'Assistant' })).not.toBeInTheDocument()
  })

  it.each(['/', '/checkout', '/orders'])('is not offered on %s', (path) => {
    renderApp(path)

    expect(screen.queryByRole('button', { name: /ask the assistant/i })).not.toBeInTheDocument()
  })
})

describe('suggestions and the cart', () => {
  it('adds the suggested dishes with their prices, only when the button is pressed', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(screen.getByRole('button', { name: /ask the assistant/i }))
    await ask(user, 'something light')
    await screen.findByText(/Try the spring rolls/)
    const panel = page().getByRole('complementary', { name: 'Your order' })
    expect(within(panel).queryByText('Spring Rolls × 2')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add to cart' }))

    expect(within(panel).getByText('Spring Rolls × 2')).toBeInTheDocument()
    expect(within(panel).getAllByText('$13.00').length).toBeGreaterThan(0)
    expect(page().getByRole('status', { name: 'Quantity of Spring Rolls' })).toHaveTextContent('2')
  })

  it('asks before replacing a cart from another restaurant, and changes nothing until it is confirmed', async () => {
    const user = userEvent.setup()
    await open('/restaurants/1', fromNoodleBar)
    await user.click(screen.getByRole('button', { name: /ask the assistant/i }))
    await ask(user, 'something light')
    await screen.findByText(/Try the spring rolls/)

    await user.click(screen.getByRole('button', { name: 'Add to cart' }))

    const dialog = screen.getByRole('dialog', { name: 'Start a new order?' })
    const cartPanel = page().getByRole('complementary', { name: 'Your order' })
    expect(within(cartPanel).getByText('Beef Noodles × 1')).toBeInTheDocument()
    expect(within(cartPanel).queryByText('Spring Rolls × 2')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Empty cart and add' }))
    const panel = page().getByRole('complementary', { name: 'Your order' })
    expect(within(panel).queryByText('Beef Noodles × 1')).not.toBeInTheDocument()
    expect(within(panel).getByText('Spring Rolls × 2')).toBeInTheDocument()
  })
})

describe('the assistant belongs to one restaurant', () => {
  it('starts empty on another restaurant', async () => {
    const user = userEvent.setup()
    await open('/restaurants/1', fromNoodleBar)
    await user.click(screen.getByRole('button', { name: /ask the assistant/i }))
    await ask(user, 'something light')
    await screen.findByText(/Try the spring rolls/)
    await user.click(screen.getByRole('button', { name: 'Close' }))

    await user.click(page().getByRole('link', { name: 'Noodle Bar' }))
    await screen.findByRole('heading', { level: 1, name: 'Noodle Bar' })
    await user.click(screen.getByRole('button', { name: /ask the assistant/i }))

    expect(screen.queryByText(/Try the spring rolls/)).not.toBeInTheDocument()
    expect(screen.queryByText('something light')).not.toBeInTheDocument()
  })

  it('does not show an answer that arrives after moving to another restaurant', async () => {
    const user = userEvent.setup()
    let answerLate: () => void = () => {}
    const late = new Promise<void>((resolve) => (answerLate = resolve))
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      if (new URL(input).pathname === '/api/assistant/') {
        await late
        return jsonResponse({ reply: 'A late answer.', suggestions: [] })
      }
      return original(input, init)
    })
    await open('/restaurants/1', fromNoodleBar)
    await user.click(screen.getByRole('button', { name: /ask the assistant/i }))
    await ask(user, 'something light')
    await user.click(screen.getByRole('button', { name: 'Close' }))

    await user.click(page().getByRole('link', { name: 'Noodle Bar' }))
    await screen.findByRole('heading', { level: 1, name: 'Noodle Bar' })
    answerLate()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await user.click(screen.getByRole('button', { name: /ask the assistant/i }))

    expect(screen.queryByText('A late answer.')).not.toBeInTheDocument()
  })
})
