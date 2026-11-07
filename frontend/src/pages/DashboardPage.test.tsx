import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../testUtils'
import { aCook, aCustomer, anAdmin, anOwner, aPage, jsonResponse, stubApi } from '../testApi'
import type { DashboardOrder, DashboardOrders } from '../api/types'
import { DASHBOARD_POLL_MS } from './DashboardPage'

function anOrder(overrides: Partial<DashboardOrder> = {}): DashboardOrder {
  return {
    id: 1,
    restaurant: 1,
    restaurant_name: 'Corner Kitchen',
    customer_name: 'Sam',
    status: 'confirmed',
    fulfilment_type: 'pickup',
    created_at: '2026-11-07T20:00:00Z',
    item_count: 2,
    total: '12.00',
    ...overrides,
  }
}

const ORDERS: DashboardOrder[] = [
  anOrder({ id: 44, restaurant: 4, restaurant_name: 'Tea House', customer_name: 'Mei Lin', total: '12.50', created_at: '2026-11-07T21:41:00Z' }),
  anOrder({ id: 43, restaurant: 3, restaurant_name: 'Noodle Bar', customer_name: 'Ana Cruz', total: '9.50', status: 'preparing', created_at: '2026-11-07T21:40:00Z' }),
  anOrder({ id: 38, restaurant: 2, restaurant_name: 'Golden Wok', customer_name: 'Kai Ito', total: '41.50', status: 'out_for_delivery', fulfilment_type: 'delivery', created_at: '2026-11-07T20:58:00Z' }),
  anOrder({ id: 37, restaurant: 1, restaurant_name: 'Corner Kitchen', customer_name: 'Rosa Diaz', total: '33.00', status: 'completed', created_at: '2026-11-07T20:41:00Z' }),
  anOrder({ id: 35, restaurant: 3, restaurant_name: 'Noodle Bar', customer_name: 'Tia Cole', total: '21.00', status: 'cancelled', created_at: '2026-11-07T19:55:00Z' }),
]

let answer: () => Response | DashboardOrders = () => ({ count: ORDERS.length, truncated: false, results: ORDERS })
const fetchMock = stubApi((url) => {
  if (url.pathname === '/api/dashboard/orders/') return answer()
  return {}
})

const asked = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/dashboard/orders/')).length

// The order numbers shown in the table, top to bottom (the Order column is pinned left).
function shownIds(): string[] {
  const cells = Array.from(document.querySelectorAll<HTMLElement>('.ag-row [role="gridcell"][col-id="id"]'))
  return cells.sort((a, b) => rowIndex(a) - rowIndex(b)).map((cell) => cell.textContent ?? '')
}
function rowIndex(cell: HTMLElement): number {
  return Number(cell.closest('[role="row"]')?.getAttribute('row-index') ?? 0)
}

// Whether a column's heading sits in the pinned-left part of the table.
function isPinnedLeft(colId: string): boolean {
  const heading = document.querySelector(`.ag-header-cell[col-id="${colId}"]`)
  return heading?.closest('[class*="pinned-left"]') != null
}

async function openDashboard() {
  renderApp('/dashboard', {}, anOwner())
  await screen.findByText('Tea House')
}

// AG Grid reports a missing module (a feature we use but did not register) with console.error.
// That would silently break the feature in the browser, so any such message fails the test.
let gridMessages: string[] = []
beforeEach(() => {
  answer = () => ({ count: ORDERS.length, truncated: false, results: ORDERS })
  gridMessages = []
  const collect = (...args: unknown[]) => {
    const text = args.map(String).join(' ')
    if (text.includes('AG Grid')) gridMessages.push(text.slice(0, 200))
  }
  vi.spyOn(console, 'error').mockImplementation(collect)
  vi.spyOn(console, 'warn').mockImplementation(collect)
})
afterEach(() => {
  vi.restoreAllMocks()
  expect(gridMessages).toEqual([])
})

