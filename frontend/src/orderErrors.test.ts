import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError } from './api/client'
import { describeOrderError, GENERIC_ERROR } from './orderErrors'

const generic = { nameErrors: [], messages: [GENERIC_ERROR] }

// The bodies below were recorded from the real API with curl (S7 task 1.1).
describe('describeOrderError', () => {
  it('gives the generic message when the server cannot be reached', () => {
    expect(describeOrderError(new NetworkError(new TypeError('Failed to fetch')))).toEqual(generic)
  })

  it('gives the generic message for a server error', () => {
    expect(describeOrderError(new ApiError(500, undefined))).toEqual(generic)
    expect(describeOrderError(new ApiError(503, { detail: 'Unavailable' }))).toEqual(generic)
  })

  it('gives the generic message for an error that is not an API error', () => {
    expect(describeOrderError(new Error('boom'))).toEqual(generic)
    expect(describeOrderError('boom')).toEqual(generic)
  })

  it('gives the generic message for other statuses, even with a body', () => {
    expect(describeOrderError(new ApiError(404, { detail: 'Not found.' }))).toEqual(generic)
  })

  it('puts a customer name problem in nameErrors', () => {
    const error = new ApiError(400, { customer_name: ['This field may not be blank.'] })

    expect(describeOrderError(error)).toEqual({
      nameErrors: ['This field may not be blank.'],
      messages: [],
    })
  })

  it('reads the message of the item that was rejected', () => {
    const error = new ApiError(400, {
      items: [{}, { menu_item: ['Seasonal Soup is unavailable.'] }],
    })

    expect(describeOrderError(error)).toEqual({
      nameErrors: [],
      messages: ['Seasonal Soup is unavailable.'],
    })
  })

  it('reads the message of an empty item list, which arrives as an object', () => {
    const error = new ApiError(400, { items: { non_field_errors: ['This list may not be empty.'] } })

    expect(describeOrderError(error).messages).toEqual(['This list may not be empty.'])
  })

  it('reads a quantity message, which arrives keyed by the item index', () => {
    const error = new ApiError(400, {
      items: { '0': { quantity: ['Ensure this value is greater than or equal to 1.'] } },
    })

    expect(describeOrderError(error).messages).toEqual([
      'Ensure this value is greater than or equal to 1.',
    ])
  })

  it('reads the detail of a malformed request', () => {
    const error = new ApiError(400, { detail: 'JSON parse error' })

    expect(describeOrderError(error).messages).toEqual(['JSON parse error'])
  })

  it('keeps name problems and item problems apart', () => {
    const error = new ApiError(400, {
      customer_name: ['This field is required.'],
      items: [{ menu_item: ['Ramen appears more than once.'] }],
    })

    expect(describeOrderError(error)).toEqual({
      nameErrors: ['This field is required.'],
      messages: ['Ramen appears more than once.'],
    })
  })

  it('gives the generic message when a 400 has no readable message', () => {
    expect(describeOrderError(new ApiError(400, undefined))).toEqual(generic)
    expect(describeOrderError(new ApiError(400, {}))).toEqual(generic)
    expect(describeOrderError(new ApiError(400, '<html></html>'))).toEqual(generic)
  })

  it('puts a delivery address problem in addressErrors', () => {
    const error = new ApiError(400, { delivery_address: ['Enter a delivery address.'] })

    expect(describeOrderError(error)).toEqual({
      nameErrors: [],
      messages: [],
      addressErrors: ['Enter a delivery address.'],
    })
  })

  it('shows a restaurant that does not deliver as a message', () => {
    const error = new ApiError(400, {
      fulfilment_type: ['Noodle Bar does not offer delivery.'],
    })

    expect(describeOrderError(error)).toEqual({
      nameErrors: [],
      messages: ['Noodle Bar does not offer delivery.'],
    })
  })
})
