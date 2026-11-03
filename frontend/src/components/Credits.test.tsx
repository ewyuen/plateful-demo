import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Credits from './Credits'

describe('Credits', () => {
  it('says the photos are from Unsplash, linked to it', () => {
    render(<Credits />)

    expect(screen.getByRole('link', { name: 'Unsplash' })).toHaveAttribute('href', 'https://unsplash.com')
  })

  it('says what kind of project this is and that payments are sandbox', () => {
    render(<Credits />)

    expect(screen.getByText(/hackathon project/i)).toBeInTheDocument()
    expect(screen.getByText(/PayPal sandbox/i)).toBeInTheDocument()
  })
})
