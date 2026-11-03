import { describe, expect, it } from 'vitest'
import { formatCode, normalizeCode } from './orderCode'

describe('normalizeCode', () => {
  it.each(['abcd-efgh-jkmn', 'ABCDEFGHJKMN', ' abcd efgh jkmn ', 'ABCD--EFGH-JKMN', 'abcd\tefgh\njkmn'])(
    'tidies %j',
    (typed) => {
      expect(normalizeCode(typed)).toBe('ABCDEFGHJKMN')
    },
  )

  it.each(['', 'ABCD', 'ABCD-EFGH-JKMN-P', 'ABCD-EFGH-JKM1', 'ABCD-EFGH-JKMO', 'ABCD-EFGH-JKMI', 'ABCD-EFGH-JKM!'])(
    'refuses %j',
    (typed) => {
      expect(normalizeCode(typed)).toBeNull()
    },
  )
})

describe('formatCode', () => {
  it('groups the code in fours', () => {
    expect(formatCode('ABCDEFGHJKMN')).toBe('ABCD-EFGH-JKMN')
  })
})
