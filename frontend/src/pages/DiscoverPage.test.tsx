import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../testUtils'
import { aPage, aRestaurant, jsonResponse, stubApi, type ApiHandler } from '../testApi'

const corner = aRestaurant({ id: 1, name: 'Corner Kitchen', cuisine: 'Chinese', address: '1 Main St' })
const wok = aRestaurant({ id: 4, name: 'Golden Wok', cuisine: 'Cantonese', address: '48 Harbour Road' })
const bar = aRestaurant({ id: 3, name: 'Noodle Bar', cuisine: 'Noodles', address: '2 Side St.' })

// The fake API narrows like the real one, so the page's requests are what is under test.
const api: ApiHandler = (url) => {
  if (url.pathname === '/api/restaurants/cuisines/') return ['Cantonese', 'Chinese', 'Noodles']
  const search = (url.searchParams.get('search') ?? '').toLowerCase()
  const cuisine = (url.searchParams.get('cuisine') ?? '').toLowerCase()
  const matching = [corner, wok, bar].filter(
    (r) =>
      (search === '' || `${r.name} ${r.cuisine}`.toLowerCase().includes(search)) &&
      (cuisine === '' || r.cuisine.toLowerCase() === cuisine),
  )
  return aPage(matching)
}

const fetchMock = stubApi(api)

// The header also has a "Corner Kitchen" link, so restaurant links are looked up in the page.
function inMain() {
  return within(screen.getByRole('main'))
}

function requestedRestaurantUrls(): string[] {
  return fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => /\/restaurants\/(\?|$)/.test(url))
}

