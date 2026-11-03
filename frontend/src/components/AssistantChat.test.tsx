import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AssistantChat, { MAX_MESSAGE_LENGTH, MAX_MESSAGES } from './AssistantChat'
import { GENERIC_ERROR, RATE_LIMITED, UNAVAILABLE } from '../assistantErrors'
import { useOrderDraft } from '../orderDraftContext'
import { renderWithProvider } from '../testUtils'
import { useCartActions } from '../useCartActions'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const noodles = { menu_item: 4, name: 'Ramen', quantity: 2 }
const lightReply = {
  reply: 'Try the ramen.',
  suggestions: [noodles, { menu_item: 5, name: 'Dumplings', quantity: 1 }],
}

// Shows what is in the cart, so a test can see what the Add to cart button did.
function CartProbe() {
  const { state } = useOrderDraft()
  return <p data-testid="cart">{JSON.stringify(state.cart)}</p>
}

// The restaurant page connects the chat to the cart like this.
function Harness({ restaurantId }: { restaurantId: number }) {
  const cart = useCartActions({ id: restaurantId, name: 'Noodle Bar' })
  return (
    <>
      <AssistantChat restaurantId={restaurantId} onAddToCart={cart.addSuggestions} />
      <CartProbe />
    </>
  )
}

function renderChat(draft = {}) {
  return renderWithProvider(<Harness restaurantId={3} />, { restaurantId: 3, ...draft })
}

async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByLabelText(/your question/i), text)
  await user.click(screen.getByRole('button', { name: /^send$/i }))
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

describe('AssistantChat panel', () => {
  it('shows the heading and the question box', () => {
    renderChat()

    expect(screen.getByRole('heading', { name: /ask the assistant/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/your question/i)).toBeInTheDocument()
  })
})

describe('AssistantChat sending', () => {
  it('shows the question, sends it with the restaurant, and shows the reply after it', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reply: 'Try the ramen.', suggestions: [] }))
    const user = userEvent.setup()
    renderChat()

    await ask(user, 'something light')

    const log = screen.getByRole('log', { name: /conversation/i })
    expect(await screen.findByText('Try the ramen.')).toBeInTheDocument()
    expect(log.textContent?.indexOf('something light')).toBeLessThan(log.textContent?.indexOf('Try the ramen.') ?? 0)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/assistant/')
    expect(JSON.parse(init.body)).toEqual({
      restaurant: 3,
      messages: [{ role: 'user', content: 'something light' }],
    })
  })

  it('empties the message box after sending', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reply: 'ok', suggestions: [] }))
    const user = userEvent.setup()
    renderChat()

    await ask(user, 'hello')

    expect(screen.getByLabelText(/your question/i)).toHaveValue('')
  })

  it('sends the earlier questions and replies with the next question, in order', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ reply: 'Try the dumplings.', suggestions: [] }))
      .mockResolvedValueOnce(jsonResponse({ reply: 'Green tea.', suggestions: [] }))
    const user = userEvent.setup()
    renderChat()

    await ask(user, 'something light')
    await screen.findByText('Try the dumplings.')
    await ask(user, 'and a drink?')
    await screen.findByText('Green tea.')

    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages).toEqual([
      { role: 'user', content: 'something light' },
      { role: 'assistant', content: 'Try the dumplings.' },
      { role: 'user', content: 'and a drink?' },
    ])
  })

  it('does not send suggestions back to the server', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(lightReply))
      .mockResolvedValueOnce(jsonResponse({ reply: 'More?', suggestions: [] }))
    const user = userEvent.setup()
    renderChat()

    await ask(user, 'hi')
    await screen.findByText('Try the ramen.')
    await ask(user, 'thanks')
    await screen.findByText('More?')

    for (const message of JSON.parse(fetchMock.mock.calls[1][1].body).messages) {
      expect(Object.keys(message).sort()).toEqual(['content', 'role'])
    }
  })

  it('disables sending while waiting and sends only one request', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    renderChat()

    await ask(user, 'hello')

    const button = screen.getByRole('button', { name: /sending/i })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ignores a second submit while the first question is waiting, even with new text in the box', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    renderChat()
    await ask(user, 'hello')

    const box = screen.getByLabelText(/your question/i)
    fireEvent.change(box, { target: { value: 'second question' } })
    fireEvent.submit(box.closest('form')!)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends only the latest 20 messages of a long conversation', async () => {
    // A new Response for every call: a body can only be read once.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ reply: 'ok', suggestions: [] })))
    const user = userEvent.setup()
    renderChat()
    for (let i = 1; i <= 11; i++) {
      fireEvent.change(screen.getByLabelText(/your question/i), { target: { value: `question ${i}` } })
      await user.click(screen.getByRole('button', { name: /^send$/i }))
      await screen.findAllByText('ok')
      await screen.findByRole('button', { name: /^send$/i })
    }

    const sent = JSON.parse(fetchMock.mock.calls[10][1].body).messages
    expect(sent).toHaveLength(MAX_MESSAGES)
    expect(sent[sent.length - 1]).toEqual({ role: 'user', content: 'question 11' })
    // 21 messages in all, so the oldest one (question 1) is the one left out.
    expect(sent[0]).toEqual({ role: 'assistant', content: 'ok' })
    expect(JSON.stringify(sent)).not.toContain('question 1"')
  })
})

