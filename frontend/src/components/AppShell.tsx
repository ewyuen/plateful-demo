import { Link, NavLink, Outlet } from 'react-router'
import { cartCount } from '../cart'
import { useAuth } from '../authContext'
import { isCustomer, isOwner, isStaff } from '../roles'
import { useOrderDraft } from '../orderDraftContext'
import CartNotice from './CartNotice'
import Credits from './Credits'
import styles from './AppShell.module.css'

// What every page shares: the header with the page links, then the page, then the footer.
// NavLink marks the current page with aria-current, and the CSS underlines it so the mark
// does not rely on colour alone.
function AppShell() {
  const { state } = useOrderDraft()
  const { state: auth, signOut } = useAuth()
  const count = cartCount(state.cart)
  const staff = isStaff(auth.user)
  const customer = isCustomer(auth.user)

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.bar}>
          <Link to="/" className={styles.brand}>
            Plateful
          </Link>
          <nav className={styles.nav} aria-label="Main">
            <NavLink to="/" end>
              Restaurants
            </NavLink>
            <NavLink to="/orders">Orders</NavLink>
            {staff && <NavLink to="/fulfilment">Fulfilment</NavLink>}
            {isOwner(auth.user) && <NavLink to="/dashboard">Dashboard</NavLink>}
            {customer && <NavLink to="/my-orders">My orders</NavLink>}
            <NavLink to="/checkout" className={styles.cart}>
              Cart
              <span className={styles.count} aria-label={`${count} items`}>
                {count}
              </span>
            </NavLink>
            {auth.status === 'ready' &&
              (auth.user === null ? (
                <NavLink to="/login">Login</NavLink>
              ) : (
                <span className={styles.who}>
                  {auth.user.username}
                  {auth.user.role !== null && auth.user.role !== 'customer' && ` (${auth.user.role})`}
                  <button type="button" className={styles.logout} onClick={() => void signOut()}>
                    Log out
                  </button>
                </span>
              ))}
          </nav>
        </div>
      </header>
      <CartNotice />
      <main className={styles.main}>
        <Outlet />
      </main>
      <Credits />
    </div>
  )
}

export default AppShell