describe('the hero and search box', () => {
  it('shows the hero photo, the heading and the labelled search box', async () => {
    renderApp('/')

    expect(screen.getByRole('heading', { level: 1, name: /across the network/i })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /dining room/i })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search restaurants' })).toBeInTheDocument()
    await inMain().findByRole('link', { name: 'Corner Kitchen' })
  })

  it('has no hero on other pages', () => {
    renderApp('/orders')

    expect(screen.queryByRole('img', { name: /dining room/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })
})

describe('the restaurant cards', () => {
  it('shows each restaurant with its cuisine and address, linking to its page', async () => {
    renderApp('/')

    const link = await inMain().findByRole('link', { name: 'Golden Wok' })
    expect(link).toHaveAttribute('href', '/restaurants/4')
    const card = link.closest('li') as HTMLElement
    expect(within(card).getByText('Cantonese')).toBeInTheDocument()
    expect(within(card).getByText('48 Harbour Road')).toBeInTheDocument()
    expect(card.querySelector('img')).toHaveAttribute('alt', '')
  })

  it("uses the restaurant's own image link when it has one", async () => {
    fetchMock.mockImplementation(async (input: string) =>
      jsonResponse(
        String(input).includes('cuisines')
          ? []
          : aPage([aRestaurant({ id: 9, name: 'Pictured', image_url: 'https://pics.example/p.jpg' })]),
      ),
    )
    renderApp('/')

    const link = await inMain().findByRole('link', { name: 'Pictured' })

    expect((link.closest('li') as HTMLElement).querySelector('img')).toHaveAttribute(
      'src',
      'https://pics.example/p.jpg',
    )
  })

  it('states how many restaurants are shown', async () => {
    renderApp('/')

    expect(await screen.findByRole('heading', { name: '3 restaurants' })).toBeInTheDocument()
  })

  it('says "1 restaurant" for one', async () => {
    renderApp('/?cuisine=Noodles')

    expect(await screen.findByRole('heading', { name: '1 restaurant' })).toBeInTheDocument()
  })

  it('shows only the first page and makes no further request', async () => {
    fetchMock.mockImplementation(async (input: string) =>
      jsonResponse(
        String(input).includes('cuisines')
          ? []
          : aPage([corner], { count: 45, next: 'http://localhost:8000/api/restaurants/?page=2' }),
      ),
    )
    renderApp('/')

    await inMain().findByRole('link', { name: 'Corner Kitchen' })

    expect(requestedRestaurantUrls()).toHaveLength(1)
  })
})

describe('searching', () => {
  it('asks the API for the text, and puts it in the address', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await inMain().findByRole('link', { name: 'Corner Kitchen' })

    await user.type(screen.getByRole('searchbox'), 'wok')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByRole('heading', { name: '1 restaurant' })).toBeInTheDocument()
    expect(inMain().getByRole('link', { name: 'Golden Wok' })).toBeInTheDocument()
    expect(inMain().queryByRole('link', { name: 'Corner Kitchen' })).not.toBeInTheDocument()
    expect(requestedRestaurantUrls().at(-1)).toBe('http://localhost:8000/api/restaurants/?search=wok')
  })

  it('does not search while typing', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await inMain().findByRole('link', { name: 'Corner Kitchen' })
    const before = requestedRestaurantUrls().length

    await user.type(screen.getByRole('searchbox'), 'wok')

    expect(requestedRestaurantUrls()).toHaveLength(before)
  })

  it('opens an address with a search already applied', async () => {
    renderApp('/?search=wok')

    expect(await inMain().findByRole('link', { name: 'Golden Wok' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('wok')
    expect(inMain().queryByRole('link', { name: 'Noodle Bar' })).not.toBeInTheDocument()
  })
})

describe('cuisine chips', () => {
  it('shows All cuisines first and one chip per cuisine, with All pressed', async () => {
    renderApp('/')

    const group = await screen.findByRole('group', { name: 'Filter by cuisine' })
    const names = within(group).getAllByRole('button').map((button) => button.textContent?.replace('✓ ', ''))
    expect(names).toEqual(['All cuisines', 'Cantonese', 'Chinese', 'Noodles'])
    expect(within(group).getByRole('button', { name: /All cuisines/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('narrows to a cuisine, marks the chip with more than colour and updates the address', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await inMain().findByRole('link', { name: 'Corner Kitchen' })

    await user.click(screen.getByRole('button', { name: 'Noodles' }))

    expect(await screen.findByRole('heading', { name: '1 restaurant' })).toBeInTheDocument()
    expect(inMain().getByRole('link', { name: 'Noodle Bar' })).toBeInTheDocument()
    const chip = screen.getByRole('button', { name: /Noodles/ })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(chip).toHaveTextContent('✓')
    expect(requestedRestaurantUrls().at(-1)).toBe('http://localhost:8000/api/restaurants/?cuisine=Noodles')
  })

  it('sends the search and the cuisine together', async () => {
    const user = userEvent.setup()
    renderApp('/?search=corner')
    await inMain().findByRole('link', { name: 'Corner Kitchen' })

    await user.click(screen.getByRole('button', { name: 'Chinese' }))

    await screen.findByRole('heading', { name: '1 restaurant' })
    expect(requestedRestaurantUrls().at(-1)).toBe(
      'http://localhost:8000/api/restaurants/?search=corner&cuisine=Chinese',
    )
  })

  it('removes the cuisine with All cuisines but keeps the search', async () => {
    const user = userEvent.setup()
    renderApp('/?search=corner&cuisine=Chinese')
    await inMain().findByRole('link', { name: 'Corner Kitchen' })

    await user.click(screen.getByRole('button', { name: /All cuisines/ }))

    await screen.findByRole('heading', { name: '1 restaurant' })
    expect(requestedRestaurantUrls().at(-1)).toBe('http://localhost:8000/api/restaurants/?search=corner')
  })

  it('still shows the restaurants when the cuisines cannot load', async () => {
    fetchMock.mockImplementation(async (input: string) =>
      String(input).includes('cuisines') ? jsonResponse({}, 500) : jsonResponse(aPage([corner])),
    )
    renderApp('/')

    expect(await inMain().findByRole('link', { name: 'Corner Kitchen' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Filter by cuisine' })).not.toBeInTheDocument()
  })
})

describe('loading, errors and no match', () => {
  it('says it is loading until the restaurants arrive', async () => {
    renderApp('/')

    expect(screen.getByText('Loading restaurants…')).toBeInTheDocument()
    await inMain().findByRole('link', { name: 'Corner Kitchen' })
    expect(screen.queryByText('Loading restaurants…')).not.toBeInTheDocument()
  })

  it('shows an alert when the restaurants cannot be loaded', async () => {
    fetchMock.mockImplementation(async (input: string) =>
      String(input).includes('cuisines') ? jsonResponse([]) : jsonResponse({}, 500),
    )
    renderApp('/')

    expect(await screen.findByRole('alert')).toHaveTextContent(/restaurants/i)
  })

  it('says nothing matches and clears the filters on request', async () => {
    const user = userEvent.setup()
    renderApp('/?search=zzz&cuisine=Noodles')

    expect(await screen.findByRole('heading', { name: 'No restaurants match' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(await screen.findByRole('heading', { name: '3 restaurants' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('')
  })

  it('offers no Clear filters when nothing is filtered and there are no restaurants', async () => {
    fetchMock.mockImplementation(async (input: string) =>
      jsonResponse(String(input).includes('cuisines') ? [] : aPage([])),
    )
    renderApp('/')

    expect(await screen.findByRole('heading', { name: 'No restaurants match' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })
})

describe('stale answers', () => {
  it('keeps the newer search when an older answer arrives last', async () => {
    const user = userEvent.setup()
    let answerFirst: (value: unknown) => void = () => {}
    const first = new Promise((resolve) => (answerFirst = resolve))
    fetchMock.mockImplementation(async (input: string) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/cuisines/')) return jsonResponse([])
      if (url.searchParams.get('search') === 'corner') {
        await first
        return jsonResponse(aPage([corner]))
      }
      return jsonResponse(aPage([wok]))
    })
    renderApp('/?search=corner')

    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'wok')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(await inMain().findByRole('link', { name: 'Golden Wok' })).toBeInTheDocument()

    answerFirst(undefined)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(inMain().getByRole('link', { name: 'Golden Wok' })).toBeInTheDocument()
    expect(inMain().queryByRole('link', { name: 'Corner Kitchen' })).not.toBeInTheDocument()
  })
})
