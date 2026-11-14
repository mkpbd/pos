import type { CatalogImage, ProductDetail, ProductOption, ProductOptionValue } from '../types'
import type { Selection } from './variant-selection'

/**
 * P1a photos per colour (pure, unit-tested). One option of a product — the "photo option", e.g.
 * Colour — may own photos: each of its values lists image ids from the product's images. While a
 * value with photos is chosen the gallery shows only those (in their order); "All photos" shows every
 * image. Products without a photo option, and values without photos, show every image as before.
 */

type Product = Pick<ProductDetail, 'images' | 'options' | 'photo_option'>
export type GalleryImage = ProductDetail['images'][number]

/** The photo option's value in a selection, undefined when the product has none or it is not chosen. */
export function photoValueOf(product: Pick<Product, 'photo_option'>, selection: Selection): string | undefined {
  return product.photo_option ? selection[product.photo_option] : undefined
}

function optionValue(product: Product, value: string | undefined): ProductOptionValue | undefined {
  if (!product.photo_option || value === undefined) return undefined
  return product.options.find((o) => o.name === product.photo_option)?.values.find((v) => v.value === value)
}

/** The value's own photos, in its order (ids the product does not have are skipped). */
export function photosOf(product: Product, value: string | undefined): GalleryImage[] {
  const ids = optionValue(product, value)?.image_ids ?? []
  const byId = new Map(product.images.map((image) => [image.id, image]))
  return ids.flatMap((id) => {
    const image = byId.get(id)
    return image ? [image] : []
  })
}

/** What the gallery shows: the chosen value's photos, or every image (`all`, or when the value has none). `filtered`: fewer than all. */
export function galleryImagesFor(product: Product, selection: Selection, all: boolean): { images: GalleryImage[]; filtered: boolean } {
  const own = all ? [] : photosOf(product, photoValueOf(product, selection))
  if (own.length === 0) return { images: product.images, filtered: false }
  return { images: own, filtered: own.length < product.images.length }
}

/** The chip photo of an option value: its own `image`, else its first photo. */
export function chipImageOf(product: Pick<ProductDetail, 'images'>, value: ProductOptionValue): CatalogImage | null {
  if (value.image) return { url: value.image.url, alt: value.image.alt }
  const first = value.image_ids?.[0]
  return (first && product.images.find((image) => image.id === first)) || null
}

const SIZE_NAME = /size|সাইজ|মাপ/i

/** The option the size guide sits next to: the first whose slug or name says "size"; -1 when none. */
export function sizeOptionIndex(options: Pick<ProductOption, 'name' | 'slug'>[]): number {
  return options.findIndex((o) => SIZE_NAME.test(o.slug ?? '') || SIZE_NAME.test(o.name))
}
