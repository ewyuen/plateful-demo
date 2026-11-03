import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError } from './client'
import { listRestaurants, startCheckout } from './index'

const fetchMock = vi.fn()

const newOrder = {
  restaurant: 1,
  customer_name: '',
  items: [{ menu_item: 7, quantity: 1 }],
}

// Run a call that should fail and hand back the error it threw.
async function failureOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call
  } catch (error) {
    return error
  }
  throw new Error('expected the call to fail')
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('VITE_API_URL', '')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('HTTP errors', () => {
  it('carries the status and the JSON body of a 400', async () => {
    const body = { customer_name: ['This field may not be blank.'] }
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const error = await failureOf(startCheckout(newOrder))

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, body })
  })

  it('keeps the status of a 500 whose body is not JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>Server Error</html>', {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      }),
    )

    const error = await failureOf(listRestaurants())

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 500, body: undefined })
  })

  it('treats a 404 as an error, not as data', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Not found.' }), { status: 404 }),
    )

    const error = await failureOf(listRestaurants())

    expect(error).toMatchObject({ status: 404, body: { detail: 'Not found.' } })
  })
})

describe('network failures', () => {
  it('reports a rejected fetch as a NetworkError with no status', async () => {
    const cause = new TypeError('Failed to fetch')
    fetchMock.mockRejectedValue(cause)

    const error = await failureOf(listRestaurants())

    expect(error).toBeInstanceOf(NetworkError)
    expect(error).not.toBeInstanceOf(ApiError)
    expect(error).not.toHaveProperty('status')
    expect((error as NetworkError).cause).toBe(cause)
  })
})

describe('cancelled requests', () => {
  it('passes the abort signal to fetch', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ count: 0, next: null, previous: null, results: [] })),
    )
    const controller = new AbortController()

    await listRestaurants({}, controller.signal)

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })

  it('lets an AbortError through instead of calling it a failure', async () => {
    const aborted = new DOMException('The operation was aborted.', 'AbortError')
    fetchMock.mockRejectedValue(aborted)

    const error = await failureOf(listRestaurants())

    expect(error).toBe(aborted)
    expect(error).not.toBeInstanceOf(NetworkError)
    expect(error).not.toBeInstanceOf(ApiError)
  })
})
