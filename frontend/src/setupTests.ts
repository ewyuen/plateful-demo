import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest does not expose afterEach globally, so Testing Library cannot clean
// up on its own. Without this, every test sees the previous tests' DOM.
afterEach(() => {
  cleanup()
  // The app keeps the cart in local storage; every test starts without it.
  window.localStorage.clear()
})
