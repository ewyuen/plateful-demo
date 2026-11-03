import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import OrderDraftProvider from './components/OrderDraftProvider'
import { initialOrderDraft } from './orderDraft'
import { useOrderDraft } from './orderDraftContext'

function wrapper({ children }: { children: ReactNode }) {
  return <OrderDraftProvider>{children}</OrderDraftProvider>
}

describe('useOrderDraft', () => {
  it('returns the initial draft inside the provider', () => {
    const { result } = renderHook(() => useOrderDraft(), { wrapper })

    expect(result.current.state).toEqual(initialOrderDraft)
  })

  it('updates the draft when an action is dispatched', () => {
    const { result } = renderHook(() => useOrderDraft(), { wrapper })

    act(() => result.current.dispatch({ type: 'restaurantChosen', id: 3 }))

    expect(result.current.state.restaurantId).toBe(3)
  })

  it('starts from the draft the provider was given', () => {
    const { result } = renderHook(() => useOrderDraft(), {
      wrapper: ({ children }) => (
        <OrderDraftProvider initialState={{ ...initialOrderDraft, customerName: 'Ann' }}>
          {children}
        </OrderDraftProvider>
      ),
    })

    expect(result.current.state.customerName).toBe('Ann')
  })

  it('throws a clear error outside the provider', () => {
    // React logs the error it rethrows; keep the test output quiet.
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => renderHook(() => useOrderDraft())).toThrow(/OrderDraftProvider/)

    log.mockRestore()
  })
})
