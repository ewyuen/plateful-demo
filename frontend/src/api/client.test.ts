import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildUrl, request } from './client'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('buildUrl', () => {
  it('uses the local Django server when VITE_API_URL is not set', () => {
    vi.stubEnv('VITE_API_URL', '')

    expect(buildUrl('/restaurants/')).toBe('http://localhost:8000/api/restaurants/')
  })

  it('uses VITE_API_URL and drops its trailing slash', () => {
    vi.stubEnv('VITE_API_URL', 'https://cafe.example/api/')

    expect(buildUrl('/restaurants/')).toBe('https://cafe.example/api/restaurants/')
  })

  it('gives the same URL with or without a leading slash on the path', () => {
    vi.stubEnv('VITE_API_URL', 'https://cafe.example/api')

    expect(buildUrl('restaurants/')).toBe(buildUrl('/restaurants/'))
  })
})

describe('request and the staff session', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_URL', '')
    document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  })

  it('sends the session cookie with every call', async () => {
    await request('/restaurants/')

    expect(fetchMock.mock.calls[0][1].credentials).toBe('include')
  })

  it('sends the CSRF token from its cookie on a POST', async () => {
    document.cookie = 'csrftoken=abc%20123'

    await request('/auth/logout/', { method: 'POST' })

    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'X-CSRFToken': 'abc 123' })
  })

  it('sends the token next to the JSON content type when there is a body', async () => {
    document.cookie = 'csrftoken=tok'

    await request('/x/', { method: 'POST', body: { a: 1 } })

    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      'X-CSRFToken': 'tok',
    })
  })

  it('sends no token on a GET, even when the cookie exists', async () => {
    document.cookie = 'csrftoken=tok'

    await request('/restaurants/')

    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined()
  })

  it('sends no token header when there is no cookie', async () => {
    await request('/x/', { method: 'POST' })

    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined()
  })

  it('answers nothing for a 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(request('/auth/logout/', { method: 'POST' })).resolves.toBeUndefined()
  })
})
