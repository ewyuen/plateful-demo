import { createContext, useContext } from 'react'
import type { AuthUser } from './api/types'

// Who is signed in (ADR-0014). `loading` lasts until the server has answered the first
// "who am I", so a page does not flash "sign in" at someone who is already signed in.
export interface AuthState {
  status: 'loading' | 'ready'
  user: AuthUser | null
}

export interface AuthContextValue {
  state: AuthState
  // Rejects with the ApiError of a failed sign-in, so the form can say why.
  signIn: (username: string, password: string) => Promise<AuthUser>
  // Makes a customer account and signs it in. Rejects with the ApiError of a refusal.
  register: (username: string, password: string) => Promise<AuthUser>
  signOut: () => Promise<void>
  // The server said 403 to a staff call: the session is over, whatever the page believed.
  sessionEnded: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (value === null) {
    throw new Error('useAuth must be used inside an AuthProvider')
  }
  return value
}
