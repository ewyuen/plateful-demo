import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CartNotice from './CartNotice'
import { renderApp, renderWithProvider } from '../testUtils'
import { aPage, stubApi } from '../testApi'

stubApi((url) => (url.pathname === '/api/orders/' ? aPage([]) : []))

describe('CartNotice', () => {
  it('shows nothing when there is no notice', () => {
    renderWithProvider(<CartNotice />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows the notice and goes away when dismissed', async () => {
    const user = userEvent.setup()
    renderWithProvider(<CartNotice />, { notice: 'Your saved cart was updated to the current menu.' })

    expect(screen.getByRole('status')).toHaveTextContent('Your saved cart was updated to the current menu.')
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('is shown on every page and stays dismissed when the page changes', async () => {
    const user = userEvent.setup()
    renderApp('/checkout', { notice: 'Your saved cart was updated to the current menu.' })
    expect(screen.getByRole('status')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    await user.click(screen.getByRole('link', { name: 'Orders' }))

    expect(screen.queryByText(/saved cart/i)).not.toBeInTheDocument()
  })
})
