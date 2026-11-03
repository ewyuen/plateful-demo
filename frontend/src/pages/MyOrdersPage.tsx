import { useState } from 'react'
import { Link } from 'react-router'
import { listMyOrders } from '../api'
import AttachOrderForm from '../components/AttachOrderForm'
import GuestOrderCard from '../components/GuestOrderCard'
import { useAuth } from '../authContext'
import { isCustomer, isStaff } from '../roles'
import { useFetch } from '../useFetch'
import styles from './Page.module.css'
import mine from './MyOrdersPage.module.css'

// A customer's orders (ADR-0014): the ones they added to their account with a code, on any
// device, behind the login. Like a lookup, an order shows what was ordered and not who ordered.
function MyOrdersPage() {
  const { state } = useAuth()
  const customer = isCustomer(state.user)
  const [refresh, setRefresh] = useState(0)
  const { data, loading, error } = useFetch(
    customer ? (signal) => listMyOrders(signal) : null,
    [refresh],
    'your orders',
  )

  if (state.status === 'loading') return <p role="status">Checking your login…</p>
  if (state.user === null) {
    return (
      <div className={styles.page}>
        <h1>My orders</h1>
        <p>
          <Link to="/login?next=%2Fmy-orders">Sign in</Link> or <Link to="/register">register</Link> to
          see your orders on any device.
        </p>
      </div>
    )
  }
  if (!customer) {
    return (
      <div className={styles.page}>
        <h1>My orders</h1>
        <p>
          {isStaff(state.user) ? 'This page is for customers. Staff see orders on the Fulfilment page.' : 'Your account cannot use this page.'}
        </p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <h1>My orders</h1>
      <section aria-labelledby="attach-heading">
        <h2 id="attach-heading">Add an order</h2>
        <p>Enter the code you were given when you paid. An order can be added to one account only.</p>
        <AttachOrderForm onAttached={() => setRefresh((value) => value + 1)} />
      </section>
      <section aria-labelledby="mine-heading">
        <h2 id="mine-heading">Your orders</h2>
        {data === undefined && loading && <p role="status">Loading your orders…</p>}
        {error !== null && <p role="alert">{error}</p>}
        {data !== undefined && data.length === 0 && <p>You have not added an order yet.</p>}
        {data !== undefined && data.length > 0 && (
          <ul className={mine.list}>
            {data.map((order) => (
              <GuestOrderCard key={order.public_code} order={order} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default MyOrdersPage
