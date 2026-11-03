import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AuthProvider from './AuthProvider'
import { useAuth } from '../authContext'
import { aCook, jsonResponse, stubApi } from '../testApi'

let meAnswer: () => Response | Promise<Response> = () => jsonResponse({ user: null })
const fetchMock = stubApi((url, init) => {
  if (url.pathname === '/api/auth/me/') return meAnswer()
  if (url.pathname === '/api/auth/login/' && init?.method === 'POST') {
    return JSON.parse(String(init.body)).password === 'right'
      ? aCook()
      : jsonResponse({ detail: 'Wrong username or password.' }, 400)
  }
  if (url.pathname === '/api/auth/logout/') return new Response(null, { status: 204 })
  return []
})

function Probe() {
  const { state, signIn, signOut, sessionEnded } = useAuth()
  return (
    <>
      <p data-testid="status">{state.status}</p>
      <p data-testid="user">{state.user?.username ?? 'nobody'}</p>
      <button type="button" onClick={() => void signIn('cook', 'right')}>
        right
      </button>
      <button type="button" onClick={() => signIn('cook', 'wrong').catch(() => undefined)}>
        wrong
      </button>
      <button type="button" onClick={() => void signOut()}>
        out
      </button>
      <button type="button" onClick={sessionEnded}>
        ended
      </button>
    </>
  )
}

const meCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/me/'))

function renderAuth(initialUser?: ReturnType<typeof aCook> | null) {
  meAnswer = () => jsonResponse({ user: null })
  return render(
    <AuthProvider initialUser={initialUser}>
      <Probe />
    </AuthProvider>,
  )
}

describe('AuthProvider', () => {
  it('asks the server once who is signed in, and is loading until it answers', async () => {
    meAnswer = () => new Promise<Response>(() => {})
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    expect(screen.getByTestId('status')).toHaveTextContent('loading')
    expect(meCalls()).toHaveLength(1)
  })

  it('shows the user the server says is signed in', async () => {
    meAnswer = () => jsonResponse({ user: aCook() })
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('cook'))
    expect(screen.getByTestId('status')).toHaveTextContent('ready')
  })

  it('treats an unreachable server as signed out', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))
    expect(screen.getByTestId('user')).toHaveTextContent('nobody')
  })

  it('does not ask the server when it is given who is signed in', () => {
    renderAuth(aCook())

    expect(screen.getByTestId('user')).toHaveTextContent('cook')
    expect(meCalls()).toHaveLength(0)
  })

  it('does not ask the server when it is told nobody is signed in', () => {
    renderAuth(null)

    expect(screen.getByTestId('status')).toHaveTextContent('ready')
    expect(meCalls()).toHaveLength(0)
  })

  it('signs in with the right password', async () => {
    const user = userEvent.setup()
    renderAuth(null)

    await user.click(screen.getByRole('button', { name: 'right' }))

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('cook'))
  })

  it('stays signed out and rejects with the server\'s answer for a wrong password', async () => {
    const user = userEvent.setup()
    renderAuth(null)

    await user.click(screen.getByRole('button', { name: 'wrong' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/auth/login/'))).toBe(true))
    expect(screen.getByTestId('user')).toHaveTextContent('nobody')
  })

  it('signs out, and is signed out even if the server could not be told', async () => {
    const user = userEvent.setup()
    renderAuth(aCook())
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await user.click(screen.getByRole('button', { name: 'out' }))

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('nobody'))
  })

  it('forgets the user when the session has ended', async () => {
    const user = userEvent.setup()
    renderAuth(aCook())

    await user.click(screen.getByRole('button', { name: 'ended' }))

    expect(screen.getByTestId('user')).toHaveTextContent('nobody')
  })
})
