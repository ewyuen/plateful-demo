import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../testUtils'
import { aCook, aCustomer, aPage, aRestaurant, jsonResponse, stubApi, type ApiHandler } from '../testApi'
import { NOT_FOUND, TOO_MANY as LOOKUP_TOO_MANY, ADDED } from '../components/FindOrder'
import { REGISTER_FAILED, TOO_MANY } from './RegisterPage'

const A = 'ABCDEFGHJKMN'

function guestOrder(code: string, restaurant = 'Corner Kitchen') {
  return {
    restaurant_name: restaurant,
    status: 'confirmed',
    created_at: '2026-11-01T10:00:00Z',
    fulfilment_type: 'pickup',
    items: [{ menu_item_name: 'Spring Rolls', quantity: 2, unit_price: '6.50' }],
    delivery_fee: '0.00',
    total: '13.00',
    public_code: code,
  }
}

let registerAnswer: () => Response | object = () => aCustomer()
let attachAnswer: () => Response | object = () => guestOrder(A)
let mine: object[] = []
const handler: ApiHandler = (url, init) => {
  if (url.pathname === '/api/restaurants/') return aPage([aRestaurant()])
  if (url.pathname === '/api/auth/register/') return registerAnswer()
  if (url.pathname === '/api/my-orders/attach/') {
    const answer = attachAnswer()
    if (!(answer instanceof Response)) mine = [answer, ...mine]
    return answer
  }
  if (url.pathname === '/api/my-orders/') return mine
  if (url.pathname === '/api/orders/lookup/') return guestOrder(A)
  if (url.pathname === '/api/auth/logout/') return new Response(null, { status: 204 })
  return init ? [] : aPage([])
}
const fetchMock = stubApi((url, init) => handler(url, init))
const page = () => within(screen.getByRole('main'))
const nav = () => within(screen.getByRole('navigation', { name: 'Main' }))
const calls = (path: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(path))

beforeEach(() => {
  registerAnswer = () => aCustomer()
  attachAnswer = () => guestOrder(A)
  mine = []
})

async function fillRegister(user: ReturnType<typeof userEvent.setup>, name = 'shopper', password = 'a-good-password-1') {
  await user.type(page().getByLabelText('Username'), name)
  await user.type(page().getByLabelText('Password'), password)
  await user.click(page().getByRole('button', { name: 'Register' }))
}

