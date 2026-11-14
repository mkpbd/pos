import { useState } from 'react'
import type { ProductDetail, ProductVariant } from '../types'
import { galleryImagesFor, photoValueOf } from './option-photos'
import { galleryVideoOf } from './product-video'
import { chooseValue, initialSelection, variantFor, type Selection } from './variant-selection'

/** Position of a variant's image in the gallery, -1 when it has none. */
export function imageIndexOf(product: Pick<ProductDetail, 'images'>, imageId: string | null | undefined): number {
  return imageId ? product.images.findIndex((image) => image.id === imageId) : -1
}

/**
 * Selection state for a product; `onChange` hears the new variant (the product page puts it in the
 * URL). `choose` returns the new variant and selection (the gallery follows them).
 */
export function useVariantSelection(product: ProductDetail, variantId: string | null | undefined, onChange?: (variant: ProductVariant | null) => void) {
  const [selection, setSelection] = useState<Selection>(() => initialSelection(product, variantId))
  const variant = variantFor(product, selection)

  const choose = (optionName: string, value: string) => {
    const next = chooseValue(product, selection, optionName, value)
    const nextVariant = variantFor(product, next)
    setSelection(next)
    onChange?.(nextVariant)
    return { variant: nextVariant, selection: next }
  }

  return { selection, variant, choose }
}

/** The gallery's state for one value of the photo option: the image shown (by id, or the video) and "All photos". */
type GalleryState = { value: string | undefined; imageId: string | null; all: boolean }

/** P1b: `imageId` of the video slide (after the images). */
const VIDEO_SLIDE = '#video'

/**
 * The gallery of the product page and quick view (P1a). Choosing a value of the photo option shows
 * that value's photos (and the variant's own photo first when it has one among them); "All photos"
 * keeps every image reachable. Products without a photo option show every image, as before.
 * P1b: a product video is one more slide after the images (`index === images.length`); it stays
 * shown while the shopper changes options that keep the photos, until a variant brings its own photo.
 * Call `follow` when the variant changes.
 */
export function useProductGallery(product: ProductDetail, selection: Selection, variant: ProductVariant | null) {
  const photoValue = photoValueOf(product, selection)
  const [state, setState] = useState<GalleryState>(() => ({ value: photoValue, imageId: variant?.image_id ?? null, all: false }))
  const current: GalleryState = state.value === photoValue ? state : { value: photoValue, imageId: variant?.image_id ?? null, all: false }
  const { images, filtered } = galleryImagesFor(product, selection, current.all)
  const video = galleryVideoOf(product)
  const index =
    current.imageId === VIDEO_SLIDE && video ? images.length : Math.max(0, current.imageId ? images.findIndex((image) => image.id === current.imageId) : -1)
  // "All photos" is offered while the value's photos are a subset, and "back" while showing all of them.
  const canToggle = filtered || (current.all && galleryImagesFor(product, selection, false).filtered)

  return {
    images,
    index,
    video,
    all: current.all,
    photoValue,
    canToggle,
    setIndex: (i: number) => setState({ ...current, imageId: video && i === images.length ? VIDEO_SLIDE : (images[i]?.id ?? null) }),
    /** Show every image (true) or the chosen value's photos (false), keeping the image (or the video) shown when it is in both. */
    showAll: (all: boolean) => setState({ ...current, all, imageId: current.imageId === VIDEO_SLIDE ? VIDEO_SLIDE : (images[index]?.id ?? null) }),
    /** A new variant: a new photo value starts on its photos; the variant's own photo is shown when it has one. */
    follow: (next: ProductVariant | null, nextSelection: Selection) => {
      const value = photoValueOf(product, nextSelection)
      const own = next?.image_id && product.images.some((image) => image.id === next.image_id) ? next.image_id : null
      setState((prev) => {
        const same = prev.value === value
        return { value, imageId: own ?? (same ? prev.imageId : null), all: same ? prev.all : false }
      })
    },
  }
}

/** The gallery's "All photos" toggle props, null when the chosen value's photos are all there is. */
export function galleryPhotos(product: Pick<ProductDetail, 'images'>, gallery: ReturnType<typeof useProductGallery>) {
  if (!gallery.canToggle || gallery.photoValue === undefined) return null
  return { all: gallery.all, value: gallery.photoValue, total: product.images.length, onShowAll: gallery.showAll }
}
