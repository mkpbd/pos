import { describe, expect, it } from 'vitest'
import { productDetail } from '../test-fixtures'
import { chooseValue, initialSelection, initialVariant, isValueAvailable, valueStatus, variantFor } from './variant-selection'

// Colour × Size: Red/M (default), Red/L (out of stock), Blue/L only.
const product = productDetail()

describe('variant selection', () => {
  it('starts with the variant from the URL, else the default, else the first', () => {
    expect(initialSelection(product, 'v-blue-l')).toEqual({ Colour: 'Blue', Size: 'L' })
    expect(initialSelection(product, 'unknown')).toEqual({ Colour: 'Red', Size: 'M' })
    expect(initialVariant({ ...product, default_variant_id: null })?.id).toBe('v-red-m')
    expect(initialSelection({ ...product, variants: [] })).toEqual({})
  })

  it('finds the variant of a complete selection only', () => {
    expect(variantFor(product, { Colour: 'Blue', Size: 'L' })?.id).toBe('v-blue-l')
    expect(variantFor(product, { Colour: 'Blue', Size: 'M' })).toBeNull()
    expect(variantFor(product, { Colour: 'Red' })).toBeNull()
  })

  it('treats a product without options as its single variant', () => {
    const simple = productDetail({ options: [], variants: [product.variants[0]!] })
    expect(variantFor(simple, {})?.id).toBe('v-red-m')
  })

  it('disables values of later options that do not combine with earlier choices', () => {
    const blue = { Colour: 'Blue', Size: 'L' }
    expect(isValueAvailable(product, blue, 1, 'M')).toBe(false)
    expect(isValueAvailable(product, blue, 1, 'L')).toBe(true)
    // The first option is never disabled, so every variant stays reachable.
    expect(isValueAvailable(product, { Colour: 'Red', Size: 'M' }, 0, 'Blue')).toBe(true)
    expect(isValueAvailable(product, blue, 5, 'L')).toBe(false)
  })

  it('moves to the closest existing variant when a combination does not exist', () => {
    // Red/M → Blue: Blue/M does not exist, Blue/L does.
    expect(chooseValue(product, { Colour: 'Red', Size: 'M' }, 'Colour', 'Blue')).toEqual({ Colour: 'Blue', Size: 'L' })
    // Existing combination: taken as is, even when out of stock.
    expect(chooseValue(product, { Colour: 'Red', Size: 'M' }, 'Size', 'L')).toEqual({ Colour: 'Red', Size: 'L' })
    // Unknown value: nothing changes.
    expect(chooseValue(product, { Colour: 'Red', Size: 'M' }, 'Size', 'XL')).toEqual({ Colour: 'Red', Size: 'M' })
  })

  it('prefers in-stock variants and keeps earlier options when jumping', () => {
    const p = productDetail({
      variants: [
        { ...product.variants[0]!, id: 'a', option_values: { Colour: 'Red', Size: 'M' } },
        { ...product.variants[0]!, id: 'b', option_values: { Colour: 'Blue', Size: 'S' }, in_stock: false },
        { ...product.variants[0]!, id: 'c', option_values: { Colour: 'Blue', Size: 'L' }, in_stock: true },
      ],
    })
    expect(chooseValue(p, { Colour: 'Red', Size: 'M' }, 'Colour', 'Blue')).toEqual({ Colour: 'Blue', Size: 'L' })
  })

  it('reports how each value shows', () => {
    const redM = { Colour: 'Red', Size: 'M' }
    expect(valueStatus(product, redM, 1, 'L')).toBe('sold_out')
    expect(valueStatus(product, redM, 1, 'M')).toBe('available')
    expect(valueStatus(product, { Colour: 'Blue', Size: 'L' }, 1, 'M')).toBe('unavailable')
    expect(valueStatus(product, redM, 0, 'Blue')).toBe('available')
  })
})
