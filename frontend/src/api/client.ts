const DEFAULT_API_URL = 'http://localhost:8000/api'

// Read the env var on every call (not once at import) so tests can change it
// with vi.stubEnv. Vite replaces import.meta.env.VITE_* at build time.
function baseUrl(): string {
  const configured = import.meta.env.VITE_API_URL || DEFAULT_API_URL
  return configured.replace(/\/+$/, '')
}

// buildUrl('/restaurants/') -> 'http://localhost:8000/api/restaurants/'
export function buildUrl(path: string): string {
  return `${baseUrl()}/${path.replace(/^\/+/, '')}`
}

// The server answered with a status outside 200-299.
export class ApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, body: unknown) {
    super(`API request failed with status ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

// The request never got a response (server down, DNS, CORS block). No status.
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Could not reach the API', { cause })
    this.name = 'NetworkError'
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  signal?: AbortSignal
}

// Django sets this cookie when the page asks who is signed in; a request that changes data
// must send it back in a header (ADR-0014). The cookie is not HttpOnly on purpose.
function csrfToken(): string | undefined {
  const entry = document.cookie.split('; ').find((part) => part.startsWith('csrftoken='))
  return entry === undefined ? undefined : decodeURIComponent(entry.slice('csrftoken='.length))
}

// Every API call goes through here. Components never call fetch directly.
export async function request<T>(
  path: string,
  { method = 'GET', body, signal }: RequestOptions = {},
): Promise<T> {
  let response: Response
  try {
    const token = method === 'GET' ? undefined : csrfToken()
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (token !== undefined) headers['X-CSRFToken'] = token
    response = await fetch(buildUrl(path), {
      method,
      headers: Object.keys(headers).length === 0 ? undefined : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      // The session cookie goes with every call, also across the dev ports (ADR-0014).
      credentials: 'include',
    })
  } catch (error) {
    // A cancelled request is not a failure: let the caller tell them apart.
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    throw new NetworkError(error)
  }

  if (!response.ok) {
    let errorBody: unknown
    try {
      errorBody = await response.json()
    } catch {
      errorBody = undefined // not JSON, e.g. an HTML 500 page
    }
    throw new ApiError(response.status, errorBody)
  }

  // Signing out answers 204 with no body.
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
