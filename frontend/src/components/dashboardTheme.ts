import { themeQuartz } from 'ag-grid-community'

// The grid's look comes from the design tokens (styles/tokens.css), never from colours written
// here: AG Grid passes a string colour through unchanged, so `var(--token)` works (S34 spike).
export function dashboardTheme() {
  return themeQuartz.withParams({
    accentColor: 'var(--color-primary)',
    backgroundColor: 'var(--color-surface)',
    foregroundColor: 'var(--color-text)',
    headerBackgroundColor: 'var(--color-bubble-user)',
    headerTextColor: 'var(--color-text)',
    borderColor: 'var(--color-line)',
    fontFamily: 'var(--font-body)',
    headerFontWeight: 600,
    rowHeight: 44,
    headerHeight: 44,
  })
}
