import { cn } from '@/lib/utils'
import { withFocal } from '../../focal'
import type { BuilderMedia } from '../types'

/** A library image with exactly this alt text (decorative when ""); B11: cropped around its focal point. */
export function BuilderImg({
  media,
  alt,
  sizes,
  className,
  eager = false,
  priority = false,
}: {
  media: BuilderMedia
  alt: string
  sizes: string
  className?: string
  eager?: boolean
  /** B15: the page's first above-the-fold picture: eager and fetched at high priority. */
  priority?: boolean
}) {
  return (
    <img
      src={media.url}
      srcSet={media.srcset || undefined}
      sizes={sizes}
      width={media.width}
      height={media.height}
      alt={alt}
      loading={eager || priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      draggable={false}
      className={cn('block', className)}
      style={withFocal(media)}
    />
  )
}
