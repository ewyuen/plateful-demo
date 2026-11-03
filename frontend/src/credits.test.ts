import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { credits } from './credits'
import { cardPhoto, heroPhoto } from './photos'

const photoDir = join(__dirname, 'assets', 'photos')
const files = readdirSync(photoDir).sort()
const BUDGET_BYTES = 600 * 1024

describe('photo credits', () => {
  it('has a credit for every photo file and a photo file for every credit', () => {
    expect(credits.map((credit) => credit.file).sort()).toEqual(files)
  })

  it.each(credits)('credits $file to a named photographer with Unsplash links', (credit) => {
    expect(credit.photographer).not.toBe('')
    expect(credit.profileUrl).toMatch(/^https:\/\/unsplash\.com\/@/)
    expect(credit.photoUrl).toMatch(/^https:\/\/unsplash\.com\/photos\//)
  })

  it('keeps the photos within the size budget', () => {
    const total = files.reduce((sum, file) => sum + statSync(join(photoDir, file)).size, 0)

    expect(total).toBeLessThan(BUDGET_BYTES)
  })
})

describe('photos', () => {
  it('describes the hero photo', () => {
    expect(heroPhoto.alt).not.toBe('')
  })

  it('gives every restaurant a card photo, repeating when there are more restaurants', () => {
    expect([0, 1, 2, 3, 4].map((index) => cardPhoto(index)).every((src) => src !== undefined)).toBe(true)
    expect(cardPhoto(3)).toBe(cardPhoto(0))
  })
})
