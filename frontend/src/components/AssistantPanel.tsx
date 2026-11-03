import { useEffect, useRef, useState, type ReactNode } from 'react'
import styles from './AssistantPanel.module.css'

// The assistant as a panel over the right side of the page, opened from a button. The
// chat inside stays mounted while the panel is closed (it is only hidden), so closing it
// keeps the conversation. Escape and the close button close it and give focus back to the
// button that opened it.
function AssistantPanel({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const closer = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (open) closer.current?.focus()
    else if (wasOpen.current) opener.current?.focus()
    wasOpen.current = open
  }, [open])

  // Escape closes the panel wherever focus is: while a question is being sent the Send
  // button is disabled and focus falls back to the page, outside the panel.
  useEffect(() => {
    if (!open) return
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [open])

  return (
    <>
      <button
        ref={opener}
        type="button"
        className={styles.opener}
        aria-expanded={open}
        aria-controls="assistant-panel"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">✦ </span>Ask the assistant
      </button>
      <aside
        id="assistant-panel"
        className={styles.panel}
        role="dialog"
        aria-label="Assistant"
        hidden={!open}
      >
        <button ref={closer} type="button" className={styles.close} onClick={() => setOpen(false)}>
          Close
        </button>
        {children}
      </aside>
    </>
  )
}

export default AssistantPanel
