import { describe, expect, it } from 'vitest'
import { formatCents, toCents } from './dashboardMoney'

describe('toCents', () => {
  it('reads an amount with two decimals', () => {
    expect(toCents('12.50')).toBe(1250)
    expect(toCents('0.07')).toBe(7)
  })

  it('reads a short or whole amount', () => {
    expect(toCents('9.5')).toBe(950)
    expect(toCents('4')).toBe(400)
  })

  it('counts anything else as zero', () => {
    expect(toCents('')).toBe(0)
    expect(toCents('abc')).toBe(0)
    expect(toCents('1.234')).toBe(0)
  })

  it('adds exactly: 0.10 + 0.20 + 0.30 is 0.60', () => {
    const sum = ['0.10', '0.20', '0.30'].map(toCents).reduce((a, b) => a + b, 0)
    expect(sum).toBe(60)
    expect(formatCents(sum)).toBe('$0.60')
  })
})

describe('formatCents', () => {
  it('shows dollars and two decimals', () => {
    expect(formatCents(1250)).toBe('$12.50')
    expect(formatCents(5)).toBe('$0.05')
    expect(formatCents(0)).toBe('$0.00')
  })

  it('separates thousands', () => {
    expect(formatCents(123456)).toBe('$1,234.56')
  })
})
