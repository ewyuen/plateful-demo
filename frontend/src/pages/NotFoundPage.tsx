import { Link } from 'react-router'
import styles from './Page.module.css'

// `what` says what could not be found: the page itself or a restaurant.
function NotFoundPage({ what = 'page' }: { what?: 'page' | 'restaurant' }) {
  return (
    <div className={styles.page}>
      <h1>{what === 'restaurant' ? 'Restaurant not found' : 'Page not found'}</h1>
      <p>
        {what === 'restaurant'
          ? 'We could not find that restaurant.'
          : 'There is nothing at this address.'}
      </p>
      <p>
        <Link to="/">See all restaurants</Link>
      </p>
    </div>
  )
}

export default NotFoundPage
