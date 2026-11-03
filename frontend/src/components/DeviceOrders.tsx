import { useState } from 'react'
import { lookupOrder } from '../api'
import { ApiError } from '../api/client'
import type { GuestOrder } from '../api/types'
import { useFetch } from '../useFetch'
import GuestOrderCard from './GuestOrderCard'
import styles from './DeviceOrders.module.css'

export const GONE = 'This order was not found any more.'

// One remembered code, fetched when it appears and again when the list is refreshed.
function DeviceOrder({ code, refresh, onForget }: { code: string; refresh: number; onForget: (code: string) => void }) {
  const { data, loading, error } = useFetch<GuestOrder | 'gone'>(
    (signal) =>
      lookupOrder(code, signal).catch((cause: unknown) => {
        // The server answers 404 for a code it does not know: that is an answer, not a failure.
        if (cause instanceof ApiError && cause.status === 404) return 'gone' as const
        throw cause
      }),
    [code, refresh],
    'the order',
  )
  const forget = (
    <button type="button" onClick={() => onForget(code)}>
      Forget
    </button>
  )

  if (data === undefined || data === 'gone') {
    return (
      <li className={styles.placeholder}>
        <span>{data === 'gone' ? GONE : loading ? 'Loading order…' : error}</span>
        {!loading && forget}
      </li>
    )
  }
  return <GuestOrderCard order={data}>{forget}</GuestOrderCard>
}

// The orders whose codes this browser remembers. A code the server no longer finds is said
// to be gone and can be forgotten.
function DeviceOrders({ codes, onForget }: { codes: string[]; onForget: (code: string) => void }) {
  const [refresh, setRefresh] = useState(0)

  return (
    <section aria-labelledby="device-orders-heading">
      <div className={styles.top}>
        <h2 id="device-orders-heading">Orders on this device</h2>
        {codes.length > 0 && (
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>
            Refresh
          </button>
        )}
      </div>
      {codes.length === 0 ? (
        <p>
          There are no orders on this device. After you pay, your order code is remembered here;
          to see an order paid for elsewhere, find it with its code above.
        </p>
      ) : (
        <ul className={styles.list}>
          {codes.map((code) => (
            <DeviceOrder key={code} code={code} refresh={refresh} onForget={onForget} />
          ))}
        </ul>
      )}
    </section>
  )
}

export default DeviceOrders
