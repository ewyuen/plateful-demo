import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import App from '../App'
import { initialOrderDraft } from '../orderDraft'
import { renderApp } from '../testUtils'
import { aCook, aPage, aRestaurant, anAdmin, jsonResponse, stubApi, type ApiHandler } from '../testApi'
import { LOGIN_FAILED, NO_ROLE, TOO_MANY, WRONG_CREDENTIALS } from './LoginPage'
import type { Order } from '../api/types'

const restaurants = [aRestaurant({ id: 1, name: 'Corner Kitchen' }), aRestaurant({ id: 3, name: 'Noodle Bar' })]
const anOrder: Order = {
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

let loginAnswer: () => Response | object = () => aCook()
let queueAnswer: () => Response | object = () => aPage([anOrder])
let moveAnswer: () => Response | object = () => ({ ...anOrder, status: 'preparing' })
const handler: ApiHandler = (url, init) => {
  if (url.pathname === '/api/restaurants/') return aPage(restaurants)
  if (url.pathname === '/api/auth/login/') return loginAnswer()
  if (url.pathname === '/api/auth/logout/') return new Response(null, { status: 204 })
  if (url.pathname === '/api/fulfilment/orders/') return queueAnswer()
  if (/^\/api\/orders\/\d+\/transition\/$/.test(url.pathname) && init?.method === 'POST') return moveAnswer()
  return aPage([])
}
const fetchMock = stubApi((url, init) => handler(url, init))

const page = () => within(screen.getByRole('main'))
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => String(url))

async function signInWith(user: ReturnType<typeof userEvent.setup>, password = 'secret') {
  await user.type(page().getByLabelText('Username'), 'cook')
  await user.type(page().getByLabelText('Password'), password)
  await user.click(page().getByRole('button', { name: 'Sign in' }))
}

