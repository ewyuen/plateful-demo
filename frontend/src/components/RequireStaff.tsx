import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../authContext'
import { isStaff } from '../roles'

// Keeps a page for signed-in staff (a customer is signed in too, but is not staff). The server is the real guard; this only decides what
// to show instead of a queue the server would refuse.
function RequireStaff({ children, next }: { children: ReactNode; next: string }) {
  const { state } = useAuth()

  if (state.status === 'loading') return <p role="status">Checking your login…</p>
  if (state.user === null) {
    return (
      <div>
        <h1>Staff only</h1>
        <p>This page is for restaurant staff.</p>
        <p>
          <Link to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link> to see your orders.
        </p>
      </div>
    )
  }
  if (!isStaff(state.user)) {
    return (
      <div>
        <h1>Staff only</h1>
        <p>Your account cannot use this page.</p>
      </div>
    )
  }
  return <>{children}</>
}

export default RequireStaff
