import dish from './assets/photos/dish.webp'
import hero from './assets/photos/hero.webp'
import noodles from './assets/photos/noodles.webp'
import tea from './assets/photos/tea.webp'

// A restaurant without an image link gets one of these photos, chosen by its id and
// decorative (an empty alt); the hero describes itself.
export const heroPhoto = {
  src: hero,
  alt: 'A warm dining room lit by strings of lights',
}

export const cardPhotos: string[] = [dish, noodles, tea]

export function cardPhoto(index: number): string {
  return cardPhotos[index % cardPhotos.length]
}

// A restaurant's own picture when it has an image link, else one of ours chosen by its id,
// so it keeps the same photo on every page.
export function restaurantPhoto(restaurant: { id: number; image_url: string }): string {
  return restaurant.image_url !== '' ? restaurant.image_url : cardPhoto(restaurant.id)
}
