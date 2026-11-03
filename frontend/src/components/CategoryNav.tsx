import { useState } from 'react'
import type { MenuGroup } from '../api/types'
import { groupSectionId } from '../groupSectionId'
import styles from './CategoryNav.module.css'

// One button per group, in the menu's order. Activating one brings that group into view
// and marks it as current. They are real buttons, so Tab and Enter work.
function CategoryNav({ groups }: { groups: MenuGroup[] }) {
  const [current, setCurrent] = useState<string | null>(null)
  if (groups.length < 2) return null

  function jumpTo(group: MenuGroup) {
    setCurrent(groupSectionId(group))
    document.getElementById(groupSectionId(group))?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav className={styles.nav} aria-label="Menu categories">
      <ul className={styles.list}>
        {groups.map((group) => {
          const isCurrent = current === groupSectionId(group)
          return (
            <li key={groupSectionId(group)}>
              <button
                type="button"
                className={isCurrent ? `${styles.item} ${styles.current}` : styles.item}
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => jumpTo(group)}
              >
                {group.name}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default CategoryNav
