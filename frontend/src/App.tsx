import './App.css'
import { Route, Routes } from 'react-router'
import type { AuthUser } from './api/types'
import AppShell from './components/AppShell'
import AuthProvider from './components/AuthProvider'
import OrderDraftProvider from './components/OrderDraftProvider'
import RequireStaff from './components/RequireStaff'
import type { OrderDraft } from './orderDraft'
import CheckoutPage from './pages/CheckoutPage'
import DiscoverPage from './pages/DiscoverPage'
import FulfilmentPage from './pages/FulfilmentPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import MyOrdersPage from './pages/MyOrdersPage'
import OrdersPage from './pages/OrdersPage'
import RegisterPage from './pages/RegisterPage'
import RestaurantPage from './pages/RestaurantPage'

// The pages and their addresses (ADR-0016). The cart lives above the routes, so it
// survives moving between pages; the router itself is provided by main.tsx or a test.
// `initialDraft` lets a test start with a restaurant chosen and a cart filled; the app
// itself starts from the cart kept in the browser.
// `initialUser` does the same for who is signed in (null: nobody); the app asks the server.
function App({ initialDraft, initialUser }: { initialDraft?: OrderDraft; initialUser?: AuthUser | null }) {
  return (
    <AuthProvider initialUser={initialUser}>
      <OrderDraftProvider initialState={initialDraft}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<DiscoverPage />} />
            <Route path="restaurants/:id" element={<RestaurantPage />} />
            <Route path="checkout" element={<CheckoutPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="register" element={<RegisterPage />} />
            <Route path="my-orders" element={<MyOrdersPage />} />
            <Route
              path="fulfilment"
              element={
                <RequireStaff next="/fulfilment">
                  <FulfilmentPage />
                </RequireStaff>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </OrderDraftProvider>
    </AuthProvider>
  )
}

export default App
