// Money on the dashboard is added up in whole cents, never as floating-point dollars, so
// 0.10 + 0.20 + 0.30 is exactly 0.60 (S34). The server sends amounts as strings like "12.50".

// "12.50" -> 1250. Anything that is not an amount with at most two decimals counts as 0.
export function toCents(amount: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim())
  if (match === null) return 0
  const cents = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'))
  return match[1] === '-' ? -cents : cents
}

// 1250 -> "$12.50", with thousands separated: 123456 -> "$1,234.56".
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const whole = Math.floor(Math.abs(cents) / 100)
  const rest = String(Math.abs(cents) % 100).padStart(2, '0')
  return `${sign}$${whole.toLocaleString('en-US')}.${rest}`
}
