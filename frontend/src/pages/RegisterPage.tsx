import { useId, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../authContext'
import styles from './LoginPage.module.css'

export const TOO_MANY = 'Too many attempts. Wait a while and try again.'
export const REGISTER_FAILED = 'Could not register. Please try again.'

// The server's words for a refusal (a taken username, a weak password) are shown as they are;
// they say what to change and nothing about anyone else.
function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return TOO_MANY
    const detail = (error.body as { detail?: unknown } | undefined)?.detail
    if (error.status === 400 && typeof detail === 'string' && detail !== '') return detail
  }
  return REGISTER_FAILED
}

// Makes a customer account (ADR-0014): a username and a password, nothing else, so there is
// no email to confirm. Orders are added to the account afterwards with their codes.
function RegisterPage() {
  const { state, register } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()

  if (state.user !== null && state.user.role !== null) {
    return <Navigate to={state.user.role === 'customer' ? '/my-orders' : '/fulfilment'} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await register(username.trim(), password)
    } catch (cause) {
      setError(messageFor(cause))
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.page}>
      <h1>Register</h1>
      <p>Make an account to keep your orders together. You need no email address.</p>
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
            autoComplete="new-password"
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
          {submitting ? 'Registering…' : 'Register'}
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Sign in</Link>.
      </p>
    </div>
  )
}

export default RegisterPage
