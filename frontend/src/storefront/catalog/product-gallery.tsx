import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, ZoomInIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { ProductDetail } from '../types'
import { ProductImage } from './product-image'

type GalleryImage = ProductDetail['images'][number]

/**
 * Product images: the main image with thumbnails underneath. On devices with a fine pointer
 * the main image zooms under the cursor; clicking it (or Enter) opens a full-screen
 * lightbox with arrow-key navigation. `index` is controlled so a variant can show its image.
 */
export function ProductGallery({
  images,
  name,
  index,
  onIndexChange,
  zoom = true,
}: {
  images: GalleryImage[]
  name: string
  index: number
  onIndexChange: (index: number) => void
  /** Hover zoom and lightbox (off in quick view). */
  zoom?: boolean
}) {
  const [origin, setOrigin] = useState('50% 50%')
  const [lightbox, setLightbox] = useState(false)
  const count = images.length
  const current = images[Math.min(index, count - 1)] ?? null
  const go = (next: number) => onIndexChange((next + count) % count)

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse') return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    setOrigin(`${((event.clientX - rect.left) / rect.width) * 100}% ${((event.clientY - rect.top) / rect.height) * 100}%`)
  }

  const label = (i: number) => `${name}, image ${i + 1} of ${count}`

  return (
    <div className="flex flex-col gap-3" data-testid="product-gallery">
      <div className="relative">
        {zoom && current ? (
          <button
            type="button"
            className="group relative block w-full cursor-zoom-in overflow-hidden rounded-sf-card border bg-sf-surface"
            onClick={() => setLightbox(true)}
            onPointerMove={onPointerMove}
            aria-label={`Open ${label(index)} full screen`}
          >
            <ProductImage
              image={current}
              alt={label(index)}
              eager
              imgClassName="transition-transform duration-200 group-hover:scale-200 motion-reduce:transition-none"
              imgStyle={{ transformOrigin: origin }}
              key={current.id}
            />
            <span aria-hidden className="absolute right-3 bottom-3 grid size-9 place-items-center rounded-full bg-sf-surface/90 text-sf-heading shadow">
              <ZoomInIcon className="size-4" />
            </span>
          </button>
        ) : (
          <ProductImage image={current} alt={current ? label(index) : name} eager className="rounded-sf-card border" />
        )}

        {count > 1 && (
          <>
            <button type="button" onClick={() => go(index - 1)} aria-label="Previous image" className="absolute top-1/2 left-2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-sf-surface/90 text-sf-heading shadow md:hidden">
              <ChevronLeftIcon aria-hidden className="size-5" />
            </button>
            <button type="button" onClick={() => go(index + 1)} aria-label="Next image" className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-sf-surface/90 text-sf-heading shadow md:hidden">
              <ChevronRightIcon aria-hidden className="size-5" />
            </button>
          </>
        )}
      </div>

      {count > 1 && (
        <ul className="grid grid-cols-5 gap-2" aria-label="Product images">
          {images.map((image, i) => (
            <li key={image.id}>
              <button
                type="button"
                onClick={() => onIndexChange(i)}
                aria-label={`Show image ${i + 1} of ${count}`}
                aria-current={i === index ? 'true' : undefined}
                className={cn('block w-full overflow-hidden rounded-lg border-2 transition', i === index ? 'border-sf-accent' : 'border-transparent hover:border-sf-border')}
              >
                <ProductImage image={image} alt="" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {zoom && current && (
        <Lightbox open={lightbox} onOpenChange={setLightbox} images={images} index={index} onIndexChange={onIndexChange} label={label} />
      )}
    </div>
  )
}

function Lightbox({
  open,
  onOpenChange,
  images,
  index,
  onIndexChange,
  label,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  images: GalleryImage[]
  index: number
  onIndexChange: (index: number) => void
  label: (i: number) => string
}) {
  const count = images.length
  const image = images[index]
  const go = (next: number) => onIndexChange((next + count) % count)

  const onKeyDown = (event: KeyboardEvent) => {
    if (count < 2) return
    if (event.key === 'ArrowRight') go(index + 1)
    else if (event.key === 'ArrowLeft') go(index - 1)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[100dvh] max-h-none w-screen max-w-none flex-col items-center justify-center gap-3 rounded-none border-0 bg-black/95 p-4 text-white ring-0 sm:max-w-none [&>[data-slot=dialog-close]]:text-white [&>[data-slot=dialog-close]]:hover:bg-white/20"
        onKeyDown={onKeyDown}
      >
        <DialogTitle className="sr-only">{label(index)}</DialogTitle>
        <DialogDescription className="sr-only">Use the arrow keys to see the other images.</DialogDescription>
        {image && <img src={image.url} alt={image.alt || label(index)} className="max-h-[85dvh] max-w-full object-contain" />}
        {count > 1 && (
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => go(index - 1)} aria-label="Previous image" className="grid size-11 place-items-center rounded-full bg-white/15 hover:bg-white/30">
              <ChevronLeftIcon aria-hidden className="size-6" />
            </button>
            <p aria-live="polite" className="text-sm tabular-nums">
              {index + 1} / {count}
            </p>
            <button type="button" onClick={() => go(index + 1)} aria-label="Next image" className="grid size-11 place-items-center rounded-full bg-white/15 hover:bg-white/30">
              <ChevronRightIcon aria-hidden className="size-6" />
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
