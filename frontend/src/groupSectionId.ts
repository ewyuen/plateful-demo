import type { MenuGroup } from './api/types'

// The id of the section that shows a menu group; the category navigation jumps to it.
export function groupSectionId(group: MenuGroup): string {
  return `group-${group.id ?? 'other'}`
}
