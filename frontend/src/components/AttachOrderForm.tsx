import { useId, useState, type FormEvent } from 'react'
import { attachOrder } from '../api'
import { ApiError } from '../api/client'
import { useAuth } from '../authContext'
import { ENTER_CODE, LOOKUP_FAILED, NOT_FOUND, TOO_MANY } from './FindOrder'
import styles from './FindOrder.module.css'

// What an attach attempt says when it fails. The server answers 404 alike for a code that is
// wrong, unknown or already on an account, so one message covers all three.
function attachMessageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return NOT_FOUND
    if (error.status === 429) return TOO_MANY
  }
  return LOOKUP_FAILED
}

// A customer adds an order to their account by typing its code.
function AttachOrderForm({ onAttached }: { onAttached: () => void }) {
  const { sessionEnded } = useAuth()
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
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
    try {
      await attachOrder(text.trim())
      setText('')
      onAttached()
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) sessionEnded()
      else setError(attachMessageFor(cause))
    } finally {
      setPending(false)
    }
  }

  return (
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
        {pending ? 'Adding…' : 'Add to my account'}
      </button>
      {error !== null && (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </form>
  )
}

export default AttachOrderForm
