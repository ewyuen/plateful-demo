import { useEffect, useId, useRef, useState } from 'react'
import { startCheckout } from '../api'
import type { CompletedOrder, NewOrder, NewOrderItem } from '../api/types'
import { addCode } from '../deviceOrders'
import { lineTotal, totalWithFee } from '../cart'
import { describeOrderError, NO_ERRORS, type OrderFormErrors } from '../orderErrors'
import { useOrderDraft } from '../orderDraftContext'
import PayForOrder from './PayForOrder'
import styles from './OrderForm.module.css'

interface OrderFormProps {
  // Called once a payment is confirmed and the server has created the order, with the order
  // and its code. The checkout page uses it to keep showing the confirmation, and to move on.
  onPaid?: (order: CompletedOrder) => void
}

// The checkout form. There is no "place order" step: the PayPal buttons are the submit, and
// the order exists only once PayPal confirms the payment (ADR-0011).
// The parent renders this with key={restaurantId}: choosing another restaurant
// discards a pending start's state, and the unmount cleanup aborts its request.
function OrderForm({ onPaid }: OrderFormProps = {}) {
  const { state, dispatch } = useOrderDraft()
  const { restaurantId, cart, customerName } = state
  // Set when the cart's restaurant offers delivery; null means pickup is the only way.
  const deliveryFee = state.restaurantDeliveryFee
  const [fulfilment, setFulfilment] = useState<'pickup' | 'delivery'>('pickup')
  const [address, setAddress] = useState('')
  const delivering = deliveryFee !== null && fulfilment === 'delivery'
  const total = totalWithFee(cart, delivering ? deliveryFee : null)
  const [errors, setErrors] = useState<OrderFormErrors>(NO_ERRORS)
  // The order the server created once the payment was confirmed.
  const [paidOrder, setPaidOrder] = useState<CompletedOrder | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const startingRef = useRef(false)
  const nameErrorId = useId()
  const summaryId = useId()
  const addressErrorId = useId()

  useEffect(() => {
    return () => controllerRef.current?.abort()
  }, [])

  const items: NewOrderItem[] = Object.entries(cart).map(([id, entry]) => ({
    menu_item: Number(id),
    quantity: entry.quantity,
  }))

  // The PayPal buttons keep the callbacks they were first given, so they read the form
  // through this ref: it always holds what is on screen now.
  const latest = useRef({ restaurantId, name: customerName, items, delivering, address })
  useEffect(() => {
    latest.current = { restaurantId, name: customerName, items, delivering, address }
  })

  if (restaurantId === null) {
    return <p>Choose a restaurant to start an order.</p>
  }

  // Shows what is missing and answers whether the checkout may start.
  function validate(): boolean {
    const form = latest.current
    const problems: OrderFormErrors = {
      nameErrors: form.name.trim() === '' ? ['Enter your name.'] : [],
      messages: form.items.length === 0 ? ['Add at least one item to the order.'] : [],
      ...(form.delivering && form.address.trim() === ''
        ? { addressErrors: ['Enter a delivery address.'] }
        : {}),
    }
    if (
      problems.nameErrors.length > 0 ||
      problems.messages.length > 0 ||
      (problems.addressErrors?.length ?? 0) > 0
    ) {
      setErrors(problems)
      return false
    }
    setErrors(NO_ERRORS)
    return true
  }

  // Starts the checkout for what is on screen and answers the PayPal order id. A problem is
  // shown on the form and rejects, so PayPal does not open.
  async function startPayment(): Promise<string> {
    const form = latest.current
    if (startingRef.current) throw new Error('A checkout is already starting.')
    if (!validate() || form.restaurantId === null) throw new Error('The form is not valid.')

    const order: NewOrder = {
      restaurant: form.restaurantId,
      customer_name: form.name.trim(),
      items: form.items,
      ...(form.delivering
        ? { fulfilment_type: 'delivery' as const, delivery_address: form.address.trim() }
        : {}),
    }
    const controller = new AbortController()
    controllerRef.current = controller
    startingRef.current = true
    try {
      const started = await startCheckout(order, controller.signal)
      return started.paypal_order_id
    } catch (error) {
      if (!controller.signal.aborted) setErrors(describeOrderError(error))
      throw error
    } finally {
      startingRef.current = false
    }
  }

  function handlePaid(order: CompletedOrder) {
    // The code is the buyer's only way back to this order, so this device remembers it.
    addCode(order.public_code)
    setPaidOrder(order)
    setErrors(NO_ERRORS)
    dispatch({ type: 'orderPaid' })
    onPaid?.(order)
  }

  const hasNameError = errors.nameErrors.length > 0
  const hasAddressError = (errors.addressErrors?.length ?? 0) > 0

  return (
    <>
      <form className={styles.form} onSubmit={(event) => event.preventDefault()} noValidate>
        <h2>Your order</h2>

        <fieldset className={styles.group}>
          <legend>Your details</legend>
          <label className={styles.field}>
            Your name
            <input
              type="text"
              value={customerName}
              aria-invalid={hasNameError}
              aria-describedby={hasNameError ? nameErrorId : undefined}
              onChange={(event) => dispatch({ type: 'nameChanged', name: event.target.value })}
            />
          </label>
          {hasNameError && (
            <p id={nameErrorId} className={styles.fieldError}>
              {errors.nameErrors.join(' ')}
            </p>
          )}
        </fieldset>

        {deliveryFee !== null && (
          <fieldset className={styles.group}>
            <legend>Pickup or delivery</legend>
            <label className={styles.choice}>
              <input
                type="radio"
                name="fulfilment"
                value="pickup"
                checked={fulfilment === 'pickup'}
                onChange={() => setFulfilment('pickup')}
              />
              Pickup
            </label>
            <label className={styles.choice}>
              <input
                type="radio"
                name="fulfilment"
                value="delivery"
                checked={fulfilment === 'delivery'}
                onChange={() => setFulfilment('delivery')}
              />
              Delivery (${deliveryFee})
            </label>
            {fulfilment === 'delivery' && (
              <>
                <label className={styles.field}>
                  Delivery address
                  <input
                    type="text"
                    value={address}
                    required
                    aria-invalid={hasAddressError}
                    aria-describedby={hasAddressError ? addressErrorId : undefined}
                    onChange={(event) => setAddress(event.target.value)}
                  />
                </label>
                {hasAddressError && (
                  <p id={addressErrorId} className={styles.fieldError}>
                    {errors.addressErrors?.join(' ')}
                  </p>
                )}
              </>
            )}
          </fieldset>
        )}

        <section className={styles.group} aria-labelledby={summaryId}>
          <h3 id={summaryId} className={styles.legend}>
            Order summary
          </h3>
          {items.length === 0 ? (
            <p>Your cart is empty.</p>
          ) : (
            <ul className={styles.cart} aria-label="Cart">
              {Object.entries(cart).map(([id, entry]) => (
                <li key={id} className={styles.cartLine}>
                  <span>
                    {entry.name} × {entry.quantity}
                  </span>
                  {lineTotal(entry) !== null && <span>${lineTotal(entry)}</span>}
                </li>
              ))}
            </ul>
          )}
          {delivering && (
            <p className={styles.cartLine}>
              <span>Delivery fee</span>
              <span>${deliveryFee}</span>
            </p>
          )}
          {total !== null && (
            <p className={styles.total}>
              <span>Total</span>
              <span>${total}</span>
            </p>
          )}
        </section>

        {errors.messages.length > 0 && (
          <ul role="alert" className={styles.errors}>
            {errors.messages.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        )}
        {paidOrder !== null && (
          <p role="status" className={styles.confirmation}>
            Payment received. Your order code is {paidOrder.public_code}.
          </p>
        )}
      </form>
      {items.length > 0 && <PayForOrder beforePay={validate} startPayment={startPayment} onPaid={handlePaid} />}
    </>
  )
}

export default OrderForm
