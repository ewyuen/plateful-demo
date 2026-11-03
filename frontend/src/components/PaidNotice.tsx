import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../authContext'
import { formatCode } from '../orderCode'
import { isCustomer } from '../roles'
import styles from './PaidNotice.module.css'

// Shown right after paying: the order code, which is the only way to find the order later.
// Copy and the mail link keep it; nothing is sent from our server (no email provider).
function PaidNotice({ code }: { code: string }) {
  const { state } = useAuth()
  const [copied, setCopied] = useState(false)
  const shown = formatCode(code.replace(/-/g, ''))
  const mail =
    'mailto:?subject=' +
    encodeURIComponent('My Plateful order code') +
    '&body=' +
    encodeURIComponent(`My order code is ${shown}. Keep it to find the order later.`)

  async function copy() {
    try {
      await navigator.clipboard.writeText(shown)
      setCopied(true)
    } catch {
      // The code stays on screen to select; no error is shown.
    }
  }

  return (
    <div className={styles.notice} role="status">
      <p className={styles.lead}>Payment received.</p>
      <p>
        Your order code is <strong className={styles.code}>{shown}</strong>
      </p>
      {isCustomer(state.user) && (
        <p>
          This order is already in <Link to="/my-orders">My orders</Link>.
        </p>
      )}
      <p>Keep this code to find your order later. Anyone who has it can see what you ordered.</p>
      <div className={styles.actions}>
        <button type="button" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy code'}
        </button>
        <a href={mail}>Email it to myself</a>
      </div>
    </div>
  )
}

export default PaidNotice
