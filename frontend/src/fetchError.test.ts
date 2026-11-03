import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError } from './api/client'
import { describeFetchError } from './fetchError'

describe('describeFetchError', () => {
  it('names the subject and the status for an API error', () => {
    expect(describeFetchError(new ApiError(500, undefined), 'the menu')).toBe(
      'Could not load the menu (error 500).',
    )
  })

  it('says the server could not be reached for a network failure', () => {
    expect(describeFetchError(new NetworkError(new TypeError('x')), 'the menu')).toMatch(
      /could not reach the server/i,
    )
  })

  it('says the server could not be reached for anything else', () => {
    expect(describeFetchError('boom', 'the menu')).toMatch(/could not reach the server/i)
  })
})
