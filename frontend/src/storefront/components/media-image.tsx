import type { ComponentProps } from 'react'
import type { MediaRef } from '../types'

type MediaImageProps = Omit<ComponentProps<'img'>, 'src' | 'srcSet' | 'width' | 'height' | 'alt'> & {
  media: MediaRef
  /** Fallback when the image has no alt text; pass "" for purely decorative images. */
  alt?: string
}

/** A library image with its WebP renditions and intrinsic size (no layout shift). */
export function MediaImage({ media, alt, sizes = '100vw', loading = 'lazy', ...props }: MediaImageProps) {
  return (
    <img
      src={media.url}
      srcSet={media.srcset}
      sizes={sizes}
      width={media.width}
      height={media.height}
      alt={media.alt ?? alt ?? ''}
      loading={loading}
      decoding="async"
      {...props}
    />
  )
}
