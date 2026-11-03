import { ApiError } from './api/client'

// The message shown when a list could not be loaded. `subject` completes the
// sentence, for example "the menu" or "the orders".
export function describeFetchError(cause: unknown, subject: string): string {
  return cause instanceof ApiError
    ? `Could not load ${subject} (error ${cause.status}).`
    : 'Could not reach the server. Is the API running?'
}
