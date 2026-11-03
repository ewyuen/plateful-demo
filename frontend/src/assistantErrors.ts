import { ApiError } from './api/client'

export const UNAVAILABLE = 'The assistant is not available right now. You can still order from the menu.'
export const RATE_LIMITED = 'You are asking quickly. Please wait a moment and try again.'
export const GENERIC_ERROR = 'The assistant could not answer. Please try again.'

// 503: the server has no API key. 429: this client asked too often. Anything else
// (a 502, a 400, no connection) gets the general message, which says to try again.
export function describeAssistantError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 503) return UNAVAILABLE
    if (error.status === 429) return RATE_LIMITED
  }
  return GENERIC_ERROR
}
