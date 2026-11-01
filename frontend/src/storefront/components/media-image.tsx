import type { ComponentProps } from 'react'
import type { MediaRef } from '../types'

type MediaImageProps = Omit<ComponentProps<'img'>, 'src' | 'srcSet' | 'width' | 'height' | 'alt' | 'fetchPriority'> & {
  media: MediaRef
  /** Fallback when the image has no alt text; pass "" for purely decorative images. */
  alt?: string
  /** The page's largest above-the-fold image (LCP): loaded eagerly at high priority. Everything else is lazy unless `loading` says otherwise (e.g. the logo). */
  priority?: boolean
}

/**
 * A library image with its WebP renditions (`sizes` tells the browser which one fits — pass the
 * rendered width), intrinsic size (no layout shift), async decoding and lazy loading unless `priority`.
 */
export function MediaImage({ media, alt, sizes = '100vw', priority = false, loading, ...props }: MediaImageProps) {
  return (
    <img
      src={media.url}
      srcSet={media.srcset}
      sizes={sizes}
      width={media.width}
      height={media.height}
      alt={media.alt ?? alt ?? ''}
      loading={priority ? 'eager' : (loading ?? 'lazy')}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      {...props}
    />
  )
}
