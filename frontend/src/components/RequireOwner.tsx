import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../authContext'
import { isOwner } from '../roles'

// Keeps a page for a signed-in owner (ADR-0020). An admin, other staff, customers and accounts with
// no role are signed in too, but see a message instead of the page. The server is the real guard
// (it answers 403 to the dashboard list); this only decides what to show, and nothing is asked of
// the server for a user who may not see the page.
function RequireOwner({ children, next }: { children: ReactNode; next: string }) {
  const { state } = useAuth()

  if (state.status === 'loading') return <p role="status">Checking your login…</p>
  if (state.user === null) {
    return (
      <div>
        <h1>Owner only</h1>
        <p>This page is for the owner.</p>
        <p>
          <Link to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link> to see the dashboard.
        </p>
      </div>
    )
  }
  if (!isOwner(state.user)) {
    return (
      <div>
        <h1>Owner only</h1>
        <p>Your account cannot use this page.</p>
      </div>
    )
  }
  return <>{children}</>
}

export default RequireOwner