describe('AssistantChat input checks', () => {
  it('sends nothing for a blank message', async () => {
    const user = userEvent.setup()
    renderChat()

    await user.type(screen.getByLabelText(/your question/i), '   ')

    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled()
    fireEvent.submit(screen.getByLabelText(/your question/i).closest('form')!)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('trims the question before sending it', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reply: 'ok', suggestions: [] }))
    const user = userEvent.setup()
    renderChat()

    await ask(user, '  light  ')

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).toBe('light')
  })

  it('refuses a message over the limit and says why', () => {
    renderChat()

    fireEvent.change(screen.getByLabelText(/your question/i), {
      target: { value: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) },
    })

    expect(screen.getByText(/at most 1000 characters/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/your question/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled()
    fireEvent.submit(screen.getByLabelText(/your question/i).closest('form')!)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts a message of exactly the limit', () => {
    renderChat()

    fireEvent.change(screen.getByLabelText(/your question/i), {
      target: { value: 'x'.repeat(MAX_MESSAGE_LENGTH) },
    })

    expect(screen.queryByText(/at most 1000 characters/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^send$/i })).toBeEnabled()
  })
})

describe('AssistantChat failures', () => {
  it.each([
    [503, UNAVAILABLE],
    [429, RATE_LIMITED],
    [502, GENERIC_ERROR],
    [400, GENERIC_ERROR],
  ])('shows the right message for a %i and keeps the conversation', async (status, message) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ reply: 'Try the ramen.', suggestions: [] }))
      .mockResolvedValueOnce(jsonResponse({ detail: 'no' }, status))
    const user = userEvent.setup()
    renderChat()
    await ask(user, 'first question')
    await screen.findByText('Try the ramen.')

    await ask(user, 'second question')

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByText('Try the ramen.')).toBeInTheDocument()
    expect(screen.getByText('first question')).toBeInTheDocument()
  })

  it('takes the unanswered question back into the box so sending again is one click', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: 'no' }, 502))
      .mockResolvedValueOnce(jsonResponse({ reply: 'Now it works.', suggestions: [] }))
    const user = userEvent.setup()
    renderChat()
    await ask(user, 'something light')
    await screen.findByRole('alert')

    expect(screen.getByLabelText(/your question/i)).toHaveValue('something light')
    expect(screen.queryByText('You:', { exact: false })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    expect(await screen.findByText('Now it works.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages).toEqual([
      { role: 'user', content: 'something light' },
    ])
  })

  it('shows the general message when the server cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const user = userEvent.setup()
    renderChat()

    await ask(user, 'hello')

    expect(await screen.findByRole('alert')).toHaveTextContent(GENERIC_ERROR)
  })
})

describe('AssistantChat suggestions', () => {
  it('lists each suggested dish with its quantity and offers one Add to cart control', async () => {
    fetchMock.mockResolvedValue(jsonResponse(lightReply))
    const user = userEvent.setup()
    renderChat()

    await ask(user, 'something light')

    const list = await screen.findByRole('list', { name: /suggested dishes/i })
    expect(list).toHaveTextContent('Ramen × 2')
    expect(list).toHaveTextContent('Dumplings × 1')
    expect(screen.getAllByRole('button', { name: /add to cart/i })).toHaveLength(1)
  })

  it('shows no list or button for a reply without suggestions', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reply: 'We open at nine.', suggestions: [] }))
    const user = userEvent.setup()
    renderChat()

    await ask(user, 'when do you open?')

    await screen.findByText('We open at nine.')
    expect(screen.queryByRole('list', { name: /suggested dishes/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add to cart/i })).not.toBeInTheDocument()
  })

  it('leaves the cart alone until the button is pressed', async () => {
    fetchMock.mockResolvedValue(jsonResponse(lightReply))
    const user = userEvent.setup()
    renderChat()

    await ask(user, 'something light')

    await screen.findByRole('button', { name: /add to cart/i })
    expect(JSON.parse(screen.getByTestId('cart').textContent!)).toEqual({})
  })

  it('adds the suggested quantities to what the cart already holds', async () => {
    fetchMock.mockResolvedValue(jsonResponse(lightReply))
    const user = userEvent.setup()
    renderChat({ cart: { 4: { name: 'Ramen', quantity: 1 } } })
    await ask(user, 'something light')

    await user.click(await screen.findByRole('button', { name: /add to cart/i }))

    expect(JSON.parse(screen.getByTestId('cart').textContent!)).toEqual({
      4: { name: 'Ramen', quantity: 3 },
      5: { name: 'Dumplings', quantity: 1 },
    })
  })

  it('shows the suggestions as added and does not add them twice', async () => {
    fetchMock.mockResolvedValue(jsonResponse(lightReply))
    const user = userEvent.setup()
    renderChat()
    await ask(user, 'something light')

    await user.click(await screen.findByRole('button', { name: /add to cart/i }))

    const added = screen.getByRole('button', { name: /added to cart/i })
    expect(added).toBeDisabled()
    await user.click(added)
    expect(JSON.parse(screen.getByTestId('cart').textContent!)[4].quantity).toBe(2)
  })

  it('places no order and starts no payment when suggestions are added', async () => {
    fetchMock.mockResolvedValue(jsonResponse(lightReply))
    const user = userEvent.setup()
    renderChat()
    await ask(user, 'something light')

    await user.click(await screen.findByRole('button', { name: /add to cart/i }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/assistant\/$/)
  })
})

describe('AssistantChat when the chat is removed', () => {
  it('cancels a question that is still waiting', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    const { unmount } = renderChat()
    await ask(user, 'hello')
    const signal: AbortSignal = fetchMock.mock.calls[0][1].signal

    expect(signal.aborted).toBe(false)
    unmount()

    expect(signal.aborted).toBe(true)
  })

  it('shows nothing from an answer that arrives after the chat was removed', async () => {
    let answer!: () => void
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        answer = () => resolve(jsonResponse({ reply: 'Too late.', suggestions: [] }))
      }),
    )
    const user = userEvent.setup()
    const { unmount } = renderChat()
    await ask(user, 'hello')
    unmount()

    await act(async () => answer())

    expect(screen.queryByText('Too late.')).not.toBeInTheDocument()
  })
})