describe('who may open the dashboard', () => {
  it('shows the table to an owner', async () => {
    await openDashboard()

    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(asked()).toBeGreaterThan(0)
  })

  it('asks a visitor to sign in and asks the server for nothing', () => {
    renderApp('/dashboard')

    expect(screen.getByText('This page is for the owner.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=%2Fdashboard')
    expect(asked()).toBe(0)
  })

  it.each([
    ['an admin', anAdmin()],
    ['a fulfilment user', aCook()],
    ['a customer', aCustomer()],
    ['an account with no role', { username: 'plain', role: null, restaurants: [] }],
  ])('tells %s their account cannot use the page and asks the server for nothing', (_name, user) => {
    renderApp('/dashboard', {}, user)

    expect(screen.getByText('Your account cannot use this page.')).toBeInTheDocument()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    expect(asked()).toBe(0)
  })

  it('treats the user as signed out when the server answers 403', async () => {
    answer = () => jsonResponse({ detail: 'Admins only.' }, 403)
    renderApp('/dashboard', {}, anOwner())

    expect(await screen.findByText('This page is for the owner.')).toBeInTheDocument()
  })
})

describe('the header and the sign-in landing', () => {
  it.each([
    ['nobody', null],
    ['an admin', anAdmin()],
    ['a fulfilment user', aCook()],
    ['a customer', aCustomer()],
    ['an account with no role', { username: 'plain', role: null, restaurants: [] }],
  ])('shows no Dashboard link to %s', (_name, user) => {
    renderApp('/', {}, user)

    expect(within(screen.getByRole('banner')).queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()
  })

  it('shows the Dashboard link and no Fulfilment link to an owner', () => {
    renderApp('/', {}, anOwner())

    const header = within(screen.getByRole('banner'))
    expect(header.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard')
    expect(header.queryByRole('link', { name: 'Fulfilment' })).not.toBeInTheDocument()
    expect(header.getByText(/the-owner \(owner\)/)).toBeInTheDocument()
  })

  it('shows an admin the Fulfilment link and no Dashboard link', () => {
    renderApp('/', {}, anAdmin())

    const header = within(screen.getByRole('banner'))
    expect(header.getByRole('link', { name: 'Fulfilment' })).toBeInTheDocument()
    expect(header.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()
  })

  it('takes an owner who signs in to the dashboard, and the link goes away on log out', async () => {
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/auth/login/')) return jsonResponse(anOwner())
      if (url.pathname.endsWith('/auth/logout/')) return new Response(null, { status: 204 })
      if (url.pathname === '/api/dashboard/orders/') return jsonResponse({ count: 0, truncated: false, results: [] })
      return jsonResponse({}, init?.method === 'POST' ? 200 : 200)
    })
    const user = userEvent.setup()
    renderApp('/login')

    await user.type(screen.getByLabelText('Username'), 'the-owner')
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Log out' }))
    await waitFor(() =>
      expect(within(screen.getByRole('banner')).queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument(),
    )
  })
})

describe('the sign-in landing for an admin', () => {
  it('takes an admin who signs in to the fulfilment page, not the dashboard', async () => {
    fetchMock.mockImplementation(async (input: string) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/auth/login/')) return jsonResponse(anAdmin())
      if (url.pathname === '/api/fulfilment/orders/') return jsonResponse(aPage([]))
      return jsonResponse({})
    })
    const user = userEvent.setup()
    renderApp('/login')

    await user.type(screen.getByLabelText('Username'), 'boss')
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Order queue' })).toBeInTheDocument()
    expect(asked()).toBe(0)
  })
})

describe('the orders table', () => {
  it('shows the orders of every restaurant, newest first, with no order buttons', async () => {
    await openDashboard()

    await waitFor(() => expect(shownIds()).toEqual(['44', '43', '38', '37', '35']))
    for (const name of ['Tea House', 'Noodle Bar', 'Golden Wok', 'Corner Kitchen']) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0)
    }
    expect(screen.queryByRole('button', { name: /start|mark|send|cancel/i })).not.toBeInTheDocument()
  })

  it('shows a status as words', async () => {
    await openDashboard()

    expect(await screen.findByText('Confirmed')).toBeInTheDocument()
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    expect(screen.getByText('Out for delivery')).toBeInTheDocument()
  })

  it('sorts the Total as numbers, so 9.50 comes before 12.50', async () => {
    const user = userEvent.setup()
    await openDashboard()

    await user.click(document.querySelector('.ag-header-cell[col-id="total"] .ag-header-cell-label')!)

    await waitFor(() => expect(shownIds().slice(0, 2)).toEqual(['43', '44']))
  })

  it('narrows the rows to those that contain the searched text', async () => {
    const user = userEvent.setup()
    await openDashboard()

    await user.type(screen.getByLabelText('Search orders'), 'noodle')

    await waitFor(() => expect(shownIds()).toEqual(['43', '35']))
  })

  it('filters a column', async () => {
    const user = userEvent.setup()
    await openDashboard()

    await user.type(screen.getByLabelText('Customer Filter Input'), 'Kai')

    await waitFor(() => expect(shownIds()).toEqual(['38']))
  })

  it('says there are no orders when the list is empty', async () => {
    answer = () => ({ count: 0, truncated: false, results: [] })
    renderApp('/dashboard', {}, anOwner())

    expect(await screen.findByText('There are no orders yet.')).toBeInTheDocument()
  })

  it('says only the newest orders are shown when the list was cut', async () => {
    answer = () => ({ count: 1240, truncated: true, results: ORDERS })
    renderApp('/dashboard', {}, anOwner())

    expect(await screen.findByText('Showing the newest 5 of 1,240 orders.')).toBeInTheDocument()
  })
})

