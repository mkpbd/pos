import { lazy, Suspense, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, ImagesIcon, PlayIcon, ZoomInIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import type { GalleryImage } from './option-photos'
import { ProductImage } from './product-image'
import type { GalleryVideo } from './product-video'
import { ProductVideoPlayer } from './product-video-player'

// The full-screen viewer is only fetched when a shopper first opens it.
const Lightbox = lazy(() => import('./product-lightbox').then((m) => ({ default: m.ProductLightbox })))

/**
 * Product images: the main image with thumbnails underneath — or, with `thumbnails="side"` (P1b),
 * in a strip on its left from 768 px (still underneath on phones). On devices with a fine pointer
 * the main image zooms under the cursor; clicking it (or Enter) opens a full-screen lightbox with
 * arrow-key navigation and zoom. On touch screens a sideways swipe changes the image. `index` is
 * controlled so a variant can show its image; P1b: the product video is the last slide
 * (`index === images.length`), its thumbnail the poster with a play mark. `overlay` (the badges)
 * sits on the main image's top-left corner.
 */
export function ProductGallery({
  images,
  name,
  index,
  onIndexChange,
  zoom = true,
  photos,
  video = null,
  thumbnails = 'bottom',
  overlay,
}: {
  images: GalleryImage[]
  name: string
  index: number
  onIndexChange: (index: number) => void
  /** Hover zoom and lightbox (off in quick view). */
  zoom?: boolean
  /** P1a: the chosen colour's photos are shown — offer "All photos" (or back to the colour's photos). */
  photos?: { all: boolean; value: string; total: number; onShowAll: (all: boolean) => void } | null
  /** P1b: the product video, shown as the last slide. */
  video?: GalleryVideo | null
  /** P1b: the theme's thumbnail position. */
  thumbnails?: 'bottom' | 'side'
  overlay?: ReactNode
}) {
  const { t } = useLocale()
  const [origin, setOrigin] = useState('50% 50%')
  const [lightbox, setLightbox] = useState(false)
  // Mounted from the first opening on, so closing keeps its exit animation.
  const [lightboxLoaded, setLightboxLoaded] = useState(false)
  const imageCount = images.length
  const count = imageCount + (video ? 1 : 0)
  const showsVideo = video !== null && index >= imageCount
  const current = showsVideo ? null : (images[Math.min(index, imageCount - 1)] ?? null)
  const go = (next: number) => onIndexChange((next + count) % count)
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null)
  const swiped = useRef(false)
  const side = thumbnails === 'side'

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse') return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    setOrigin(`${((event.clientX - rect.left) / rect.width) * 100}% ${((event.clientY - rect.top) / rect.height) * 100}%`)
  }

  // Touch swipes on the main image step through the slides; the tap that ends a swipe opens nothing.
  const onSwipeStart = (event: PointerEvent<HTMLDivElement>) => {
    swiped.current = false
    swipe.current = event.pointerType === 'mouse' || count < 2 ? null : { x: event.clientX, y: event.clientY, id: event.pointerId }
  }
  const onSwipeEnd = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current
    swipe.current = null
    if (!start || start.id !== event.pointerId) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return
    swiped.current = true
    go(index + (dx < 0 ? 1 : -1))
  }
  const onClickCapture = (event: MouseEvent) => {
    if (!swiped.current) return
    swiped.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  const label = (i: number) => t('catalog.gallery.imageLabel', { name, index: i + 1, count: imageCount })

  const thumbs = count > 1 && (
    <ul
      className={cn('grid grid-cols-5 gap-2', side && 'md:absolute md:inset-0 md:flex md:flex-col md:overflow-y-auto md:pr-1 md:[scrollbar-width:thin]')}
      aria-label={t('catalog.gallery.images')}
    >
      {images.map((image, i) => (
        <li key={image.id} className={cn(side && 'md:shrink-0')}>
          <button
            type="button"
            onClick={() => onIndexChange(i)}
            aria-label={t('catalog.gallery.showImage', { index: i + 1, count: imageCount })}
            aria-current={i === index ? 'true' : undefined}
            className={cn('block w-full overflow-hidden rounded-lg border-2 transition', i === index ? 'border-sf-accent' : 'border-transparent hover:border-sf-border')}
          >
            <ProductImage image={image} alt="" />
          </button>
        </li>
      ))}
      {video && (
        <li className={cn(side && 'md:shrink-0')}>
          <button
            type="button"
            onClick={() => onIndexChange(imageCount)}
            aria-label={t('catalog.gallery.showVideo')}
            aria-current={showsVideo ? 'true' : undefined}
            className={cn('relative block w-full overflow-hidden rounded-lg border-2 bg-neutral-900 bg-clip-padding transition', showsVideo ? 'border-sf-accent' : 'border-transparent hover:border-sf-border')}
            data-testid="video-thumbnail"
          >
            {video.poster ? <ProductImage image={video.poster} alt="" className="opacity-70" /> : <span className="block aspect-square" />}
            <span aria-hidden className="absolute inset-0 grid place-items-center">
              <span className="grid size-8 place-items-center rounded-full bg-white/95 text-neutral-900 shadow">
                <PlayIcon className="ml-0.5 size-4 fill-current" />
              </span>
            </span>
          </button>
        </li>
      )}
    </ul>
  )

  return (
    <div className="flex flex-col gap-3" data-testid="product-gallery" data-thumbnails={thumbnails}>
      <div className={cn('flex flex-col gap-3', side && 'md:flex-row-reverse md:items-start')}>
        <div className="relative min-w-0 flex-1 [touch-action:pan-y_pinch-zoom]" onPointerDown={onSwipeStart} onPointerUp={onSwipeEnd} onPointerCancel={() => (swipe.current = null)} onClickCapture={onClickCapture}>
          {showsVideo && video ? (
            <ProductVideoPlayer key={video.src} video={video} name={name} className="rounded-sf-card border" />
          ) : zoom && current ? (
            <button
              type="button"
              className="group relative block w-full cursor-zoom-in overflow-hidden rounded-sf-card border bg-sf-surface"
              onClick={() => {
                setLightboxLoaded(true)
                setLightbox(true)
              }}
              onPointerMove={onPointerMove}
              aria-label={t('catalog.gallery.openFullScreen', { image: label(index) })}
            >
              <ProductImage
                image={current}
                alt={label(index)}
                priority
                imgClassName="transition-transform duration-200 group-hover:scale-200 motion-reduce:transition-none"
                imgStyle={{ transformOrigin: origin }}
                key={current.id}
              />
              <span aria-hidden className="absolute right-3 bottom-3 grid size-9 place-items-center rounded-full bg-sf-surface/90 text-sf-heading shadow">
                <ZoomInIcon className="size-4" />
              </span>
            </button>
          ) : (
            <ProductImage image={current} alt={current ? label(index) : name} priority className="rounded-sf-card border" />
          )}

          {overlay}

          {count > 1 && (
            <>
              <button type="button" onClick={() => go(index - 1)} aria-label={t('catalog.gallery.previousImage')} className="absolute top-1/2 left-2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-sf-surface/90 text-sf-heading shadow md:hidden">
                <ChevronLeftIcon aria-hidden className="size-5" />
              </button>
              <button type="button" onClick={() => go(index + 1)} aria-label={t('catalog.gallery.nextImage')} className="absolute top-1/2 right-2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-sf-surface/90 text-sf-heading shadow md:hidden">
                <ChevronRightIcon aria-hidden className="size-5" />
              </button>
            </>
          )}
        </div>

        {thumbs && (side ? <div className="md:relative md:w-20 md:shrink-0 md:self-stretch lg:w-24">{thumbs}</div> : thumbs)}
      </div>

      {photos && (
        <button
          type="button"
          onClick={() => photos.onShowAll(!photos.all)}
          className="inline-flex min-h-11 items-center gap-2 self-start rounded-sf-button px-1 text-sm font-semibold text-sf-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-sf-accent"
          data-testid="gallery-photo-toggle"
        >
          <ImagesIcon aria-hidden className="size-4" />
          {photos.all ? t('catalog.gallery.valuePhotos', { value: photos.value }) : t('catalog.gallery.allPhotos', { count: photos.total })}
        </button>
      )}

      {zoom && imageCount > 0 && lightboxLoaded && (
        <Suspense fallback={null}>
          <Lightbox open={lightbox} onOpenChange={setLightbox} images={images} index={index} onIndexChange={onIndexChange} label={label} video={video} name={name} />
        </Suspense>
      )}
    </div>
  )
}
