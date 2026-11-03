import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import App from './App'
import type { AuthUser } from './api/types'
import type { ReactElement, ReactNode } from 'react'
import AuthProvider from './components/AuthProvider'
import OrderDraftProvider from './components/OrderDraftProvider'
import { initialOrderDraft, type OrderDraft } from './orderDraft'

// Renders a component inside the draft provider, optionally starting from a
// given draft (for example a chosen restaurant and a full cart).
export function renderWithProvider(ui: ReactElement, draft: Partial<OrderDraft> = {}) {
  const initialState = { ...initialOrderDraft, ...draft }
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthProvider initialUser={null}>
        <OrderDraftProvider initialState={initialState}>{children}</OrderDraftProvider>
      </AuthProvider>
    )
  }
  return render(ui, { wrapper: Wrapper })
}

// Renders the whole app at an address, inside a memory router, optionally starting from a
// given draft and a signed-in user (nobody by default, and the server is not asked). The
// address may carry router state, as when one page sends the user to another with a message.
export function renderApp(
  path: string | { pathname: string; state?: unknown } = '/',
  draft: Partial<OrderDraft> = {},
  user: AuthUser | null = null,
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App initialDraft={{ ...initialOrderDraft, ...draft }} initialUser={user} />
    </MemoryRouter>,
  )
}
