import { useState } from 'react'
import type { ProductCard as Card } from '../types'

/**
 * P1a: a card's colour chips and the image they show. Hovering or focusing a chip with a photo
 * previews it in the card's image; clicking keeps it (pressed). `image` is what the card draws,
 * `swapped` whether that is a chip's photo (the card then skips its own hover image).
 */
export function useCardSwatches(product: Card) {
  const [hover, setHover] = useState<number | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const values = product.swatches?.values ?? []
  const active = hover ?? picked
  const photo = active !== null ? (values[active]?.image ?? null) : null
  return { image: photo ?? product.image, swapped: photo !== null, row: { product, hover, picked, setHover, setPicked } }
}

export type CardSwatchState = ReturnType<typeof useCardSwatches>
