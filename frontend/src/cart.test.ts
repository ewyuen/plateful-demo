import { describe, expect, it } from 'vitest'
import {
  cartCount,
  cartTotal,
  lineTotal,
  parseQuantity,
  totalWithFee,
  withQuantity,
  type Cart,
} from './cart'

describe('parseQuantity', () => {
  it('keeps a whole number', () => {
    expect(parseQuantity('3')).toBe(3)
  })

  it.each(['', '   ', 'abc', '-1', '-0.5'])('turns %j into 0', (input) => {
    expect(parseQuantity(input)).toBe(0)
  })

  it('drops the decimal part', () => {
    expect(parseQuantity('1.5')).toBe(1)
  })
})

describe('withQuantity', () => {
  const cart: Cart = { 4: { name: 'Ramen', quantity: 2 } }

  it('adds an item', () => {
    expect(withQuantity(cart, 5, 'Dumplings', 1)).toEqual({
      4: { name: 'Ramen', quantity: 2 },
      5: { name: 'Dumplings', quantity: 1 },
    })
  })

  it('changes the quantity of an item already in the cart', () => {
    expect(withQuantity(cart, 4, 'Ramen', 3)).toEqual({ 4: { name: 'Ramen', quantity: 3 } })
  })

  it('takes the item out when the quantity is 0', () => {
    expect(withQuantity(cart, 4, 'Ramen', 0)).toEqual({})
  })

  it('does not change the cart it was given', () => {
    withQuantity(cart, 5, 'Dumplings', 1)
    withQuantity(cart, 4, 'Ramen', 0)

    expect(cart).toEqual({ 4: { name: 'Ramen', quantity: 2 } })
  })
})

describe('prices and totals', () => {
  it('keeps a price learned earlier when a change does not know it', () => {
    const priced = withQuantity({}, 4, 'Ramen', 1, '12.50')

    expect(withQuantity(priced, 4, 'Ramen', 3)[4]).toEqual({ name: 'Ramen', quantity: 3, price: '12.50' })
  })

  it('counts every quantity', () => {
    const cart: Cart = { 1: { name: 'A', quantity: 2 }, 2: { name: 'B', quantity: 3 } }

    expect(cartCount(cart)).toBe(5)
    expect(cartCount({})).toBe(0)
  })

  it('adds prices times quantities in whole cents', () => {
    const cart: Cart = {
      1: { name: 'Spring Rolls', quantity: 1, price: '6.50' },
      2: { name: 'Miso Soup', quantity: 2, price: '4.00' },
    }

    expect(cartTotal(cart)).toBe('14.50')
  })

  it('does not drift on cents', () => {
    const cart: Cart = { 1: { name: 'Tea', quantity: 3, price: '0.10' } }

    expect(cartTotal(cart)).toBe('0.30')
  })

  it('has no total when a price is missing or the cart is empty', () => {
    expect(cartTotal({ 1: { name: 'A', quantity: 1, price: '1.00' }, 2: { name: 'B', quantity: 1 } })).toBeNull()
    expect(cartTotal({})).toBeNull()
  })
})

describe('lineTotal', () => {
  it('multiplies the price by the quantity', () => {
    expect(lineTotal({ name: 'Miso Soup', quantity: 2, price: '4.00' })).toBe('8.00')
  })

  it('is null without a price', () => {
    expect(lineTotal({ name: 'Miso Soup', quantity: 2 })).toBeNull()
  })
})

describe('totalWithFee', () => {
  const cart: Cart = { 1: { name: 'Spring Rolls', quantity: 1, price: '17.50' } }

  it('adds the fee in whole cents', () => {
    expect(totalWithFee(cart, '3.00')).toBe('20.50')
    expect(totalWithFee({ 1: { name: 'Tea', quantity: 3, price: '0.10' } }, '0.20')).toBe('0.50')
  })

  it('is the plain total without a fee', () => {
    expect(totalWithFee(cart, null)).toBe('17.50')
  })

  it('is null when the total is not known', () => {
    expect(totalWithFee({ 1: { name: 'A', quantity: 1 } }, '3.00')).toBeNull()
    expect(totalWithFee({}, '3.00')).toBeNull()
  })
})
