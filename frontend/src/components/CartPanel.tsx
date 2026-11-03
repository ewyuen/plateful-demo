import { useId, useState } from 'react'
import { Link } from 'react-router'
import { cartCount, cartTotal, lineTotal } from '../cart'
import { useOrderDraft } from '../orderDraftContext'
import styles from './CartPanel.module.css'

// The order so far. One element, two layouts by CSS: a sidebar on wide screens, and on a
// phone a bar fixed to the bottom whose button opens the full panel.
function CartPanel() {
  const { state } = useOrderDraft()
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const entries = Object.entries(state.cart)
  const count = cartCount(state.cart)
  const total = cartTotal(state.cart)

  return (
    <aside className={styles.panel} aria-label="Your order">
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((was) => !was)}
      >
        <span>
          Your order · {count} {count === 1 ? 'item' : 'items'}
          {total !== null && ` · $${total}`}
        </span>
        <span aria-hidden="true">{open ? '▾' : '▴'}</span>
      </button>

      <div id={bodyId} className={open ? styles.body : `${styles.body} ${styles.collapsed}`}>
        <h2 className={styles.heading}>Your order</h2>
        {entries.length === 0 ? (
          <p>Your order is empty</p>
        ) : (
          <>
            {state.restaurantId !== null && (
              <p className={styles.from}>
                From{' '}
                <Link to={`/restaurants/${state.restaurantId}`}>
                  {state.restaurantName ?? 'your restaurant'}
                </Link>
              </p>
            )}
            <ul className={styles.lines} aria-label="Cart">
              {entries.map(([id, entry]) => (
                <li key={id} className={styles.line}>
                  <span>
                    {entry.name} × {entry.quantity}
                  </span>
                  <span className={styles.leader} aria-hidden="true" />
                  {lineTotal(entry) !== null && <span>${lineTotal(entry)}</span>}
                </li>
              ))}
            </ul>
            {total !== null && (
              <p className={styles.total}>
                <span>Total</span>
                <span>${total}</span>
              </p>
            )}
            <Link to="/checkout" className={styles.checkout}>
              Go to checkout
            </Link>
          </>
        )}
      </div>
    </aside>
  )
}

export default CartPanel
