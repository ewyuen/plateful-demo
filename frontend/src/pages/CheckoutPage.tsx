import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import OrderForm from '../components/OrderForm'
import { cartCount } from '../cart'
import { useOrderDraft } from '../orderDraftContext'
import styles from './Page.module.css'

// The checkout on its own page. It shows the restaurant the cart belongs to. Once a payment
// is confirmed the cart is empty, but the page stays for a moment (no "your order is empty")
// until it moves on to the orders page.
function CheckoutPage() {
  const { state } = useOrderDraft()
  const navigate = useNavigate()
  const [paid, setPaid] = useState(false)
  const empty = cartCount(state.cart) === 0

  if (empty && !paid) {
    return (
      <div className={`${styles.page} ${styles.narrow}`}>
        <h1>Checkout</h1>
        <p>Your order is empty</p>
        <p>
          <Link to="/">See all restaurants</Link> and add a dish to start.
        </p>
      </div>
    )
  }

  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <h1>Checkout</h1>
      {state.restaurantName !== null && (
        <p>
          Ordering from{' '}
          {state.restaurantId !== null ? (
            <Link to={`/restaurants/${state.restaurantId}`}>{state.restaurantName}</Link>
          ) : (
            state.restaurantName
          )}
        </p>
      )}
      <OrderForm
        key={`order-${state.restaurantId}`}
        onPaid={(order) => {
          setPaid(true)
          navigate('/orders', { state: { paidCode: order.public_code } })
        }}
      />
    </div>
  )
}

export default CheckoutPage
