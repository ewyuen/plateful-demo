import { useId, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { listCuisines, listRestaurants } from '../api'
import type { Restaurant } from '../api/types'
import { heroPhoto, restaurantPhoto } from '../photos'
import { useFetch } from '../useFetch'
import styles from './DiscoverPage.module.css'

// The search box keeps its own text while the user types and writes it to the address only
// on submit, so each request is deliberate. The parent gives it a key of the address's
// value, so Back, "Clear filters" or a link that changes the search resets the box.
function SearchForm({ initial, onSearch }: { initial: string; onSearch: (text: string) => void }) {
  const [text, setText] = useState(initial)
  const inputId = useId()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSearch(text.trim())
  }

  return (
    <form className={styles.search} role="search" onSubmit={handleSubmit}>
      <label htmlFor={inputId}>Search restaurants</label>
      <div className={styles.searchRow}>
        <input
          id={inputId}
          type="search"
          value={text}
          placeholder="Name or cuisine"
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit">Search</button>
      </div>
    </form>
  )
}

function RestaurantCard({ restaurant }: { restaurant: Restaurant }) {
  return (
    <li className={styles.card}>
      <img className={styles.photo} src={restaurantPhoto(restaurant)} alt="" />
      <div className={styles.cardText}>
        <h3 className={styles.cardName}>
          <Link to={`/restaurants/${restaurant.id}`}>{restaurant.name}</Link>
        </h3>
        {restaurant.cuisine !== '' && <p className={styles.cuisine}>{restaurant.cuisine}</p>}
        <p className={styles.address}>{restaurant.address}</p>
        <p className={styles.fulfilment}>
          {restaurant.offers_delivery ? `Delivery $${restaurant.delivery_fee} · Pickup` : 'Pickup only'}
        </p>
      </div>
    </li>
  )
}

function DiscoverPage() {
  const [params, setParams] = useSearchParams()
  const search = params.get('search') ?? ''
  const cuisine = params.get('cuisine') ?? ''
  const delivery = params.get('delivery') === 'true'

  const restaurants = useFetch(
    (signal) => listRestaurants({ search, cuisine, offersDelivery: delivery }, signal),
    [search, cuisine, delivery],
    'restaurants',
  )
  // The chips are a convenience: if they cannot load, the cards still work without them.
  const cuisines = useFetch((signal) => listCuisines(signal), [], 'the cuisines')

  function update(changes: { search?: string; cuisine?: string; delivery?: string }) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '') next.delete(key)
      else next.set(key, value)
    }
    setParams(next)
  }

  const filtered = search !== '' || cuisine !== '' || delivery

  return (
    <>
      <section className={styles.hero} aria-labelledby="discover-heading">
        <img className={styles.heroPhoto} src={heroPhoto.src} alt={heroPhoto.alt} />
        <div className={styles.heroText}>
          <h1 id="discover-heading" className={styles.title}>
            Order from restaurants across the network
          </h1>
          <p className={styles.tagline}>Warm food, made to share</p>
          <SearchForm
            key={search}
            initial={search}
            onSearch={(text) => update({ search: text })}
          />
        </div>
      </section>

      <div className={styles.content}>
        <div className={styles.filters}>
          {cuisines.data !== undefined && cuisines.data.length > 0 && (
            <div className={styles.chips} role="group" aria-label="Filter by cuisine">
              <button
                type="button"
                className={cuisine === '' ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                aria-pressed={cuisine === ''}
                onClick={() => update({ cuisine: '' })}
              >
                {cuisine === '' && <span aria-hidden="true">✓ </span>}All cuisines
              </button>
              {cuisines.data.map((name) => {
                const chosen = name.toLowerCase() === cuisine.toLowerCase()
                return (
                  <button
                    key={name}
                    type="button"
                    className={chosen ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                    aria-pressed={chosen}
                    onClick={() => update({ cuisine: name })}
                  >
                    {chosen && <span aria-hidden="true">✓ </span>}
                    {name}
                  </button>
                )
              })}
            </div>
          )}

          <div className={styles.chips} role="group" aria-label="Filter by fulfilment">
            <button
              type="button"
              className={delivery ? `${styles.chip} ${styles.chipOn}` : styles.chip}
              aria-pressed={delivery}
              onClick={() => update({ delivery: delivery ? '' : 'true' })}
            >
              {delivery && <span aria-hidden="true">✓ </span>}Delivery
            </button>
          </div>
        </div>

        {restaurants.loading ? (
          <p>Loading restaurants…</p>
        ) : restaurants.error !== null ? (
          <p role="alert">{restaurants.error}</p>
        ) : restaurants.data === undefined ? null : restaurants.data.results.length === 0 ? (
          <div className={styles.empty}>
            <h2>No restaurants match</h2>
            <p>Try a different search or cuisine.</p>
            {filtered && (
              <button type="button" onClick={() => setParams(new URLSearchParams())}>
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <h2 className={styles.count}>
              {restaurants.data.count} {restaurants.data.count === 1 ? 'restaurant' : 'restaurants'}
            </h2>
            <ul className={styles.grid}>
              {restaurants.data.results.map((restaurant) => (
                <RestaurantCard key={restaurant.id} restaurant={restaurant} />
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  )
}

export default DiscoverPage
