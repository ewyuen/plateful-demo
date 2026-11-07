import { useEffect, useId, useState } from 'react'
import { listDashboardOrders } from '../api'
import { ApiError } from '../api/client'
import { useAuth } from '../authContext'
import DashboardGrid from '../components/DashboardGrid'
import { useFetch } from '../useFetch'
import styles from './DashboardPage.module.css'

// How often the orders are fetched again while the page is open.
export const DASHBOARD_POLL_MS = 15000

// The admin dashboard (S34, ADR-0019): every restaurant's paid orders in one table. It only
// shows orders; moving them stays on the fulfilment page. Rows are updated in place by order
// id, so the sort, filters, search and scroll stay where the admin left them.
function DashboardPage() {
  const { sessionEnded } = useAuth()
  const searchId = useId()
  const [search, setSearch] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), DASHBOARD_POLL_MS)
    return () => window.clearInterval(timer)
  }, [])

  const { data, loading, error } = useFetch(
    (signal) =>
      listDashboardOrders(signal).catch((cause: unknown) => {
        // The server no longer accepts this session: the page goes back to "sign in".
        if (cause instanceof ApiError && cause.status === 403) sessionEnded()
        throw cause
      }),
    [tick],
    'the orders',
  )

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <h1>Dashboard</h1>
        <p className={styles.hint}>All restaurants · updates every 15 seconds · view only</p>
      </div>

      {data === undefined ? (
        loading ? (
          <p role="status">Loading orders…</p>
        ) : (
          <p role="alert">{error}</p>
        )
      ) : (
        <>
          {error !== null && <p role="alert">{error}</p>}
          {data.truncated && (
            <p role="status" className={styles.cut}>
              Showing the newest {data.results.length.toLocaleString('en-US')} of {data.count.toLocaleString('en-US')} orders.
            </p>
          )}
          {data.results.length === 0 ? (
            <p>There are no orders yet.</p>
          ) : (
            <>
              <div className={styles.search}>
                <label htmlFor={searchId}>Search orders</label>
                <input
                  id={searchId}
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <DashboardGrid orders={data.results} search={search} />
            </>
          )}
        </>
      )}
    </div>
  )
}

export default DashboardPage
