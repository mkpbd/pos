import type { AttributeDisplay } from '@/features/catalog/api'
import type { OptionImagesInput, OptionStyle, Product } from '@/features/products/api'

/** Photos per value of the photo option (server limit). */
export const MAX_PHOTOS_PER_VALUE = 8

export const STYLE_LABELS: Record<OptionStyle, string> = {
  color: 'Colour circles',
  image: 'Photo chips',
  button: 'Buttons',
}

/** What shoppers see when no style is chosen: the attribute's display (swatch → circles). */
export function defaultStyleLabel(display: AttributeDisplay | undefined): string {
  if (display === 'swatch') return STYLE_LABELS.color
  if (display === 'button') return STYLE_LABELS.button
  return 'Text list'
}

export type OptionPhotosState = {
  photoOption: string | null
  /** '' = automatic (no explicit style). */
  styles: Record<string, OptionStyle | ''>
  photos: Record<string, string[]>
}

export function toOptionPhotosState(product: Product): OptionPhotosState {
  const options = product.options ?? []
  const imageIds = new Set(product.images.map((i) => i.id))
  const photoOption = product.photo_option && options.some((o) => o.name === product.photo_option) ? product.photo_option : null
  const values = options.find((o) => o.name === photoOption)?.values ?? []
  return {
    photoOption,
    styles: Object.fromEntries(options.map((o) => [o.name, product.option_styles?.[o.name] ?? ''])),
    photos: Object.fromEntries(values.map((v) => [v, (product.option_images?.[v] ?? []).filter((id) => imageIds.has(id))])),
  }
}

/** Toggles a photo for a value: removes it when present, else appends (up to the limit). */
export function togglePhoto(list: string[], imageId: string): string[] {
  if (list.includes(imageId)) return list.filter((id) => id !== imageId)
  return list.length >= MAX_PHOTOS_PER_VALUE ? list : [...list, imageId]
}

export function movePhoto(list: string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta
  if (target < 0 || target >= list.length) return list
  const next = [...list]
  ;[next[index], next[target]] = [next[target] as string, next[index] as string]
  return next
}

/**
 * The PUT /products/{id}/option-images body: styles for every option (null = automatic, which
 * removes an explicit style) and, with a photo option, every one of its values in option order.
 */
export function toOptionImagesInput(state: OptionPhotosState, product: Product): OptionImagesInput {
  const options = product.options ?? []
  const values = options.find((o) => o.name === state.photoOption)?.values ?? []
  return {
    photo_option: state.photoOption,
    styles: Object.fromEntries(options.map((o) => [o.name, state.styles[o.name] || null])),
    values: state.photoOption ? values.map((value) => ({ value, image_ids: state.photos[value] ?? [] })) : [],
  }
}
