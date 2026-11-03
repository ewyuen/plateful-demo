import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addCode, loadCodes, MAX_CODES, removeCode, STORAGE_KEY } from './deviceOrders'

const A = 'ABCDEFGHJKMN'
const B = 'PQRSTUVWXYZ2'

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('the codes remembered on this device', () => {
  it('start empty', () => {
    expect(loadCodes()).toEqual([])
  })

  it('remembers a code, newest first', () => {
    addCode(A, 1)
    addCode(B, 2)

    expect(loadCodes()).toEqual([B, A])
  })

  it('accepts a code in its shown form', () => {
    addCode('abcd-efgh-jkmn')

    expect(loadCodes()).toEqual([A])
  })

  it('moves a code that is added again to the front, once', () => {
    addCode(A, 1)
    addCode(B, 2)

    const list = addCode(A, 3)

    expect(list).toEqual([A, B])
    expect(loadCodes()).toEqual([A, B])
  })

  it('keeps only the newest 20', () => {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
    for (let i = 0; i < 25; i++) addCode(alphabet.slice(0, 11) + alphabet[i], i)

    const kept = loadCodes()

    expect(kept).toHaveLength(MAX_CODES)
    expect(kept[0].endsWith(alphabet[24])).toBe(true)
    expect(kept.some((code) => code.endsWith(alphabet[0]))).toBe(false)
  })

  it('ignores something that is not a code', () => {
    addCode(A)

    expect(addCode('not a code')).toEqual([A])
  })

  it('forgets a code', () => {
    addCode(A)
    addCode(B)

    expect(removeCode(A)).toEqual([B])
    expect(loadCodes()).toEqual([B])
  })

  it('keeps only the codes, nothing about the orders', () => {
    addCode(A, 5)

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({ version: 1, codes: [{ code: A, savedAt: 5 }] }),
    )
  })
})

describe('damaged or unusable storage', () => {
  it.each([
    ['text that is not JSON', '{nope'],
    ['an unknown version', JSON.stringify({ version: 2, codes: [] })],
    ['codes that are not a list', JSON.stringify({ version: 1, codes: 'x' })],
    ['a code that is not valid', JSON.stringify({ version: 1, codes: [{ code: 'abc', savedAt: 1 }] })],
    ['a saved time that is not a number', JSON.stringify({ version: 1, codes: [{ code: A, savedAt: 'now' }] })],
    ['an entry that is null', JSON.stringify({ version: 1, codes: [null] })],
  ])('remembers nothing from %s', (_name, value) => {
    window.localStorage.setItem(STORAGE_KEY, value)

    expect(loadCodes()).toEqual([])
  })

  it('does not throw when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    expect(loadCodes()).toEqual([])
    expect(() => addCode(A)).not.toThrow()
    expect(() => removeCode(A)).not.toThrow()
  })
})
