import { useRef, useState } from 'react'
import { PayPalButtons, PayPalScriptProvider, usePayPalScriptReducer } from '@paypal/react-paypal-js'
import { completeCheckout } from '../api'
import { ApiError } from '../api/client'
import type { CompletedOrder } from '../api/types'
import styles from './PayForOrder.module.css'

interface PayForOrderProps {
  // Called when a PayPal button is pressed, before PayPal opens. Answers false when the
  // form is not valid (it has already said what is missing), and PayPal does not open.
  beforePay: () => boolean
  // Starts the checkout on the server and answers the PayPal order id. It shows its own
  // problems (a rejected cart) and rejects, so PayPal does not open.
  startPayment: () => Promise<string>
  // Called once the server confirms the payment and has created the order.
  onPaid: (order: CompletedOrder) => void
}

export const UNAVAILABLE = 'Payment is unavailable right now, so orders cannot be placed.'
export const CANCELLED = 'Payment cancelled. You can try again.'
export const DECLINED = 'Your payment was declined. You can try again.'
export const FAILED = 'We could not process the payment. You can try again.'

// The amount is never sent: the server charges the total it worked out when the checkout
// started (ADR-0011). No order exists until the server confirms the payment.
function PayButtons({ beforePay, startPayment, onPaid }: PayForOrderProps) {
  const [{ isPending, isRejected }] = usePayPalScriptReducer()
  const [message, setMessage] = useState<string | null>(null)
  // The form already showed why the checkout could not start; PayPal then reports an
  // error too, and that one is not shown.
  const startFailed = useRef(false)

  if (isRejected) return <p role="status">{UNAVAILABLE}</p>
  if (isPending) return <p role="status">Loading PayPal…</p>

  return (
    <div className={styles.pay}>
      <PayPalButtons
        style={{ layout: 'vertical' }}
        onClick={(_data, actions) => (beforePay() ? actions.resolve() : actions.reject())}
        createOrder={async () => {
          setMessage(null)
          startFailed.current = false
          try {
            return await startPayment()
          } catch (error) {
            startFailed.current = true
            throw error
          }
        }}
        onApprove={async (data) => {
          let order: CompletedOrder
          try {
            order = await completeCheckout(data.orderID)
          } catch (error) {
            setMessage(error instanceof ApiError && error.status === 402 ? DECLINED : FAILED)
            return
          }
          setMessage(null)
          onPaid(order)
        }}
        onCancel={() => setMessage(CANCELLED)}
        onError={() => {
          if (startFailed.current) {
            startFailed.current = false
            return
          }
          setMessage(FAILED)
        }}
      />
      {message !== null && (
        <p role="alert" className={styles.error}>
          {message}
        </p>
      )}
    </div>
  )
}

function PayForOrder(props: PayForOrderProps) {
  // Read on every render (not at import) so tests can change it with vi.stubEnv.
  const clientId = import.meta.env.VITE_PAYPAL_CLIENT_ID
  if (!clientId) return <p role="status">{UNAVAILABLE}</p>

  return (
    <PayPalScriptProvider options={{ clientId, currency: 'USD', intent: 'capture' }}>
      <PayButtons {...props} />
    </PayPalScriptProvider>
  )
}

export default PayForOrder
