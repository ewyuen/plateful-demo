import type { MenuGroupItem } from '../api/types'
import styles from './DishRow.module.css'

interface DishRowProps {
  dish: MenuGroupItem
  quantity: number
  onQuantity: (quantity: number) => void
}

// One dish: name, price and description, with decrease and increase buttons. The buttons
// carry the dish's name so a screen reader hears which dish they change.
function DishRow({ dish, quantity, onQuantity }: DishRowProps) {
  return (
    <li className={styles.dish}>
      <div className={styles.details}>
        <div className={styles.line}>
          <h3 className={styles.name}>{dish.name}</h3>
          <span className={styles.leader} aria-hidden="true" />
          <p className={styles.price}>${dish.price}</p>
        </div>
        {dish.description !== '' && <p className={styles.description}>{dish.description}</p>}
      </div>
      <div className={styles.stepper}>
        <button
          type="button"
          className={styles.step}
          aria-label={`Decrease quantity of ${dish.name}`}
          disabled={quantity === 0}
          onClick={() => onQuantity(quantity - 1)}
        >
          <span aria-hidden="true">−</span>
        </button>
        <output className={styles.quantity} aria-label={`Quantity of ${dish.name}`}>
          {quantity}
        </output>
        <button
          type="button"
          className={styles.step}
          aria-label={`Increase quantity of ${dish.name}`}
          onClick={() => onQuantity(quantity + 1)}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
    </li>
  )
}

export default DishRow
