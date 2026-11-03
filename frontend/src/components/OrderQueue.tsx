import { useEffect, useState } from 'react'
import { listFulfilmentOrders, transitionOrder } from '../api'
import { useAuth } from '../authContext'
import { ApiError } from '../api/client'
import type { FulfilmentFilters, Order, OrderStatus } from '../api/types'
import { canCancel, fulfilmentLine, nextStep, STATUS_LABELS } from '../orderStatus'
import { useFetch } from '../useFetch'
import styles from './OrderQueue.module.css'

// How often the queue is fetched again while the page is open.
export const POLL_INTERVAL_MS = 5000

export const MOVED_ON = 'This order was already moved on. It now shows its current state.'
export const MOVE_FAILED = 'Could not move the order. It was left as it was.'

interface OrderCardProps {
  order: Order
  busy: boolean
  onMove: (order: Order, to: OrderStatus) => void
}

function OrderCard({ order, busy, onMove }: OrderCardProps) {
  const next = nextStep(order)
  const time = new Date(order.created_at)
  return (
    <li className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.number}>Order #{order.id}</h3>
        <span className={`${styles.tag} ${styles[order.status] ?? ''}`}>
          {order.status === 'ready' || order.status === 'out_for_delivery' || order.status === 'completed' ? (
            <span aria-hidden="true">✓ </span>
          ) : null}
          {STATUS_LABELS[order.status]}
        </span>
      </div>
      <p className={styles.meta}>
        {order.restaurant_name} · {order.customer_name}
        {!Number.isNaN(time.getTime()) && (
          <>
            {' · '}
            <time dateTime={order.created_at}>
              {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </time>
          </>
        )}
      </p>
      <p className={styles.fulfilment}>{fulfilmentLine(order)}</p>
      <ul className={styles.items} aria-label={`Items of order ${order.id}`}>
        {order.items.map((item) => (
          <li key={item.menu_item}>
            {item.menu_item_name} × {item.quantity}
          </li>
        ))}
      </ul>
      <p className={styles.total}>${order.total}</p>
      {(next !== undefined || canCancel(order.status)) && (
        <div className={styles.actions}>
          {next !== undefined && (
            <button type="button" disabled={busy} onClick={() => onMove(order, next.to)}>
              {next.label}
            </button>
          )}
          {canCancel(order.status) && (
            <button
              type="button"
              className={styles.cancel}
              disabled={busy}
              onClick={() => onMove(order, 'cancelled')}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </li>
  )
}

// The queue for one view (a status and maybe one restaurant). The page gives it a key of
// that view, so choosing another view starts fresh instead of showing the old cards while
// the new ones load. It fetches again every POLL_INTERVAL_MS and stops when it goes away.
function OrderQueue({ filters }: { filters: FulfilmentFilters }) {
  const { sessionEnded } = useAuth()
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set())
  const [notice, setNotice] = useState<{ text: string; kind: 'info' | 'error' } | null>(null)
  // An order the server returned for a button press, with the fetch it was made against.
  // It is shown until a newer fetch replaces that result, so a cancelled order does not
  // vanish from the Active view the moment it is pressed.
  const [moved, setMoved] = useState<Record<number, { order: Order; data: unknown }>>({})

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [])

  const { data, loading, error } = useFetch(
    (signal) =>
      listFulfilmentOrders(filters, signal).catch((cause: unknown) => {
        // The server no longer accepts this session: the page goes back to "sign in".
        if (cause instanceof ApiError && cause.status === 403) sessionEnded()
        throw cause
      }),
    [filters.status ?? '', filters.restaurant ?? '', tick],
    'the orders',
  )

  async function handleMove(order: Order, to: OrderStatus) {
    setBusy((ids) => new Set(ids).add(order.id))
    setNotice(null)
    try {
      const updated = await transitionOrder(order.id, to)
      setMoved((previous) => ({ ...previous, [order.id]: { order: updated, data } }))
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        sessionEnded()
      } else if (cause instanceof ApiError && cause.status === 409) {
        // Someone else moved it: fetch now to show where it really is.
        setNotice({ text: MOVED_ON, kind: 'info' })
        setTick((value) => value + 1)
      } else {
        setNotice({ text: MOVE_FAILED, kind: 'error' })
      }
    } finally {
      setBusy((ids) => {
        const rest = new Set(ids)
        rest.delete(order.id)
        return rest
      })
    }
  }

  if (data === undefined) {
    return loading ? <p>Loading orders…</p> : <p role="alert">{error}</p>
  }

  const orders = data.results.map((order) =>
    moved[order.id]?.data === data ? moved[order.id].order : order,
  )

  return (
    <>
      {error !== null && <p role="alert">{error}</p>}
      {notice !== null &&
        (notice.kind === 'error' ? (
          <p role="alert" className={styles.noticeError}>
            {notice.text}
          </p>
        ) : (
          <p role="status" className={styles.notice}>
            {notice.text}
          </p>
        ))}
      {orders.length === 0 ? (
        <p>There are no orders in this view.</p>
      ) : (
        <ul className={styles.grid}>
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} busy={busy.has(order.id)} onMove={handleMove} />
          ))}
        </ul>
      )}
    </>
  )
}

export default OrderQueue
