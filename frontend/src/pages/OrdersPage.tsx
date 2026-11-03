import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import DeviceOrders from '../components/DeviceOrders'
import FindOrder from '../components/FindOrder'
import PaidNotice from '../components/PaidNotice'
import { addCode, loadCodes, removeCode } from '../deviceOrders'
import { normalizeCode } from '../orderCode'
import styles from './Page.module.css'

// A guest's orders (ADR-0014): the order code shown right after paying, a form to find an
// order by its code, and the orders remembered on this device. Nobody's orders are listed
// by number or by name.
//
// Arriving right after paying carries the code in the router state. It is read once and then
// cleared from the history entry, so a reload does not show the confirmation again.
function OrdersPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [paidCode] = useState<string | null>(() => {
    const value = (location.state as { paidCode?: unknown } | null)?.paidCode
    return typeof value === 'string' && normalizeCode(value) !== null ? value : null
  })
  const [codes, setCodes] = useState<string[]>(loadCodes)

  useEffect(() => {
    if (location.state !== null) navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  return (
    <div className={styles.page}>
      <h1>Orders</h1>
      {paidCode !== null && <PaidNotice code={paidCode} />}
      <FindOrder
        remembered={(code) => codes.includes(normalizeCode(code) ?? code)}
        onRemember={(code) => setCodes(addCode(code))}
      />
      <DeviceOrders codes={codes} onForget={(code) => setCodes(removeCode(code))} />
    </div>
  )
}

export default OrdersPage
