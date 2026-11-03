import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { askAssistant } from '../api'
import type { AssistantMessage, AssistantSuggestion } from '../api/types'
import { describeAssistantError } from '../assistantErrors'
import styles from './AssistantChat.module.css'

// The same limits the server enforces, so the user hears about them before sending.
export const MAX_MESSAGE_LENGTH = 1000
export const MAX_MESSAGES = 20

// One line of the conversation. Suggestions only exist on the assistant's replies;
// `added` remembers that the customer already put them in the cart.
interface Turn extends AssistantMessage {
  suggestions?: AssistantSuggestion[]
  added?: boolean
}

interface AssistantChatProps {
  restaurantId: number
  // Called when the customer presses "Add to cart". The page decides how the dishes reach
  // the cart (including asking before replacing a cart of another restaurant).
  onAddToCart: (suggestions: AssistantSuggestion[]) => void
}

// The parent renders this with key={restaurantId}: opening another restaurant starts a
// fresh chat, and the unmount cleanup aborts a question that is still waiting.
function AssistantChat({ restaurantId, onAddToCart }: AssistantChatProps) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const inputId = useId()
  const tooLongId = useId()

  useEffect(() => {
    return () => controllerRef.current?.abort()
  }, [])

  const question = input.trim()
  const tooLong = input.length > MAX_MESSAGE_LENGTH

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending || question === '' || tooLong) return

    // Only role and content go to the server, and only the latest messages.
    const conversation: AssistantMessage[] = [
      ...turns.map(({ role, content }) => ({ role, content })),
      { role: 'user' as const, content: question },
    ].slice(-MAX_MESSAGES)

    const controller = new AbortController()
    controllerRef.current = controller
    setSending(true)
    setError(null)
    setTurns((previous) => [...previous, { role: 'user', content: question }])
    setInput('')
    try {
      const answer = await askAssistant(restaurantId, conversation, controller.signal)
      if (controller.signal.aborted) return
      setTurns((previous) => [
        ...previous,
        { role: 'assistant', content: answer.reply, suggestions: answer.suggestions },
      ])
    } catch (caught) {
      if (controller.signal.aborted) return
      // The question did not get an answer: take it back out of the chat and put it back
      // in the box, so the conversation stays as it was and sending again is one click.
      setTurns((previous) => previous.slice(0, -1))
      setInput(question)
      setError(describeAssistantError(caught))
    } finally {
      if (!controller.signal.aborted) setSending(false)
    }
  }

  function addToCart(index: number, suggestions: AssistantSuggestion[]) {
    onAddToCart(suggestions)
    setTurns((previous) =>
      previous.map((turn, position) => (position === index ? { ...turn, added: true } : turn)),
    )
  }

  return (
    <section className={styles.panel} aria-labelledby={`${inputId}-heading`}>
      <h2 id={`${inputId}-heading`}>Ask the assistant</h2>

      <div className={styles.conversation} role="log" aria-label="Conversation" aria-live="polite">
        {turns.length === 0 && (
          <p className={styles.hint}>Ask for a recommendation, for example “something light”.</p>
        )}
        {turns.map((turn, index) => (
          <div key={index} className={turn.role === 'user' ? styles.user : styles.assistant}>
            <p className={styles.text}>
              <span className={styles.who}>{turn.role === 'user' ? 'You' : 'Assistant'}: </span>
              {turn.content}
            </p>
            {turn.suggestions !== undefined && turn.suggestions.length > 0 && (
              <div className={styles.suggestions}>
                <ul aria-label="Suggested dishes">
                  {turn.suggestions.map((suggestion) => (
                    <li key={suggestion.menu_item}>
                      {suggestion.name} × {suggestion.quantity}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={turn.added === true}
                  onClick={() => addToCart(index, turn.suggestions ?? [])}
                >
                  {turn.added === true ? 'Added to cart' : 'Add to cart'}
                </button>
              </div>
            )}
          </div>
        ))}
        {sending && <p className={styles.hint}>The assistant is thinking…</p>}
      </div>

      {error !== null && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <label htmlFor={inputId}>Your question</label>
        <textarea
          id={inputId}
          rows={2}
          value={input}
          readOnly={sending}
          aria-invalid={tooLong}
          aria-describedby={tooLong ? tooLongId : undefined}
          onChange={(event) => setInput(event.target.value)}
        />
        {tooLong && (
          <p id={tooLongId} className={styles.error}>
            Questions can be at most {MAX_MESSAGE_LENGTH} characters ({input.length} now).
          </p>
        )}
        <button type="submit" disabled={sending || question === '' || tooLong}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  )
}

export default AssistantChat
