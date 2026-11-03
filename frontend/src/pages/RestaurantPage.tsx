import { useParams, Link } from 'react-router'
import { getRestaurantMenu } from '../api'
import { ApiError } from '../api/client'
import type { MenuGroup, RestaurantMenu } from '../api/types'
import AssistantChat from '../components/AssistantChat'
import AssistantPanel from '../components/AssistantPanel'
import CartPanel from '../components/CartPanel'
import CategoryNav from '../components/CategoryNav'
import DishRow from '../components/DishRow'
import ReplaceCartDialog from '../components/ReplaceCartDialog'
import { groupSectionId } from '../groupSectionId'
import { restaurantPhoto } from '../photos'
import { useCartActions } from '../useCartActions'
import { useFetch } from '../useFetch'
import NotFoundPage from './NotFoundPage'
import styles from './RestaurantPage.module.css'

function RestaurantView({ id }: { id: number }) {
  // A 404 is an answer, not a failure: it becomes `null`, "this restaurant does not exist".
  const { data, loading, error } = useFetch<RestaurantMenu | null>(
    (signal) =>
      getRestaurantMenu(id, signal).catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 404) return null
        throw cause
      }),
    [id],
    'the menu',
  )

  if (loading) {
    return (
      <div className={styles.page}>
        <p>Loading menu…</p>
      </div>
    )
  }
  if (error !== null) {
    return (
      <div className={styles.page}>
        <p role="alert">{error}</p>
      </div>
    )
  }
  if (data === null || data === undefined) return <NotFoundPage what="restaurant" />
  return <RestaurantMenuView menu={data} />
}

function RestaurantMenuView({ menu }: { menu: RestaurantMenu }) {
  const { restaurant, groups } = menu
  const priceOf = (dishId: number) =>
    groups.flatMap((group) => group.items).find((dish) => dish.id === dishId)?.price
  const cart = useCartActions(restaurant, priceOf)

  return (
    <>
      <header className={styles.banner}>
        <img className={styles.photo} src={restaurantPhoto(restaurant)} alt="" />
        <div className={styles.bannerText}>
          <Link to="/" className={styles.back}>
            ← All restaurants
          </Link>
          <h1 className={styles.title}>{restaurant.name}</h1>
          <p className={styles.meta}>
            {[restaurant.cuisine, restaurant.address].filter((part) => part !== '').join(' · ')}
          </p>
          {restaurant.description !== '' && <p className={styles.meta}>{restaurant.description}</p>}
          <p className={styles.meta}>
            {restaurant.offers_delivery ? `Delivery $${restaurant.delivery_fee} · Pickup` : 'Pickup only'}
          </p>
        </div>
      </header>

      <CategoryNav groups={groups} />

      <div className={styles.layout}>
        <div className={styles.menu}>
          {groups.length === 0 ? (
            <p>This restaurant’s menu is not ready yet.</p>
          ) : (
            groups.map((group) => <GroupSection key={groupSectionId(group)} group={group} cart={cart} />)
          )}
        </div>
        <CartPanel />
      </div>

      <AssistantPanel>
        <AssistantChat restaurantId={restaurant.id} onAddToCart={cart.addSuggestions} />
      </AssistantPanel>

      {cart.pending && (
        <ReplaceCartDialog
          fromName={cart.cartRestaurantName ?? 'another restaurant'}
          toName={restaurant.name}
          onConfirm={cart.confirm}
          onKeep={cart.keep}
        />
      )}
    </>
  )
}

function GroupSection({ group, cart }: { group: MenuGroup; cart: ReturnType<typeof useCartActions> }) {
  const sectionId = groupSectionId(group)
  return (
    <section id={sectionId} className={styles.group} aria-labelledby={`${sectionId}-heading`}>
      <h2 id={`${sectionId}-heading`}>{group.name}</h2>
      <ul className={styles.dishes}>
        {group.items.map((dish) => (
          <DishRow
            key={dish.id}
            dish={dish}
            quantity={cart.quantityOf(dish.id)}
            onQuantity={(quantity) => cart.setQuantity(dish, quantity)}
          />
        ))}
      </ul>
    </section>
  )
}

// The address holds the restaurant, so a reload shows the same page. The view is keyed by
// the id: opening another restaurant starts a fresh page and drops anything still in flight.
function RestaurantPage() {
  const { id } = useParams()
  const restaurantId = /^\d+$/.test(id ?? '') ? Number(id) : null
  if (restaurantId === null) return <NotFoundPage what="restaurant" />
  return <RestaurantView key={restaurantId} id={restaurantId} />
}

export default RestaurantPage
