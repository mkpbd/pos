import { useState } from 'react'
import type { ProductDetail, ProductVariant } from '../types'
import { chooseValue, initialSelection, variantFor, type Selection } from './variant-selection'

/** Position of a variant's image in the gallery, -1 when it has none. */
export function imageIndexOf(product: Pick<ProductDetail, 'images'>, imageId: string | null | undefined): number {
  return imageId ? product.images.findIndex((image) => image.id === imageId) : -1
}

/** Selection state for a product; `onChange` hears the new variant (the product page puts it in the URL). */
export function useVariantSelection(product: ProductDetail, variantId: string | null | undefined, onChange?: (variant: ProductVariant | null) => void) {
  const [selection, setSelection] = useState<Selection>(() => initialSelection(product, variantId))
  const variant = variantFor(product, selection)

  const choose = (optionName: string, value: string) => {
    const next = chooseValue(product, selection, optionName, value)
    setSelection(next)
    onChange?.(variantFor(product, next))
  }

  return { selection, variant, choose }
}
