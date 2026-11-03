import { describe, expect, it } from 'vitest'
import indexHtml from '../index.html?raw'

// Vite serves everything in public/ from the site root, so an href of
// "/favicon.svg" must match a file at public/favicon.svg.
const publicFiles = Object.keys(import.meta.glob('../public/*'))

describe('index.html', () => {
  it('points the page icon at a file that exists in public/', () => {
    const href = /<link[^>]*rel="icon"[^>]*href="([^"]+)"/.exec(indexHtml)?.[1]

    expect(href).toBeDefined()
    expect(publicFiles).toContain(`../public${href}`)
  })

  it('names the page Plateful', () => {
    const title = /<title>([^<]*)<\/title>/.exec(indexHtml)?.[1]

    expect(title).toBe('Plateful')
  })

  it('has no unused files in public/ besides the icon', () => {
    expect(publicFiles).toEqual(['../public/favicon.svg'])
  })
})
