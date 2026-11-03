import { useEffect, useRef, useState } from 'react'
import { describeFetchError } from './fetchError'

// The last finished request, with the key (the dependencies as text) it was for.
interface Outcome<T> {
  key: string
  data: T | undefined
  error: string | null
}

export interface FetchState<T> {
  data: T | undefined
  loading: boolean
  error: string | null
}

// Runs `fetcher` when the component appears and again whenever `deps` change.
//
// - `fetcher` receives an AbortSignal; the request is aborted when `deps` change
//   or the component goes away, and an answer to an aborted request is ignored.
// - Pass `null` as the fetcher to fetch nothing (for example, no restaurant yet).
// - `deps` must be plain values (numbers, strings, booleans, null). They are
//   compared as text, so a new `fetcher` function on every render is fine.
// - `loading` is worked out from what has finished, not stored, so the effect
//   never has to set state synchronously.
// - `data` keeps the previous answer while a new request is in flight, so a
//   refresh does not blank the screen. A component whose `deps` name a different
//   thing (not a refresh) should be remounted with a `key` instead.
export function useFetch<T>(
  fetcher: ((signal: AbortSignal) => Promise<T>) | null,
  deps: readonly (string | number | boolean | null)[],
  subject: string,
): FetchState<T> {
  const key = JSON.stringify(deps)
  const [outcome, setOutcome] = useState<Outcome<T> | null>(null)
  const fetcherRef = useRef(fetcher)

  useEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    const run = fetcherRef.current
    if (run === null) return
    const controller = new AbortController()

    run(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setOutcome({ key, data, error: null })
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setOutcome((previous) => ({
          key,
          data: previous?.data,
          error: describeFetchError(cause, subject),
        }))
      })

    return () => controller.abort()
  }, [key, subject])

  const settled = outcome !== null && outcome.key === key
  return {
    data: outcome?.data,
    loading: fetcher !== null && !settled,
    error: settled ? outcome.error : null,
  }
}