describe('the register page', () => {
  it('has a username, a password and a Register button, and a link to sign in', () => {
    renderApp('/register')

    expect(page().getByRole('heading', { level: 1, name: 'Register' })).toBeInTheDocument()
    expect(page().getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(page().getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })

  it('registers, shows My orders and puts the name in the header', async () => {
    const user = userEvent.setup()
    renderApp('/register')

    await fillRegister(user)

    expect(await page().findByRole('heading', { level: 1, name: 'My orders' })).toBeInTheDocument()
    expect(nav().getByText('shopper')).toBeInTheDocument()
    expect(JSON.parse(String(calls('/auth/register/')[0][1]?.body))).toEqual({
      username: 'shopper',
      password: 'a-good-password-1',
    })
  })

  it("shows the server's words for a refusal and keeps the form", async () => {
    registerAnswer = () => jsonResponse({ detail: 'That username is taken.' }, 400)
    const user = userEvent.setup()
    renderApp('/register')

    await fillRegister(user)

    expect(await page().findByRole('alert')).toHaveTextContent('That username is taken.')
    expect(page().getByLabelText('Username')).toHaveValue('shopper')
    expect(page().getByRole('button', { name: 'Register' })).toBeEnabled()
  })

  it('asks the user to wait after too many attempts', async () => {
    registerAnswer = () => jsonResponse({}, 429)
    const user = userEvent.setup()
    renderApp('/register')

    await fillRegister(user)

    expect(await page().findByRole('alert')).toHaveTextContent(TOO_MANY)
  })

  it('says it could not register for any other failure', async () => {
    registerAnswer = () => jsonResponse({}, 500)
    const user = userEvent.setup()
    renderApp('/register')

    await fillRegister(user)

    expect(await page().findByRole('alert')).toHaveTextContent(REGISTER_FAILED)
  })

  it('disables the button while the request is pending', async () => {
    let release: (value: Response) => void = () => {}
    registerAnswer = () => new Promise<Response>((resolve) => (release = resolve)) as unknown as Response
    const user = userEvent.setup()
    renderApp('/register')

    await fillRegister(user)

    expect(page().getByRole('button', { name: 'Registering…' })).toBeDisabled()
    release(jsonResponse(aCustomer(), 201))
    await page().findByRole('heading', { name: 'My orders' })
  })

  it('sends a customer who is already signed in on to My orders', () => {
    renderApp('/register', {}, aCustomer())

    expect(page().getByRole('heading', { level: 1, name: 'My orders' })).toBeInTheDocument()
  })
})

describe('signing in as a customer', () => {
  it('takes a customer who is signed in to My orders from the login page', () => {
    renderApp('/login', {}, aCustomer())

    expect(page().getByRole('heading', { level: 1, name: 'My orders' })).toBeInTheDocument()
  })

  it('still takes staff to the fulfilment page', () => {
    renderApp('/login', {}, aCook())

    expect(page().getByRole('heading', { name: /order queue/i })).toBeInTheDocument()
  })

  it('links to the register page', () => {
    renderApp('/login')

    expect(page().getByRole('link', { name: 'Register' })).toHaveAttribute('href', '/register')
  })
})

describe('the header', () => {
  it('offers Login, and no Register link, when nobody is signed in', () => {
    renderApp('/')

    expect(nav().getByRole('link', { name: 'Login' })).toBeInTheDocument()
    expect(nav().queryByRole('link', { name: 'Register' })).not.toBeInTheDocument()
    expect(nav().queryByRole('link', { name: 'My orders' })).not.toBeInTheDocument()
  })

  it('gives a customer My orders and their name, and no Fulfilment link', () => {
    renderApp('/', {}, aCustomer())

    expect(nav().getByRole('link', { name: 'My orders' })).toHaveAttribute('href', '/my-orders')
    expect(nav().getByText('shopper')).toBeInTheDocument()
    expect(nav().queryByRole('link', { name: 'Fulfilment' })).not.toBeInTheDocument()
    expect(nav().queryByRole('link', { name: 'Register' })).not.toBeInTheDocument()
    expect(nav().getByRole('button', { name: 'Log out' })).toBeInTheDocument()
  })

  it('gives staff Fulfilment and no My orders link', () => {
    renderApp('/', {}, aCook())

    expect(nav().getByRole('link', { name: 'Fulfilment' })).toBeInTheDocument()
    expect(nav().queryByRole('link', { name: 'My orders' })).not.toBeInTheDocument()
  })
})

describe('the fulfilment page for a customer', () => {
  it('says the account cannot use the page and asks for no queue', () => {
    renderApp('/fulfilment', {}, aCustomer())

    expect(page().getByText('Your account cannot use this page.')).toBeInTheDocument()
    expect(calls('/fulfilment/orders/')).toHaveLength(0)
  })
})

describe('the My orders page', () => {
  it('offers sign in and register to nobody and asks for no orders', () => {
    renderApp('/my-orders')

    expect(page().getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=%2Fmy-orders')
    expect(page().getByRole('link', { name: 'register' })).toHaveAttribute('href', '/register')
    expect(calls('/my-orders/')).toHaveLength(0)
  })

  it('tells staff the page is for customers and asks for no orders', () => {
    renderApp('/my-orders', {}, aCook())

    expect(page().getByText(/This page is for customers/)).toBeInTheDocument()
    expect(calls('/my-orders/')).toHaveLength(0)
  })

  it('says a new customer has no orders yet', async () => {
    renderApp('/my-orders', {}, aCustomer())

    expect(await page().findByText('You have not added an order yet.')).toBeInTheDocument()
  })

  it('lists the orders the server returns, without a name or an address', async () => {
    mine = [guestOrder(A), guestOrder('PQRSTUVWXYZ2', 'Noodle Bar')]
    renderApp('/my-orders', {}, aCustomer())

    expect(await page().findByText('Noodle Bar')).toBeInTheDocument()
    expect(page().getByText('Corner Kitchen')).toBeInTheDocument()
    expect(page().getAllByText(/Total \$13\.00/)).toHaveLength(2)
  })

  it('adds an order by its code and lists it', async () => {
    const user = userEvent.setup()
    renderApp('/my-orders', {}, aCustomer())
    await page().findByText('You have not added an order yet.')

    await user.type(page().getByLabelText('Order code'), 'abcd-efgh-jkmn')
    await user.click(page().getByRole('button', { name: 'Add to my account' }))

    expect(await page().findByText('Corner Kitchen')).toBeInTheDocument()
    expect(JSON.parse(String(calls('/my-orders/attach/')[0][1]?.body))).toEqual({ code: 'abcd-efgh-jkmn' })
    expect(page().getByLabelText('Order code')).toHaveValue('')
  })

  it('asks for a code when the field is empty and sends nothing', async () => {
    const user = userEvent.setup()
    renderApp('/my-orders', {}, aCustomer())
    await page().findByText('You have not added an order yet.')

    await user.click(page().getByRole('button', { name: 'Add to my account' }))

    expect(page().getByRole('alert')).toHaveTextContent('Enter your order code.')
    expect(calls('/my-orders/attach/')).toHaveLength(0)
  })

  it('gives one message for a wrong, unknown or taken code', async () => {
    attachAnswer = () => jsonResponse({ detail: 'No order was found for that code.' }, 404)
    const user = userEvent.setup()
    renderApp('/my-orders', {}, aCustomer())
    await page().findByText('You have not added an order yet.')

    await user.type(page().getByLabelText('Order code'), 'ZZZZ-ZZZZ-ZZZZ')
    await user.click(page().getByRole('button', { name: 'Add to my account' }))

    expect(await page().findByRole('alert')).toHaveTextContent(NOT_FOUND)
    expect(page().getByLabelText('Order code')).toHaveValue('ZZZZ-ZZZZ-ZZZZ')
  })

  it('asks the user to wait after too many tries', async () => {
    attachAnswer = () => jsonResponse({}, 429)
    const user = userEvent.setup()
    renderApp('/my-orders', {}, aCustomer())
    await page().findByText('You have not added an order yet.')

    await user.type(page().getByLabelText('Order code'), A)
    await user.click(page().getByRole('button', { name: 'Add to my account' }))

    expect(await page().findByRole('alert')).toHaveTextContent(LOOKUP_TOO_MANY)
  })

  it('treats a 403 as the session having ended', async () => {
    attachAnswer = () => jsonResponse({ detail: 'Customers only.' }, 403)
    const user = userEvent.setup()
    renderApp('/my-orders', {}, aCustomer())
    await page().findByText('You have not added an order yet.')

    await user.type(page().getByLabelText('Order code'), A)
    await user.click(page().getByRole('button', { name: 'Add to my account' }))

    expect(await page().findByRole('link', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shows signed out after logging out', async () => {
    const user = userEvent.setup()
    renderApp('/my-orders', {}, aCustomer())
    await page().findByText('You have not added an order yet.')

    await user.click(nav().getByRole('button', { name: 'Log out' }))

    expect(await page().findByRole('link', { name: 'register' })).toBeInTheDocument()
  })
})

describe('adding a found order to my account', () => {
  async function find(user: ReturnType<typeof userEvent.setup>) {
    await user.type(page().getByLabelText('Order code'), A)
    await user.click(page().getByRole('button', { name: 'Find' }))
    await page().findByText('Corner Kitchen')
  }

  it('lets a signed-in customer add it and then says it is added', async () => {
    const user = userEvent.setup()
    renderApp('/orders', {}, aCustomer())
    await find(user)

    await user.click(page().getByRole('button', { name: 'Add to my account' }))

    expect(await page().findByText(ADDED)).toBeInTheDocument()
    expect(calls('/my-orders/attach/')).toHaveLength(1)
  })

  it('says it was not found when the order is already on an account', async () => {
    attachAnswer = () => jsonResponse({ detail: 'No order was found for that code.' }, 404)
    const user = userEvent.setup()
    renderApp('/orders', {}, aCustomer())
    await find(user)

    await user.click(page().getByRole('button', { name: 'Add to my account' }))

    await waitFor(() => expect(page().getByRole('alert')).toHaveTextContent(NOT_FOUND))
    expect(page().getByRole('button', { name: 'Add to my account' })).toBeEnabled()
  })

  it('offers sign in and register to a signed-out visitor, with no button', async () => {
    const user = userEvent.setup()
    renderApp('/orders')
    await find(user)

    expect(page().queryByRole('button', { name: 'Add to my account' })).not.toBeInTheDocument()
    expect(page().getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=%2Forders')
    expect(page().getByRole('link', { name: 'register' })).toHaveAttribute('href', '/register')
  })

  it('shows staff neither the button nor the note', async () => {
    const user = userEvent.setup()
    renderApp('/orders', {}, aCook())
    await find(user)

    expect(page().queryByRole('button', { name: 'Add to my account' })).not.toBeInTheDocument()
    expect(page().queryByRole('link', { name: 'register' })).not.toBeInTheDocument()
  })
})

describe('the confirmation after paying', () => {
  const paid = { pathname: '/orders', state: { paidCode: A } }

  it('tells a signed-in customer the order is already in My orders', () => {
    renderApp(paid, {}, aCustomer())

    expect(page().getByText(/Payment received/)).toBeInTheDocument()
    expect(page().getByRole('link', { name: 'My orders' })).toHaveAttribute('href', '/my-orders')
  })

  it('says nothing about My orders to a guest', () => {
    renderApp(paid)

    expect(page().getByText(/Payment received/)).toBeInTheDocument()
    expect(page().queryByRole('link', { name: 'My orders' })).not.toBeInTheDocument()
  })

  it('says nothing about My orders to staff', () => {
    renderApp(paid, {}, aCook())

    expect(page().getByText(/Payment received/)).toBeInTheDocument()
    expect(page().queryByRole('link', { name: 'My orders' })).not.toBeInTheDocument()
  })
})