describe('the login page', () => {
  it('has a username, a password and a sign-in button', () => {
    renderApp('/login')

    expect(page().getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(page().getByLabelText('Username')).toBeInTheDocument()
    expect(page().getByLabelText('Password')).toHaveAttribute('type', 'password')
  })

  it('signs staff in and shows the fulfilment page with their name in the header', async () => {
    loginAnswer = () => aCook()
    const user = userEvent.setup()
    renderApp('/login')

    await signInWith(user)

    expect(await page().findByRole('heading', { level: 1, name: 'Order queue' })).toBeInTheDocument()
    const header = within(screen.getByRole('banner'))
    expect(header.getByText(/cook \(fulfilment\)/)).toBeInTheDocument()
    expect(header.getByRole('link', { name: 'Fulfilment' })).toBeInTheDocument()
    expect(JSON.parse(String(fetchMock.mock.calls.find(([u]) => String(u).endsWith('/auth/login/'))![1].body))).toEqual({
      username: 'cook',
      password: 'secret',
    })
  })

  it('goes back to the page the user came from', async () => {
    loginAnswer = () => aCook()
    const user = userEvent.setup()
    renderApp('/login?next=%2Forders')

    await signInWith(user)

    expect(await page().findByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument()
  })

  it.each(['https://evil.example/', '//evil.example/', 'javascript:alert(1)'])(
    'ignores an address that leads away from this site (%s)',
    async (next) => {
      loginAnswer = () => aCook()
      const user = userEvent.setup()
      renderApp(`/login?next=${encodeURIComponent(next)}`)

      await signInWith(user)

      expect(await page().findByRole('heading', { level: 1, name: 'Order queue' })).toBeInTheDocument()
    },
  )

  it('says the username or password is wrong, without saying which, and keeps the form', async () => {
    loginAnswer = () => jsonResponse({ detail: 'Wrong username or password.' }, 400)
    const user = userEvent.setup()
    renderApp('/login')

    await signInWith(user, 'nope')

    expect(await page().findByRole('alert')).toHaveTextContent(WRONG_CREDENTIALS)
    expect(page().getByLabelText('Username')).toHaveValue('cook')
    expect(page().getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('says to wait after too many attempts', async () => {
    loginAnswer = () => jsonResponse({ detail: 'Throttled.' }, 429)
    const user = userEvent.setup()
    renderApp('/login')

    await signInWith(user)

    expect(await page().findByRole('alert')).toHaveTextContent(TOO_MANY)
  })

  it('says when the account may not use the staff pages', async () => {
    loginAnswer = () => jsonResponse({ detail: 'No.' }, 403)
    const user = userEvent.setup()
    renderApp('/login')

    await signInWith(user)

    expect(await page().findByRole('alert')).toHaveTextContent(NO_ROLE)
  })

  it('shows one generic message for any other failure', async () => {
    loginAnswer = () => jsonResponse({ detail: 'Server error.' }, 500)
    const user = userEvent.setup()
    renderApp('/login')

    await signInWith(user)

    expect(await page().findByRole('alert')).toHaveTextContent(LOGIN_FAILED)
  })

  it('disables the button while the request is pending and sends one request', async () => {
    loginAnswer = () => new Promise(() => {}) as unknown as Response
    const user = userEvent.setup()
    renderApp('/login')

    await signInWith(user)
    const button = page().getByRole('button', { name: 'Signing in…' })
    expect(button).toBeDisabled()
    await user.click(button)

    expect(posts().filter((url) => url.endsWith('/auth/login/'))).toHaveLength(1)
  })

  it('takes someone who is already signed in straight to the staff page', async () => {
    renderApp('/login', {}, aCook())

    expect(await page().findByRole('heading', { level: 1, name: 'Order queue' })).toBeInTheDocument()
  })
})

describe('the staff-only fulfilment page', () => {
  it('asks nobody-signed-in visitors to sign in, and does not ask for the queue', () => {
    renderApp('/fulfilment')

    expect(page().getByText('This page is for restaurant staff.')).toBeInTheDocument()
    expect(page().getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=%2Ffulfilment')
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/fulfilment/orders/'))).toBe(false)
  })

  it('tells an account with no role that it cannot use the page', () => {
    renderApp('/fulfilment', {}, { username: 'plain', role: null, restaurants: [] })

    expect(page().getByText('Your account cannot use this page.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/fulfilment/orders/'))).toBe(false)
  })

  it('says it is checking while it is not yet known who is signed in', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    // No user is given, so the app asks the server, which has not answered.
    render(
      <MemoryRouter initialEntries={['/fulfilment']}>
        <App initialDraft={initialOrderDraft} />
      </MemoryRouter>,
    )

    expect(page().getByText('Checking your login…')).toBeInTheDocument()
  })

  it('shows a cook only their own restaurants and says whose queue it is', async () => {
    renderApp('/fulfilment', {}, aCook())

    expect(page().getByText(/Signed in as cook\. Showing the orders of Corner Kitchen\./)).toBeInTheDocument()
    const select = page().getByLabelText('Restaurant')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All restaurants', 'Corner Kitchen'])
    await page().findByRole('heading', { name: 'Order #42' })
  })

  it('shows an admin every restaurant', async () => {
    renderApp('/fulfilment', {}, anAdmin())

    await waitFor(() => {
      const select = page().getByLabelText('Restaurant')
      expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'All restaurants',
        'Corner Kitchen',
        'Noodle Bar',
      ])
    })
  })

  it('says so when a cook works for no restaurant yet', () => {
    renderApp('/fulfilment', {}, aCook({ restaurants: [] }))

    expect(page().getByText(/do not work for any restaurant yet/i)).toBeInTheDocument()
  })

  it('goes back to "sign in" when the server stops accepting the session', async () => {
    queueAnswer = () => jsonResponse({ detail: 'Staff only.' }, 403)
    renderApp('/fulfilment', {}, aCook())

    expect(await page().findByText('This page is for restaurant staff.')).toBeInTheDocument()
    queueAnswer = () => aPage([anOrder])
  })

  it('goes back to "sign in" when moving an order is refused with 403', async () => {
    moveAnswer = () => jsonResponse({ detail: 'Staff only.' }, 403)
    const user = userEvent.setup()
    renderApp('/fulfilment', {}, aCook())

    await user.click(await page().findByRole('button', { name: 'Start preparing' }))

    expect(await page().findByText('This page is for restaurant staff.')).toBeInTheDocument()
    moveAnswer = () => ({ ...anOrder, status: 'preparing' })
  })
})

describe('the header', () => {
  it('shows Login and no Fulfilment link when nobody is signed in', () => {
    renderApp('/')

    const header = within(screen.getByRole('banner'))
    expect(header.getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login')
    expect(header.queryByRole('link', { name: 'Fulfilment' })).not.toBeInTheDocument()
    expect(header.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument()
  })

  it('shows the user, their role and a Log out button when signed in', () => {
    renderApp('/', {}, anAdmin())

    const header = within(screen.getByRole('banner'))
    expect(header.getByText(/boss \(admin\)/)).toBeInTheDocument()
    expect(header.queryByRole('link', { name: 'Login' })).not.toBeInTheDocument()
  })

  it('logs out, asks the server to end the session and shows Login again', async () => {
    const user = userEvent.setup()
    renderApp('/', {}, aCook())

    await user.click(screen.getByRole('button', { name: 'Log out' }))

    expect(await screen.findByRole('link', { name: 'Login' })).toBeInTheDocument()
    expect(posts()).toContain('http://localhost:8000/api/auth/logout/')
    expect(screen.queryByRole('link', { name: 'Fulfilment' })).not.toBeInTheDocument()
  })
})
