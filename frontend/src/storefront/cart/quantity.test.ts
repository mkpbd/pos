import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/client'
import { canDecrease, canIncrease, cartErrorMessage, displayQuantity, effectiveMax, maxQuantityHint, normalizeQuantity, stepQuantity } from './quantity'

describe('cart quantities', () => {
  it('normalizes typed quantities: whole numbers unless the product allows fractions, 0 < q ≤ 999, 3 decimals', () => {
    expect(normalizeQuantity(' 3 ', false)).toBe('3')
    expect(normalizeQuantity('007', false)).toBe('7')
    expect(normalizeQuantity('1.5', false)).toBeNull()
    expect(normalizeQuantity('0', false)).toBeNull()
    expect(normalizeQuantity('1000', false)).toBeNull()
    expect(normalizeQuantity('999', false)).toBe('999')
    expect(normalizeQuantity('abc', false)).toBeNull()
    expect(normalizeQuantity('-2', false)).toBeNull()
    expect(normalizeQuantity('1.250', true)).toBe('1.25')
    expect(normalizeQuantity('2,5', true)).toBe('2.5')
    expect(normalizeQuantity('0.0005', true)).toBeNull()
    expect(normalizeQuantity('0.000', true)).toBeNull()
    expect(normalizeQuantity('0.125', true)).toBe('0.125')
  })

  it('steps by one within 1…max (exact decimals, never floats)', () => {
    expect(stepQuantity('1', 1)).toBe('2')
    expect(stepQuantity('1', -1)).toBe('1')
    expect(stepQuantity('2.000', -1)).toBe('1')
    expect(stepQuantity('1.5', -1)).toBe('0.5')
    expect(stepQuantity('0.5', -1)).toBe('0.5')
    expect(stepQuantity('0.1', 1)).toBe('1.1')
    expect(stepQuantity('4', 1, '5.000')).toBe('5')
    expect(stepQuantity('5', 1, '5.000')).toBe('5')
    expect(stepQuantity('4.5', 1, '5.000')).toBe('5')
    expect(stepQuantity('998', 1)).toBe('999')
    expect(stepQuantity('999', 1)).toBe('999')
  })

  it('knows when the buttons apply', () => {
    expect(canDecrease('1')).toBe(false)
    expect(canDecrease('1.5')).toBe(true)
    expect(canIncrease('5', '5.000')).toBe(false)
    expect(canIncrease('4', '5.000')).toBe(true)
    expect(canIncrease('999', null)).toBe(false)
    expect(effectiveMax(null)).toBe('999')
    expect(effectiveMax('2000.000')).toBe('999')
    expect(effectiveMax('3.500')).toBe('3.5')
    expect(displayQuantity('2.000')).toBe('2')
  })

  it('turns the cart error codes into messages and reads the stock hint', () => {
    const insufficient = new ApiError(422, 'INSUFFICIENT_STOCK', 'Not enough stock', { max_quantity: '3.000' })
    expect(maxQuantityHint(insufficient)).toBe('3')
    expect(cartErrorMessage(insufficient)).toBe('Only 3 available.')
    expect(maxQuantityHint(new ApiError(422, 'OUT_OF_STOCK', 'x'))).toBeNull()
    expect(cartErrorMessage(new ApiError(422, 'OUT_OF_STOCK', 'x'))).toBe('Sorry, this item is out of stock.')
    expect(cartErrorMessage(new ApiError(422, 'VARIANT_NOT_PURCHASABLE', 'x'))).toBe('This product is not available any more.')
    expect(cartErrorMessage(new ApiError(422, 'CART_FULL', 'x'))).toBe('Your cart is full. Remove an item to add another.')
    expect(cartErrorMessage(new ApiError(422, 'VALIDATION_FAILED', 'x', { quantity: ['The quantity must be a whole number.'] }))).toBe('The quantity must be a whole number.')
    expect(cartErrorMessage(new ApiError(429, 'TOO_MANY_REQUESTS', 'x'))).toBe('Too many requests. Please wait a moment and try again.')
    expect(cartErrorMessage(new Error('boom'))).toBe('Something went wrong. Please try again.')
  })
})
