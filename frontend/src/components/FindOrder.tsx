import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { attachOrder, lookupOrder } from '../api'
import { ApiError } from '../api/client'
import type { GuestOrder } from '../api/types'
import { useAuth } from '../authContext'
import { isCustomer } from '../roles'
import GuestOrderCard from './GuestOrderCard'
import styles from './FindOrder.module.css'

export const NOT_FOUND = 'No order was found for that code. Check it and try again.'
export const TOO_MANY = 'Too many tries. Wait a minute and try again.'
export const LOOKUP_FAILED = 'Could not look the order up. Please try again.'
export const ENTER_CODE = 'Enter your order code.'
export const ADDED = 'Added to your account.'

interface FindOrderProps {
  // Whether this code is already remembered on this device.
  remembered: (code: string) => boolean
  onRemember: (code: string) => void
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return NOT_FOUND
    if (error.status === 429) return TOO_MANY
  }
  return LOOKUP_FAILED
}

// Adds the found order to the signed-in customer's account. An order that is already on an
// account looks like any wrong code to the server, so the message is the same.
function AddToAccount({ code }: { code: string }) {
  const { sessionEnded } = useAuth()
  const [state, setState] = useState<'idle' | 'pending' | 'added'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function add() {
    setState('pending')
    setError(null)
    try {
      await attachOrder(code)
      setState('added')
    } catch (cause) {
      setState('idle')
      if (cause instanceof ApiError && cause.status === 403) sessionEnded()
      else setError(messageFor(cause))
    }
  }

  if (state === 'added') return <p>{ADDED}</p>
  return (
    <>
      <button type="button" onClick={() => void add()} disabled={state === 'pending'}>
        Add to my account
      </button>
      {error !== null && <p role="alert">{error}</p>}
    </>
  )
}

// The form a guest uses when the code was not kept on this device.
function FindOrder({ remembered, onRemember }: FindOrderProps) {
  const { state: auth } = useAuth()
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [found, setFound] = useState<GuestOrder | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()
  const errorId = useId()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    if (text.trim() === '') {
      setError(ENTER_CODE)
      return
    }
    setPending(true)
    setError(null)
    setFound(null)
    try {
      setFound(await lookupOrder(text.trim()))
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <section aria-labelledby={`${inputId}-heading`} className={styles.section}>
      <h2 id={`${inputId}-heading`}>Find your order</h2>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <label htmlFor={inputId}>Order code</label>
        <input
          id={inputId}
          type="text"
          value={text}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXX-XXXX-XXXX"
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : errorId}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" disabled={pending}>
          {pending ? 'Looking…' : 'Find'}
        </button>
      </form>
      {error !== null && (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {found !== null && (
        <ul className={styles.result}>
          <GuestOrderCard order={found}>
            {remembered(found.public_code) ? (
              <p>Remembered on this device.</p>
            ) : (
              <button type="button" onClick={() => onRemember(found.public_code)}>
                Remember on this device
              </button>
            )}
            {isCustomer(auth.user) ? (
              <AddToAccount key={found.public_code} code={found.public_code} />
            ) : (
              auth.status === 'ready' &&
              auth.user === null && (
                <p>
                  <Link to="/login?next=%2Forders">Sign in</Link> or <Link to="/register">register</Link> to
                  keep this order on your account.
                </p>
              )
            )}
          </GuestOrderCard>
        </ul>
      )}
    </section>
  )
}

export default FindOrder
