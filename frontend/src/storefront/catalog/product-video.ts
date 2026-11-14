import { videoEmbedUrl } from '../builder/validate'
import type { CatalogImage, ProductDetail, ProductVideo } from '../types'

/** What the gallery needs for the video slide: the video and its poster (the product's first image). */
export type GalleryVideo = { video: ProductVideo; poster: CatalogImage | null; src: string }

export const PROVIDER_NAMES = { youtube: 'YouTube', vimeo: 'Vimeo' } as const

/**
 * The product's video as a gallery slide (P1b), or null without one or when it cannot be embedded.
 * The player URL is the privacy-enhanced one built from provider + id (youtube-nocookie, Vimeo
 * `dnt=1`); it is only loaded once the shopper presses play.
 */
export function galleryVideoOf(product: Pick<ProductDetail, 'video' | 'images'>): GalleryVideo | null {
  const video = product.video
  if (!video || (video.provider !== 'youtube' && video.provider !== 'vimeo')) return null
  const src = videoEmbedUrl(video.provider, video.id)
  return src ? { video, poster: product.images[0] ?? null, src } : null
}
