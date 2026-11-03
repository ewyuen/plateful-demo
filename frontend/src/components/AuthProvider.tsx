import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getMe, login, logout, register as registerAccount } from '../api'
import type { AuthUser } from '../api/types'
import { AuthContext, type AuthState } from '../authContext'

interface AuthProviderProps {
  children: ReactNode
  // Lets a test start signed in (a user) or signed out (null) without asking the server;
  // the app passes nothing and asks once at start.
  initialUser?: AuthUser | null
}

function AuthProvider({ children, initialUser }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>(
    initialUser === undefined ? { status: 'loading', user: null } : { status: 'ready', user: initialUser },
  )

  useEffect(() => {
    if (initialUser !== undefined) return
    const controller = new AbortController()
    getMe(controller.signal).then(
      (user) => setState({ status: 'ready', user }),
      () => {
        // The server could not be reached: treated as signed out, which is the safe side.
        if (!controller.signal.aborted) setState({ status: 'ready', user: null })
      },
    )
    return () => controller.abort()
  }, [initialUser])

  const signIn = useCallback(async (username: string, password: string) => {
    const user = await login(username, password)
    setState({ status: 'ready', user })
    return user
  }, [])

  const register = useCallback(async (username: string, password: string) => {
    const user = await registerAccount(username, password)
    setState({ status: 'ready', user })
    return user
  }, [])

  const signOut = useCallback(async () => {
    try {
      await logout()
    } catch {
      // Whatever the server said, this page no longer treats the user as signed in.
    }
    setState({ status: 'ready', user: null })
  }, [])

  const sessionEnded = useCallback(() => setState({ status: 'ready', user: null }), [])

  const value = useMemo(
    () => ({ state, signIn, register, signOut, sessionEnded }),
    [state, signIn, register, signOut, sessionEnded],
  )
  return <AuthContext value={value}>{children}</AuthContext>
}

export default AuthProvider
