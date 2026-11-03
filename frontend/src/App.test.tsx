import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from './testUtils'
import { aCook, aMenu, aPage, aRestaurant, anAdmin, stubApi } from './testApi'

stubApi((url) => {
  if (url.pathname.endsWith('/menu/')) return aMenu({ restaurant: aRestaurant({ id: 3, name: 'Noodle Bar' }) })
  if (url.pathname.endsWith('/cuisines/')) return []
  return aPage([])
})

describe('App routes', () => {
  it.each([
    ['/', /across the network/i],
    ['/restaurants/3', 'Noodle Bar'],
    ['/checkout', 'Checkout'],
    ['/orders', 'Orders'],
  ])('shows the page for %s', async (path, heading) => {
    renderApp(path)

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
  })

  it('shows the order queue to signed-in staff', async () => {
    renderApp('/fulfilment', {}, anAdmin())

    expect(await screen.findByRole('heading', { level: 1, name: 'Order queue' })).toBeInTheDocument()
  })

  it('says when an address is not a page, with a way home', () => {
    renderApp('/nowhere')

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all restaurants' })).toHaveAttribute('href', '/')
  })
})

describe('the header and footer', () => {
  it('has the name linking home, the page links and the cart link', () => {
    renderApp('/orders')

    const header = screen.getByRole('banner')
    expect(within(header).getByRole('link', { name: 'Plateful' })).toHaveAttribute('href', '/')
    const nav = within(header).getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Restaurants' })).toHaveAttribute('href', '/')
    expect(within(nav).getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/orders')
    expect(within(nav).getByRole('link', { name: /Cart/ })).toHaveAttribute('href', '/checkout')
    expect(within(nav).getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login')
    // The staff page is not offered to someone who is not signed in.
    expect(within(nav).queryByRole('link', { name: 'Fulfilment' })).not.toBeInTheDocument()
  })

  it('offers the Fulfilment link to signed-in staff', () => {
    renderApp('/orders', {}, aCook())

    const nav = within(screen.getByRole('banner')).getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Fulfilment' })).toHaveAttribute('href', '/fulfilment')
  })

  it('marks only the link of the current page', () => {
    renderApp('/orders')

    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Restaurants' })).not.toHaveAttribute('aria-current')
  })

  it('marks Restaurants on the discover page, not on other pages', () => {
    renderApp('/')

    expect(screen.getByRole('link', { name: 'Restaurants' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows the cart count', () => {
    renderApp('/', { restaurantId: 1, cart: { 1: { name: 'A', quantity: 2 }, 2: { name: 'B', quantity: 1 } } })

    expect(screen.getByRole('link', { name: /Cart/ })).toHaveTextContent('3')
  })

  it('shows 0 for an empty cart', () => {
    renderApp('/')

    expect(screen.getByRole('link', { name: /Cart/ })).toHaveTextContent('0')
  })

  it('ends every page with the Unsplash note', () => {
    renderApp('/orders')

    expect(screen.getByRole('contentinfo')).toHaveTextContent('Photos from Unsplash')
  })

  it('moves between pages without losing the header', async () => {
    renderApp('/')

    await userEvent.click(screen.getByRole('link', { name: 'Orders' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })
})
