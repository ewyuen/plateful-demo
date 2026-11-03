import { useId } from 'react'
import { useSearchParams } from 'react-router'
import { listRestaurants } from '../api'
import { useAuth } from '../authContext'
import type { FulfilmentFilters, OrderStatus } from '../api/types'
import OrderQueue from '../components/OrderQueue'
import { STATUS_LABELS } from '../orderStatus'
import { useFetch } from '../useFetch'
import styles from './FulfilmentPage.module.css'

type QueueStatus = Exclude<OrderStatus, 'pending'>

// "Active" is the server's default (confirmed, preparing, ready), so it is the absence of a
// status in the address and in the request.
const CHIPS: { value: 'active' | QueueStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'confirmed', label: STATUS_LABELS.confirmed },
  { value: 'preparing', label: STATUS_LABELS.preparing },
  { value: 'ready', label: STATUS_LABELS.ready },
  { value: 'completed', label: STATUS_LABELS.completed },
  { value: 'cancelled', label: STATUS_LABELS.cancelled },
]

function isQueueStatus(value: string | null): value is QueueStatus {
  return CHIPS.some((chip) => chip.value === value && chip.value !== 'active')
}

// The order queue for signed-in restaurant staff (ADR-0014): a fulfilment user sees the
// restaurants they work for, an admin all of them. The filters live in the address so a
// reload shows the same view.
function FulfilmentPage() {
  const { state: auth } = useAuth()
  const user = auth.user
  const everything = user?.role === 'admin'
  const [params, setParams] = useSearchParams()
  const selectId = useId()
  const rawStatus = params.get('status')
  const status = isQueueStatus(rawStatus) ? rawStatus : undefined
  const rawRestaurant = params.get('restaurant')
  const restaurant = /^\d+$/.test(rawRestaurant ?? '') ? Number(rawRestaurant) : undefined

  // The selector is a convenience: without the restaurants it still offers "All restaurants".
  // An admin chooses among all restaurants; a fulfilment user among their own.
  const restaurants = useFetch(
    everything ? (signal) => listRestaurants({}, signal) : null,
    [everything],
    'the restaurants',
  )
  const choices = everything
    ? (restaurants.data?.results ?? [])
    : (user?.restaurants ?? [])

  function update(changes: { status?: string; restaurant?: string }) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '') next.delete(key)
      else next.set(key, value)
    }
    setParams(next)
  }

  const filters: FulfilmentFilters = { status, restaurant }
  const view = `${status ?? 'active'}-${restaurant ?? 'all'}`

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <h1>Order queue</h1>
        <div className={styles.restaurant}>
          <label htmlFor={selectId}>Restaurant</label>
          <select
            id={selectId}
            value={restaurant === undefined ? '' : String(restaurant)}
            onChange={(event) => update({ restaurant: event.target.value })}
          >
            <option value="">All restaurants</option>
            {choices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className={styles.open}>
        Signed in as {user?.username}.{' '}
        {everything
          ? 'Showing the orders of every restaurant.'
          : user !== null && user.restaurants.length > 0
            ? `Showing the orders of ${user.restaurants.map((item) => item.name).join(', ')}.`
            : 'You do not work for any restaurant yet, so there are no orders to show.'}{' '}
        It updates every few seconds.
      </p>

      <div className={styles.chips} role="group" aria-label="Filter by status">
        {CHIPS.map((chip) => {
          const chosen = (status ?? 'active') === chip.value
          return (
            <button
              key={chip.value}
              type="button"
              className={chosen ? `${styles.chip} ${styles.chipOn}` : styles.chip}
              aria-pressed={chosen}
              onClick={() => update({ status: chip.value === 'active' ? '' : chip.value })}
            >
              {chosen && <span aria-hidden="true">✓ </span>}
              {chip.label}
            </button>
          )
        })}
      </div>

      <OrderQueue key={view} filters={filters} />
    </div>
  )
}

export default FulfilmentPage
