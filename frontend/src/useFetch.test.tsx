import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ApiError, NetworkError } from './api/client'
import { useFetch } from './useFetch'

// A request the test finishes by hand, so it controls the order of the answers.
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useFetch', () => {
  it('is loading with no data until the answer arrives, then gives the data', async () => {
    const request = deferred<string>()
    const { result } = renderHook(() => useFetch(() => request.promise, [], 'things'))

    expect(result.current).toEqual({ data: undefined, loading: true, error: null })
    await act(async () => request.resolve('hello'))

    expect(result.current).toEqual({ data: 'hello', loading: false, error: null })
  })

  it('gives a message with the status when the API answers with an error', async () => {
    const { result } = renderHook(() =>
      useFetch(() => Promise.reject(new ApiError(500, undefined)), [], 'things'),
    )

    await vi.waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('Could not load things (error 500).')
    expect(result.current.data).toBeUndefined()
  })

  it('says the server could not be reached for a network failure', async () => {
    const { result } = renderHook(() =>
      useFetch(() => Promise.reject(new NetworkError(new TypeError('x'))), [], 'things'),
    )

    await vi.waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toMatch(/could not reach the server/i)
  })

  it('passes a signal to the fetcher and aborts it when the component is removed', () => {
    const fetcher = vi.fn((signal: AbortSignal) => {
      void signal
      return new Promise<string>(() => {})
    })
    const { unmount } = renderHook(() => useFetch(fetcher, [], 'things'))
    const signal: AbortSignal = fetcher.mock.calls[0][0]

    expect(signal.aborted).toBe(false)
    unmount()

    expect(signal.aborted).toBe(true)
  })

  it('aborts the old request and starts a new one when a dependency changes', () => {
    const fetcher = vi.fn((signal: AbortSignal) => {
      void signal
      return new Promise<string>(() => {})
    })
    const { rerender } = renderHook(({ id }) => useFetch(fetcher, [id], 'things'), {
      initialProps: { id: 1 },
    })
    const first: AbortSignal = fetcher.mock.calls[0][0]

    rerender({ id: 2 })

    expect(first.aborted).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect((fetcher.mock.calls[1][0] as AbortSignal).aborted).toBe(false)
  })

  it('ignores an old answer that arrives after a newer request started', async () => {
    const old = deferred<string>()
    const recent = deferred<string>()
    const requests = [old, recent]
    let call = 0
    const { result, rerender } = renderHook(
      ({ id }) => useFetch(() => requests[call++].promise, [id], 'things'),
      { initialProps: { id: 1 } },
    )
    rerender({ id: 2 })

    await act(async () => recent.resolve('new'))
    await act(async () => old.resolve('old'))

    expect(result.current.data).toBe('new')
    expect(result.current.loading).toBe(false)
  })

  it('ignores an old failure that arrives after a newer request started', async () => {
    const old = deferred<string>()
    const recent = deferred<string>()
    const requests = [old, recent]
    let call = 0
    const { result, rerender } = renderHook(
      ({ id }) => useFetch(() => requests[call++].promise, [id], 'things'),
      { initialProps: { id: 1 } },
    )
    rerender({ id: 2 })

    await act(async () => recent.resolve('new'))
    await act(async () => old.reject(new ApiError(500, undefined)))

    expect(result.current.error).toBeNull()
    expect(result.current.data).toBe('new')
    expect(result.current.loading).toBe(false)
  })

  it('does not fetch again when it renders again with the same dependencies', () => {
    const fetcher = vi.fn(() => new Promise<string>(() => {}))
    const { rerender } = renderHook(() => useFetch(() => fetcher(), [1], 'things'))

    rerender()
    rerender()

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('fetches nothing and is not loading when the fetcher is null', () => {
    const { result } = renderHook(() => useFetch<string>(null, [null], 'things'))

    expect(result.current).toEqual({ data: undefined, loading: false, error: null })
  })

  describe('when the dependencies change to ask for fresh data', () => {
    it('keeps the old data while the new answer is awaited, then replaces it', async () => {
      const second = deferred<string>()
      const answers = [Promise.resolve('first'), second.promise]
      let call = 0
      const { result, rerender } = renderHook(
        ({ version }) => useFetch(() => answers[call++], [version], 'things'),
        { initialProps: { version: 0 } },
      )
      await vi.waitFor(() => expect(result.current.data).toBe('first'))

      rerender({ version: 1 })
      expect(result.current).toEqual({ data: 'first', loading: true, error: null })

      await act(async () => second.resolve('second'))
      expect(result.current).toEqual({ data: 'second', loading: false, error: null })
    })

    it('keeps the old data and reports the error when the refresh fails', async () => {
      const answers = [
        () => Promise.resolve('first'),
        () => Promise.reject(new ApiError(503, undefined)),
      ]
      let call = 0
      const { result, rerender } = renderHook(
        ({ version }) => useFetch(() => answers[call++](), [version], 'things'),
        { initialProps: { version: 0 } },
      )
      await vi.waitFor(() => expect(result.current.data).toBe('first'))

      rerender({ version: 1 })
      await vi.waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.data).toBe('first')
      expect(result.current.error).toBe('Could not load things (error 503).')
    })
  })
})
