import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import styles from './ReplaceCartDialog.module.css'

interface ReplaceCartDialogProps {
  fromName: string
  toName: string
  onConfirm: () => void
  onKeep: () => void
}

// Asks whether to start a new order when a dish of another restaurant is added. It is a
// modal dialog: focus starts on the safe choice ("Keep my cart"), Tab stays inside, Escape
// keeps the cart, and focus goes back to what was focused before it opened.
function ReplaceCartDialog({ fromName, toName, onConfirm, onKeep }: ReplaceCartDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const keepRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const before = document.activeElement
    keepRef.current?.focus()
    return () => {
      if (before instanceof HTMLElement) before.focus()
    }
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onKeep()
      return
    }
    if (event.key !== 'Tab') return
    // Two buttons: wrap around at either end so focus never leaves the dialog.
    const first = confirmRef.current
    const last = keepRef.current
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div className={styles.backdrop}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId}>Start a new order?</h2>
        <p id={descriptionId}>
          Your cart has dishes from <strong>{fromName}</strong>. An order can hold one restaurant,
          so adding a dish from <strong>{toName}</strong> will empty your cart first.
        </p>
        <div className={styles.actions}>
          <button ref={confirmRef} type="button" onClick={onConfirm}>
            Empty cart and add
          </button>
          <button ref={keepRef} type="button" className={styles.secondary} onClick={onKeep}>
            Keep my cart
          </button>
        </div>
      </div>
    </div>
  )
}

export default ReplaceCartDialog
