import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDraft, loadDraft, MAX_AGE_MS, saveDraft, STORAGE_KEY } from './draftStorage'
import { initialOrderDraft, type OrderDraft } from './orderDraft'

const NOW = 1_800_000_000_000

const draft: OrderDraft = {
  ...initialOrderDraft,
  restaurantId: 3,
  restaurantName: 'Noodle Bar',
  restaurantDeliveryFee: '3.00',
  cart: { 4: { name: 'Ramen', quantity: 2, price: '12.50' }, 5: { name: 'Tea', quantity: 1 } },
  customerName: 'Ann',
  notice: 'something',
}

function stored(overrides: Record<string, unknown> = {}, draftOverrides: Record<string, unknown> = {}) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      savedAt: NOW - 1000,
      draft: {
        restaurantId: 3,
        restaurantName: 'Noodle Bar',
        restaurantDeliveryFee: null,
        cart: { 4: { name: 'Ramen', quantity: 2 } },
        customerName: 'Ann',
        ...draftOverrides,
      },
      ...overrides,
    }),
  )
}

const raw = () => window.localStorage.getItem(STORAGE_KEY)

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('saveDraft and loadDraft', () => {
  it('give back what was saved', () => {
    saveDraft(draft, NOW)

    const loaded = loadDraft(NOW + 1000)

    expect(loaded).toMatchObject({
      restaurantId: 3,
      restaurantName: 'Noodle Bar',
      restaurantDeliveryFee: '3.00',
      cart: draft.cart,
      customerName: 'Ann',
    })
  })

  it('never keep the notice', () => {
    saveDraft(draft, NOW)

    expect(raw()).not.toMatch(/notice|something/)
    expect(loadDraft(NOW)).toMatchObject({ notice: null })
  })

  it('keep a draft that has only a name', () => {
    saveDraft({ ...initialOrderDraft, customerName: 'Ann' }, NOW)

    expect(loadDraft(NOW)?.customerName).toBe('Ann')
  })

  it('remove the kept copy when there is no cart and no name', () => {
    saveDraft(draft, NOW)

    saveDraft({ ...draft, cart: {}, customerName: '  ' }, NOW)

    expect(raw()).toBeNull()
  })

  it('return nothing when nothing was saved', () => {
    expect(loadDraft(NOW)).toBeNull()
  })
})

describe('loadDraft with a copy that is old or damaged', () => {
  it('restores a copy saved an hour ago', () => {
    stored({ savedAt: NOW - 60 * 60 * 1000 })

    expect(loadDraft(NOW)?.customerName).toBe('Ann')
  })

  it('ignores and removes a copy saved 24 hours ago or more', () => {
    stored({ savedAt: NOW - MAX_AGE_MS })

    expect(loadDraft(NOW)).toBeNull()
    expect(raw()).toBeNull()
  })

  it('ignores a copy saved in the future', () => {
    stored({ savedAt: NOW + 10 * 60 * 1000 })

    expect(loadDraft(NOW)).toBeNull()
    expect(raw()).toBeNull()
  })

  it.each([
    ['text that is not JSON', () => window.localStorage.setItem(STORAGE_KEY, '{not json')],
    ['JSON that is not an object', () => window.localStorage.setItem(STORAGE_KEY, '[1,2]')],
    ['an unknown version', () => stored({ version: 2 })],
    ['a missing saved time', () => stored({ savedAt: 'yesterday' })],
    ['a missing draft', () => stored({ draft: null })],
    ['a quantity of 0', () => stored({}, { cart: { 4: { name: 'Ramen', quantity: 0 } } })],
    ['a negative quantity', () => stored({}, { cart: { 4: { name: 'Ramen', quantity: -1 } } })],
    ['a fractional quantity', () => stored({}, { cart: { 4: { name: 'Ramen', quantity: 1.5 } } })],
    ['a huge quantity', () => stored({}, { cart: { 4: { name: 'Ramen', quantity: 100000 } } })],
    ['a name that is not text', () => stored({}, { cart: { 4: { name: 7, quantity: 1 } } })],
    ['an empty dish name', () => stored({}, { cart: { 4: { name: '', quantity: 1 } } })],
    ['a price that is not a decimal', () => stored({}, { cart: { 4: { name: 'Ramen', quantity: 1, price: 'free' } } })],
    ['a dish id that is not a number', () => stored({}, { cart: { abc: { name: 'Ramen', quantity: 1 } } })],
    ['a cart that is not an object', () => stored({}, { cart: [] })],
    ['a restaurant id that is not whole', () => stored({}, { restaurantId: 1.5 })],
    ['a restaurant id of 0', () => stored({}, { restaurantId: 0 })],
    ['dishes with no restaurant', () => stored({}, { restaurantId: null })],
    ['a delivery fee that is not a decimal', () => stored({}, { restaurantDeliveryFee: 'lots' })],
    ['a customer name that is not text', () => stored({}, { customerName: 5 })],
  ])('ignores and removes %s', (_name, setUp) => {
    setUp()

    expect(loadDraft(NOW)).toBeNull()
    expect(raw()).toBeNull()
  })
})

describe('when storage does not work', () => {
  function brokenStorage() {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
  }

  it('does not throw on read, write or remove', () => {
    brokenStorage()

    expect(loadDraft(NOW)).toBeNull()
    expect(() => saveDraft(draft, NOW)).not.toThrow()
    expect(() => saveDraft({ ...initialOrderDraft }, NOW)).not.toThrow()
    expect(() => clearDraft()).not.toThrow()
  })

  it('copes with window.localStorage itself throwing', () => {
    const getter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    expect(loadDraft(NOW)).toBeNull()
    expect(() => saveDraft(draft, NOW)).not.toThrow()
    getter.mockRestore()
  })
})

describe('clearDraft', () => {
  it('removes the kept copy', () => {
    saveDraft(draft, NOW)

    clearDraft()

    expect(raw()).toBeNull()
  })
})
