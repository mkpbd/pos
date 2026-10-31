import type { ProductOption, ProductVariant } from '../types'

/**
 * Variant selection on the product page and in quick view (pure, unit-tested).
 *
 * A selection maps option name → value. Options are resolved in order: a value of a later
 * option is unavailable when no variant combines it with the values chosen for the options
 * before it. The first option is never disabled, so every variant stays reachable however
 * sparse the variant matrix is; choosing a value moves the later options to the closest
 * existing variant.
 */
export type Selection = Record<string, string>

type Product = { options: ProductOption[]; variants: ProductVariant[]; default_variant_id: string | null }

function selectionOf(variant: ProductVariant, options: ProductOption[]): Selection {
  const selection: Selection = {}
  for (const option of options) {
    const value = variant.option_values[option.name]
    if (value !== undefined) selection[option.name] = value
  }
  return selection
}

/** The variant matching every option of the selection; the only variant of a product without options. */
export function variantFor(product: Pick<Product, 'options' | 'variants'>, selection: Selection): ProductVariant | null {
  if (product.options.length === 0) return product.variants[0] ?? null
  return product.variants.find((v) => product.options.every((o) => selection[o.name] !== undefined && v.option_values[o.name] === selection[o.name])) ?? null
}

/** The variant to start with: the one from the URL, else the default variant, else the first. */
export function initialVariant(product: Product, variantId?: string | null): ProductVariant | null {
  return (
    (variantId ? product.variants.find((v) => v.id === variantId) : undefined) ??
    product.variants.find((v) => v.id === product.default_variant_id) ??
    product.variants[0] ??
    null
  )
}

/** The selection of the initial variant. */
export function initialSelection(product: Product, variantId?: string | null): Selection {
  const variant = initialVariant(product, variantId)
  return variant ? selectionOf(variant, product.options) : {}
}

/** Can `value` of the option at `optionIndex` be combined with the values chosen for the options before it? */
export function isValueAvailable(product: Pick<Product, 'options' | 'variants'>, selection: Selection, optionIndex: number, value: string): boolean {
  const option = product.options[optionIndex]
  if (!option) return false
  const earlier = product.options.slice(0, optionIndex)
  return product.variants.some((v) => v.option_values[option.name] === value && earlier.every((o) => selection[o.name] === undefined || v.option_values[o.name] === selection[o.name]))
}

/**
 * The selection after choosing `value` for `optionName`. When that exact combination does
 * not exist, the closest variant with the value is taken: most other values kept (earlier
 * options weigh more), in stock before out of stock, then catalog order.
 */
export function chooseValue(product: Pick<Product, 'options' | 'variants'>, selection: Selection, optionName: string, value: string): Selection {
  const next = { ...selection, [optionName]: value }
  if (variantFor(product, next)) return next

  const candidates = product.variants.filter((v) => v.option_values[optionName] === value)
  if (candidates.length === 0) return selection

  const score = (v: ProductVariant) =>
    product.options.reduce((sum, o, i) => sum + (o.name !== optionName && v.option_values[o.name] === selection[o.name] ? 2 ** (product.options.length - i) : 0), 0) * 2 +
    (v.in_stock ? 1 : 0)
  const best = candidates.reduce((winner, v) => (score(v) > score(winner) ? v : winner))
  return selectionOf(best, product.options)
}

/** How a value shows in the selector: not combinable (disabled), sold out (selectable, marked) or available. */
export function valueStatus(product: Pick<Product, 'options' | 'variants'>, selection: Selection, optionIndex: number, value: string): 'unavailable' | 'sold_out' | 'available' {
  const option = product.options[optionIndex]
  if (!option || !isValueAvailable(product, selection, optionIndex, value)) return 'unavailable'
  const variant = variantFor(product, chooseValue(product, selection, option.name, value))
  return variant && !variant.in_stock ? 'sold_out' : 'available'
}
