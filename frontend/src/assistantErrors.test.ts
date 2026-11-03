import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError } from './api/client'
import { describeAssistantError, GENERIC_ERROR, RATE_LIMITED, UNAVAILABLE } from './assistantErrors'

describe('describeAssistantError', () => {
  it('says the assistant is unavailable, and ordering still works, on a 503', () => {
    const message = describeAssistantError(new ApiError(503, { detail: 'not configured' }))

    expect(message).toBe(UNAVAILABLE)
    expect(message).toMatch(/order from the menu/i)
  })

  it('asks the user to wait on a 429', () => {
    expect(describeAssistantError(new ApiError(429, {}))).toBe(RATE_LIMITED)
  })

  it.each([502, 400, 500])('gives the general message on a %i', (status) => {
    expect(describeAssistantError(new ApiError(status, {}))).toBe(GENERIC_ERROR)
  })

  it('gives the general message when the server cannot be reached', () => {
    expect(describeAssistantError(new NetworkError(new TypeError('Failed to fetch')))).toBe(GENERIC_ERROR)
  })

  it('gives the general message for anything unexpected', () => {
    expect(describeAssistantError('boom')).toBe(GENERIC_ERROR)
  })
})
