import type { CSSProperties } from 'react'
import { ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CatalogImage } from '../types'

/**
 * A catalog image in a fixed-ratio box (product images carry no intrinsic size, so the box
 * reserves the space and nothing shifts while they load). Lazy unless `eager`.
 */
export function ProductImage({
  image,
  alt,
  eager = false,
  fit = 'contain',
  className,
  imgClassName,
  imgStyle,
}: {
  image: CatalogImage | null
  /** Used when the image has no alt text of its own. */
  alt: string
  eager?: boolean
  fit?: 'contain' | 'cover'
  className?: string
  imgClassName?: string
  imgStyle?: CSSProperties
}) {
  return (
    <div className={cn('relative aspect-square overflow-hidden bg-sf-surface', className)}>
      {image ? (
        <img
          src={image.url}
          alt={image.alt || alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          width={600}
          height={600}
          style={imgStyle}
          className={cn('absolute inset-0 size-full', fit === 'contain' ? 'object-contain' : 'object-cover', imgClassName)}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-sf-canvas text-sf-border" role="img" aria-label={`${alt} (no image)`}>
          <ImageIcon aria-hidden className="size-1/4" />
        </div>
      )}
    </div>
  )
}
