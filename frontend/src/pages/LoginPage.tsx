import { useId, useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../authContext'
import { isCustomer, isOwner } from '../roles'
import styles from './LoginPage.module.css'

export const WRONG_CREDENTIALS = 'The username or password is wrong.'
export const NO_ROLE = 'This account cannot use the staff pages.'
export const TOO_MANY = 'Too many attempts. Wait a minute and try again.'
export const LOGIN_FAILED = 'Could not sign in. Please try again.'

// Only a path inside this site is followed after signing in, never an address someone
// else put in the link.
function safeNext(value: string | null): string | null {
  return value !== null && /^\/(?!\/)/.test(value) ? value : null
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return WRONG_CREDENTIALS
    if (error.status === 403) return NO_ROLE
    if (error.status === 429) return TOO_MANY
  }
  return LOGIN_FAILED
}

function LoginPage() {
  const { state, signIn } = useAuth()
  const [params] = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()
  const next = safeNext(params.get('next'))

  // An owner goes to the dashboard, staff (fulfilment and admin) to the queue and a customer to their
  // orders, unless they came from another page.
  if (state.user !== null && state.user.role !== null) {
    return <Navigate to={next ?? (isCustomer(state.user) ? '/my-orders' : isOwner(state.user) ? '/dashboard' : '/fulfilment')} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await signIn(username.trim(), password)
    } catch (cause) {
      setError(messageFor(cause))
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.page}>
      <h1>Sign in</h1>
      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.field}>
          Username
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            aria-describedby={error === null ? undefined : errorId}
          />
        </label>
        <label className={styles.field}>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby={error === null ? undefined : errorId}
          />
        </label>
        {error !== null && (
          <p id={errorId} role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <button type="submit" className={styles.submit} disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p>
        New here? <Link to="/register">Register</Link> to keep your orders in one place.
      </p>
    </div>
  )
}

export default LoginPage
