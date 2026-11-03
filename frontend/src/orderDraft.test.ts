import { describe, expect, it } from 'vitest'
import { initialOrderDraft, orderDraftReducer, type OrderDraft } from './orderDraft'

const ramen = { id: 4, name: 'Ramen' }

const filled: OrderDraft = {
  restaurantId: 3,
  restaurantName: 'Noodle Bar',
  restaurantDeliveryFee: null,
  cart: { 4: { name: 'Ramen', quantity: 2 } },
  customerName: 'Ann',
  notice: null,
}

describe('orderDraftReducer', () => {
  it('starts with no restaurant, an empty cart and no name', () => {
    expect(initialOrderDraft).toEqual({
      restaurantId: null,
      restaurantName: null,
      restaurantDeliveryFee: null,
      cart: {},
      customerName: '',
      notice: null,
    })
  })

  describe('restaurantChosen', () => {
    it('sets the restaurant', () => {
      const next = orderDraftReducer(initialOrderDraft, { type: 'restaurantChosen', id: 3 })

      expect(next.restaurantId).toBe(3)
    })

    it('empties the cart and keeps the name', () => {
      const next = orderDraftReducer(filled, { type: 'restaurantChosen', id: 1 })

      expect(next.cart).toEqual({})
      expect(next.customerName).toBe('Ann')
      expect(next.restaurantId).toBe(1)
    })
  })

  describe('restaurantChosen with a name', () => {
    it('stores the name, and a missing name clears it', () => {
      const named = orderDraftReducer(initialOrderDraft, {
        type: 'restaurantChosen',
        id: 3,
        name: 'Noodle Bar',
      })
      const unnamed = orderDraftReducer(named, { type: 'restaurantChosen', id: 4 })

      expect(named.restaurantName).toBe('Noodle Bar')
      expect(unnamed.restaurantName).toBeNull()
    })
  })

  describe('delivery fee', () => {
    it('stores the restaurant delivery fee, and null when it does not deliver', () => {
      const delivering = orderDraftReducer(initialOrderDraft, {
        type: 'restaurantChosen',
        id: 1,
        name: 'Corner Kitchen',
        deliveryFee: '3.00',
      })
      const pickupOnly = orderDraftReducer(delivering, { type: 'restaurantChosen', id: 3, name: 'Noodle Bar' })

      expect(delivering.restaurantDeliveryFee).toBe('3.00')
      expect(pickupOnly.restaurantDeliveryFee).toBeNull()
    })
  })

  describe('prices', () => {
    it('keeps the price of a dish added with one', () => {
      const next = orderDraftReducer(initialOrderDraft, {
        type: 'quantitySet',
        item: { id: 4, name: 'Ramen', price: '12.50' },
        quantity: 2,
      })

      expect(next.cart[4]).toEqual({ name: 'Ramen', quantity: 2, price: '12.50' })
    })

    it('adds suggestions with the prices the page looked up', () => {
      const next = orderDraftReducer(initialOrderDraft, {
        type: 'suggestionsAdded',
        suggestions: [{ menu_item: 4, name: 'Ramen', quantity: 1, price: '12.50' }],
      })

      expect(next.cart[4]).toEqual({ name: 'Ramen', quantity: 1, price: '12.50' })
    })
  })

  describe('quantitySet', () => {
    it('adds the item to the cart', () => {
      const next = orderDraftReducer(initialOrderDraft, {
        type: 'quantitySet',
        item: ramen,
        quantity: 2,
      })

      expect(next.cart).toEqual({ 4: { name: 'Ramen', quantity: 2 } })
    })

    it('takes the item out when the quantity is 0', () => {
      const next = orderDraftReducer(filled, { type: 'quantitySet', item: ramen, quantity: 0 })

      expect(next.cart).toEqual({})
    })
  })

  it('nameChanged sets the name and nothing else', () => {
    const next = orderDraftReducer(filled, { type: 'nameChanged', name: 'Bo' })

    expect(next).toEqual({ ...filled, customerName: 'Bo' })
  })

  describe('orderPaid', () => {
    it('empties the cart and the name and keeps the restaurant', () => {
      const next = orderDraftReducer(filled, { type: 'orderPaid' })

      expect(next.cart).toEqual({})
      expect(next.customerName).toBe('')
      expect(next.restaurantId).toBe(3)
    })

  })

  describe('a kept cart checked against the menu', () => {
    const kept: OrderDraft = {
      ...filled,
      cart: {
        4: { name: 'Ramen', quantity: 2, price: '12.50' },
        5: { name: 'Dumplings', quantity: 1, price: '6.00' },
      },
      restaurantDeliveryFee: '3.00',
    }
    const same = {
      4: { name: 'Ramen', price: '12.50' },
      5: { name: 'Dumplings', price: '6.00' },
    }
    const reconcile = (dishes: Record<number, { name: string; price: string }>, deliveryFee: string | null = '3.00') =>
      orderDraftReducer(kept, { type: 'cartReconciled', restaurantName: 'Noodle Bar', deliveryFee, dishes })

    it('shows no notice when nothing changed', () => {
      expect(reconcile(same)).toEqual({ ...kept, notice: null })
    })

    it('takes up a changed price and says so', () => {
      const next = reconcile({ ...same, 4: { name: 'Ramen', price: '13.00' } })

      expect(next.cart[4]).toEqual({ name: 'Ramen', quantity: 2, price: '13.00' })
      expect(next.notice).toMatch(/updated/i)
    })

    it('takes up a changed name and says so', () => {
      const next = reconcile({ ...same, 5: { name: 'Pot stickers', price: '6.00' } })

      expect(next.cart[5].name).toBe('Pot stickers')
      expect(next.notice).toMatch(/updated/i)
    })

    it('removes a dish that is gone and names it', () => {
      const next = reconcile({ 4: same[4] })

      expect(Object.keys(next.cart)).toEqual(['4'])
      expect(next.notice).toBe('Your saved cart was updated: Dumplings is no longer available.')
    })

    it('names every dish that is gone', () => {
      expect(reconcile({}).notice).toBe(
        'Your saved cart was updated: Ramen, Dumplings are no longer available.',
      )
    })

    it('takes up a changed delivery fee and says so', () => {
      const next = reconcile(same, '4.00')

      expect(next.restaurantDeliveryFee).toBe('4.00')
      expect(next.notice).toMatch(/updated/i)
    })

    it('does not call a price learned for the first time a change', () => {
      const unpriced: OrderDraft = { ...kept, cart: { 4: { name: 'Ramen', quantity: 2 } } }

      const next = orderDraftReducer(unpriced, {
        type: 'cartReconciled',
        restaurantName: 'Noodle Bar',
        deliveryFee: '3.00',
        dishes: same,
      })

      expect(next.cart[4].price).toBe('12.50')
      expect(next.notice).toBeNull()
    })

    it('keeps the quantities and the name', () => {
      const next = reconcile({ ...same, 4: { name: 'Ramen', price: '13.00' } })

      expect(next.cart[4].quantity).toBe(2)
      expect(next.customerName).toBe('Ann')
    })

    it('empties the cart and the restaurant when the restaurant is gone', () => {
      const next = orderDraftReducer(kept, { type: 'cartDiscarded' })

      expect(next.cart).toEqual({})
      expect(next.restaurantId).toBeNull()
      expect(next.customerName).toBe('')
      expect(next.notice).toMatch(/no longer available/i)
    })

    it('forgets the notice when it is dismissed', () => {
      const withNotice = reconcile({ 4: same[4] })

      expect(orderDraftReducer(withNotice, { type: 'noticeDismissed' }).notice).toBeNull()
    })
  })

  it('never changes the state it was given', () => {
    const before = structuredClone(filled)

    orderDraftReducer(filled, { type: 'restaurantChosen', id: 1 })
    orderDraftReducer(filled, { type: 'quantitySet', item: ramen, quantity: 0 })
    orderDraftReducer(filled, { type: 'nameChanged', name: 'Bo' })
    orderDraftReducer(filled, { type: 'orderPaid' })
    orderDraftReducer(filled, {
      type: 'suggestionsAdded',
      suggestions: [{ menu_item: 4, name: 'Ramen', quantity: 1 }],
    })

    expect(filled).toEqual(before)
  })
})
