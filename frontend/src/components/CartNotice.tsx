import { useOrderDraft } from '../orderDraftContext'
import styles from './CartNotice.module.css'

// Tells the customer that the cart kept from their last visit was changed to match the
// menu, or removed. Shown on every page until dismissed.
function CartNotice() {
  const { state, dispatch } = useOrderDraft()
  if (state.notice === null) return null

  return (
    <div className={styles.notice} role="status">
      <p>{state.notice}</p>
      <button type="button" onClick={() => dispatch({ type: 'noticeDismissed' })}>
        Dismiss
      </button>
    </div>
  )
}

export default CartNotice