describe('the totals line', () => {
  it('counts the rows shown and adds their amounts, with a note about cancelled orders', async () => {
    await openDashboard()

    expect(await screen.findByText('Showing 5 orders · $117.50')).toBeInTheDocument()
    expect(screen.getByText(/Includes 1 cancelled order\./)).toBeInTheDocument()
  })

  it('follows the search', async () => {
    const user = userEvent.setup()
    await openDashboard()

    await user.type(screen.getByLabelText('Search orders'), 'tea house')

    expect(await screen.findByText('Showing 1 order · $12.50')).toBeInTheDocument()
    expect(screen.queryByText(/cancelled/)).not.toBeInTheDocument()
  })

  it('follows a filter on a column', async () => {
    const user = userEvent.setup()
    await openDashboard()

    await user.type(screen.getByLabelText('Status Filter Input'), 'Completed')

    expect(await screen.findByText('Showing 1 order · $33.00')).toBeInTheDocument()
  })

  it('adds exactly: 0.10 + 0.20 + 0.30 is $0.60', async () => {
    answer = () => ({
      count: 3,
      truncated: false,
      results: [
        anOrder({ id: 1, total: '0.10', restaurant_name: 'A' }),
        anOrder({ id: 2, total: '0.20', restaurant_name: 'A' }),
        anOrder({ id: 3, total: '0.30', restaurant_name: 'A' }),
      ],
    })
    renderApp('/dashboard', {}, anOwner())

    expect(await screen.findByText('Showing 3 orders · $0.60')).toBeInTheDocument()
  })
})

describe('the Order column', () => {
  it('stays in view on the left, and the page offers no pin control', async () => {
    await openDashboard()

    await waitFor(() => expect(isPinnedLeft('id')).toBe(true))
    expect(isPinnedLeft('restaurant')).toBe(false)
    expect(screen.queryByRole('group', { name: 'Pin columns' })).not.toBeInTheDocument()
  })
})

describe('keeping current', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  it('fetches again every 15 seconds and updates a changed row in place', async () => {
    renderApp('/dashboard', {}, anOwner())
    await screen.findByText('Tea House')
    const before = asked()
    answer = () => ({
      count: ORDERS.length,
      truncated: false,
      results: [{ ...ORDERS[0], status: 'ready' }, ...ORDERS.slice(1)],
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_MS + 100)
    })

    expect(asked()).toBe(before + 1)
    expect(await screen.findByText('Ready')).toBeInTheDocument()
    expect(shownIds()).toEqual(['44', '43', '38', '37', '35'])
  })

  it('keeps the rows and shows an error when a refresh fails', async () => {
    renderApp('/dashboard', {}, anOwner())
    await screen.findByText('Tea House')
    answer = () => jsonResponse({ detail: 'boom' }, 500)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_MS + 100)
    })

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getAllByText('Tea House').length).toBeGreaterThan(0)
  })

  it('stops fetching when the page is left', async () => {
    const { unmount } = renderApp('/dashboard', {}, anOwner())
    await screen.findByText('Tea House')
    unmount()
    const before = asked()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DASHBOARD_POLL_MS * 3)
    })

    expect(asked()).toBe(before)
  })
})
