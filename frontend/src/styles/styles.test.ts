import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Read the files from disk: Vitest turns a CSS import into an empty string.
const srcDir = join(__dirname, '..')
const tokensCss = readFileSync(join(__dirname, 'tokens.css'), 'utf8')

function cssModules(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return cssModules(path)
    return entry.name.endsWith('.module.css') ? [path] : []
  })
}

const moduleCss = Object.fromEntries(
  cssModules(srcDir).map((path) => [path.slice(srcDir.length + 1), readFileSync(path, 'utf8')]),
)

function tokens(): Record<string, string> {
  const found: Record<string, string> = {}
  for (const match of tokensCss.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    found[match[1]] = match[2].toLowerCase()
  }
  return found
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

// Every text colour on every background it is used on (WCAG AA, 4.5 to 1).
const textPairs: [string, string][] = [
  ['--color-text', '--color-bg'],
  ['--color-text', '--color-surface'],
  ['--color-text', '--color-bubble-user'],
  ['--color-text', '--color-bubble-assistant'],
  ['--color-text-muted', '--color-bg'],
  ['--color-text-muted', '--color-surface'],
  ['--color-text-muted', '--color-line'],
  ['--color-primary', '--color-bg'],
  ['--color-primary', '--color-surface'],
  ['--color-primary', '--color-bubble-user'],
  ['--color-text-muted', '--color-bubble-user'],
  ['--color-on-primary', '--color-primary'],
  ['--color-on-primary', '--color-primary-dark'],
  ['--color-gold-text', '--color-bg'],
  ['--color-gold-text', '--color-surface'],
  ['--color-success', '--color-bg'],
  ['--color-success', '--color-surface'],
  ['--color-error', '--color-bg'],
  ['--color-error', '--color-surface'],
  ['--color-on-ink', '--color-ink'],
]

describe('design tokens', () => {
  const values = tokens()

  it.each(textPairs)('%s on %s has a contrast ratio of at least 4.5 to 1', (text, background) => {
    expect(values[text], `${text} is defined`).toBeDefined()
    expect(values[background], `${background} is defined`).toBeDefined()
    expect(contrast(values[text], values[background])).toBeGreaterThanOrEqual(4.5)
  })

  it('defines the heading font as a serif stack', () => {
    expect(tokensCss).toMatch(/--font-heading:[^;]*serif/)
  })
})

describe('component styles', () => {
  it('finds the component stylesheets', () => {
    expect(Object.keys(moduleCss).length).toBeGreaterThan(0)
  })

  it.each(Object.entries(moduleCss))('%s uses tokens, not literal colours', (_file, css) => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/)
  })
})
