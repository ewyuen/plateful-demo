import type { ReactNode } from 'react'
import type { GuestOrder } from '../api/types'
import { formatCode } from '../orderCode'
import { guestFulfilmentLine, STATUS_LABELS } from '../orderStatus'
import styles from './GuestOrderCard.module.css'

// An order found by its code: what was ordered and how far it is, nothing about who ordered.
function GuestOrderCard({ order, children }: { order: GuestOrder; children?: ReactNode }) {
  const time = new Date(order.created_at)
  return (
    <li className={styles.card}>
      <h3 className={styles.heading}>
        {order.restaurant_name}
        <span className={styles.status}>{STATUS_LABELS[order.status]}</span>
      </h3>
      <p className={styles.meta}>
        Code {formatCode(order.public_code.replace(/-/g, ''))}
        {!Number.isNaN(time.getTime()) && (
          <>
            {' · '}
            <time dateTime={order.created_at}>{time.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time>
          </>
        )}
      </p>
      <p>{guestFulfilmentLine(order)}</p>
      <ul className={styles.items} aria-label={`Items of the order from ${order.restaurant_name}`}>
        {order.items.map((item) => (
          <li key={item.menu_item_name}>
            {item.menu_item_name} × {item.quantity}
          </li>
        ))}
      </ul>
      <p className={styles.total}>Total ${order.total}</p>
      {children !== undefined && <div className={styles.actions}>{children}</div>}
    </li>
  )
}

export default GuestOrderCard
