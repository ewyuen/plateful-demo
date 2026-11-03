import { completeCheckout } from './api'
import type { CompletedOrder } from './api/types'

interface Props {
  beforePay: () => boolean
  startPayment: () => Promise<string>
  onPaid: (order: CompletedOrder) => void
}

// Stands in for the PayPal buttons in page tests, so nothing loads PayPal's script.
// Pressing it does what the real buttons do: check the form, start the checkout and, when
// the server answers a PayPal order id, "approve" it and complete the checkout.
// Use it with: vi.mock('../components/PayForOrder', async () => import('../testPayStub'))
export default function PayStub({ beforePay, startPayment, onPaid }: Props) {
  async function press() {
    if (!beforePay()) return
    try {
      const paypalOrderId = await startPayment()
      onPaid(await completeCheckout(paypalOrderId))
    } catch {
      // The form shows what went wrong, as it does with the real buttons.
    }
  }
  return (
    <button type="button" onClick={press}>
      Pay with PayPal
    </button>
  )
}
