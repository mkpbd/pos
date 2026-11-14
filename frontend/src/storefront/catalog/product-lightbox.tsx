import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type PointerEvent, type Ref, type RefObject } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, RotateCcwIcon, XIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import type { GalleryImage } from './option-photos'
import type { GalleryVideo } from './product-video'
import { ProductVideoPlayer } from './product-video-player'
import { IDENTITY, MAX_ZOOM, panView, pinchView, toggleZoom, wheelFactor, ZOOM_STEP, zoomAt, zoomCentre, type ZoomBox, type ZoomView } from './zoom'

/**
 * The gallery's full-screen viewer (loaded on demand): one photo at a time — or the product video,
 * the last slide (P1b) — with arrow keys and swipes to step through them. P1b zoom: pinch and
 * double-tap on touch screens, the wheel, + / − keys, the zoom buttons and double-click with a
 * mouse, dragging a zoomed photo to move it; every slide starts unzoomed. Reduced motion: no
 * animated zoom.
 */
export function ProductLightbox({
  open,
  onOpenChange,
  images,
  index,
  onIndexChange,
  label,
  video = null,
  name = '',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  images: GalleryImage[]
  index: number
  onIndexChange: (index: number) => void
  label: (i: number) => string
  video?: GalleryVideo | null
  name?: string
}) {
  const { t, formatNumber } = useLocale()
  const count = images.length + (video ? 1 : 0)
  const showsVideo = video !== null && index >= images.length
  const image = showsVideo ? undefined : images[index]
  const go = (next: number) => onIndexChange((next + count) % count)
  const stage = useRef<ZoomHandle>(null)
  const [scale, setScale] = useState(1)
  const title = showsVideo ? t('catalog.gallery.videoLabel', { name }) : label(index)

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight' && count > 1) go(index + 1)
    else if (event.key === 'ArrowLeft' && count > 1) go(index - 1)
    else if ((event.key === '+' || event.key === '=') && image) stage.current?.zoomBy(ZOOM_STEP)
    else if ((event.key === '-' || event.key === '_') && image) stage.current?.zoomBy(1 / ZOOM_STEP)
    else if (event.key === '0' && image) stage.current?.reset()
    else return
    event.preventDefault()
  }

  const round = 'grid size-11 shrink-0 place-items-center rounded-full bg-white/15 transition hover:bg-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-40'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[100dvh] max-h-none w-screen max-w-none flex-col items-stretch gap-3 rounded-none border-0 bg-black/95 p-3 text-white ring-0 sm:max-w-none sm:p-4"
        onKeyDown={onKeyDown}
        data-testid="product-lightbox"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          {t('catalog.gallery.arrowHint')} {t('catalog.gallery.zoomHint')}
        </DialogDescription>
        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          {showsVideo && video ? (
            <div className="w-full max-w-5xl">
              <ProductVideoPlayer key={index} video={video} name={name} className="aspect-video" />
            </div>
          ) : image ? (
            <ZoomStage key={index} ref={stage} image={image} alt={image.alt || label(index)} onScale={setScale} onSwipe={(step) => count > 1 && go(index + step)} />
          ) : null}
          <DialogClose aria-label={t('common.close')} className={cn(round, 'absolute top-0 right-0 z-10 bg-black/60')}>
            <XIcon aria-hidden className="size-6" />
          </DialogClose>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {count > 1 && (
            <>
              <button type="button" onClick={() => go(index - 1)} aria-label={t('catalog.gallery.previousImage')} className={round}>
                <ChevronLeftIcon aria-hidden className="size-6" />
              </button>
              <p aria-live="polite" className="min-w-14 text-center text-sm tabular-nums">
                {formatNumber(index + 1)} / {formatNumber(count)}
              </p>
              <button type="button" onClick={() => go(index + 1)} aria-label={t('catalog.gallery.nextImage')} className={round}>
                <ChevronRightIcon aria-hidden className="size-6" />
              </button>
            </>
          )}
          {image && (
            <div className="flex items-center gap-2" data-testid="lightbox-zoom">
              <button type="button" onClick={() => stage.current?.zoomBy(1 / ZOOM_STEP)} disabled={scale <= 1} aria-label={t('catalog.gallery.zoomOut')} className={round}>
                <ZoomOutIcon aria-hidden className="size-5" />
              </button>
              <button type="button" onClick={() => stage.current?.zoomBy(ZOOM_STEP)} disabled={scale >= MAX_ZOOM} aria-label={t('catalog.gallery.zoomIn')} className={round}>
                <ZoomInIcon aria-hidden className="size-5" />
              </button>
              {scale > 1 && (
                <button type="button" onClick={() => stage.current?.reset()} aria-label={t('catalog.gallery.zoomReset')} className={round}>
                  <RotateCcwIcon aria-hidden className="size-5" />
                </button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

type ZoomHandle = { zoomBy: (factor: number) => void; reset: () => void }

type Point = { x: number; y: number }

type Gesture =
  | { kind: 'pinch'; start: ZoomView; mid: Point; distance: number }
  | { kind: 'drag'; start: ZoomView; origin: Point; moved: boolean }

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** The photo's fitted box in the stage, or null before it has a size. */
function measure(stageRef: RefObject<HTMLDivElement | null>, imgRef: RefObject<HTMLImageElement | null>): ZoomBox | null {
  const stage = stageRef.current
  const img = imgRef.current
  if (!stage || !img || img.offsetWidth === 0 || img.offsetHeight === 0) return null
  return { left: img.offsetLeft, top: img.offsetTop, width: img.offsetWidth, height: img.offsetHeight, stageWidth: stage.clientWidth, stageHeight: stage.clientHeight }
}

function stagePoint(stageRef: RefObject<HTMLDivElement | null>, event: { clientX: number; clientY: number }): Point {
  const rect = stageRef.current?.getBoundingClientRect()
  return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : { x: event.clientX, y: event.clientY }
}

/** One photo that zooms and pans with pointer events (no library). Remounted per slide, so each starts unzoomed. */
function ZoomStage({ image, alt, onScale, onSwipe, ref }: { image: GalleryImage; alt: string; onScale: (scale: number) => void; onSwipe: (step: 1 | -1) => void; ref?: Ref<ZoomHandle> }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [view, setView] = useState<ZoomView>(IDENTITY)
  const [animated, setAnimated] = useState(false)
  const viewRef = useRef(view)
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<Gesture | null>(null)
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null)
  const lastPointerType = useRef('mouse')

  useEffect(() => {
    viewRef.current = view
    onScale(view.scale)
  }, [view, onScale])

  /** Discrete zoom steps animate (unless reduced motion); gestures follow the fingers directly. */
  const change = (next: (current: ZoomView, box: ZoomBox) => ZoomView, animate: boolean) => {
    const box = measure(stageRef, imgRef)
    if (!box) return
    setAnimated(animate)
    setView((current) => next(current, box))
  }

  useImperativeHandle(ref, () => ({
    zoomBy: (factor: number) => change((current, box) => zoomCentre(current, factor, box), true),
    reset: () => change(() => IDENTITY, true),
  }))

  // The wheel zooms around the cursor; a non-passive listener, so the page does not scroll instead.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const box = measure(stageRef, imgRef)
      if (!box) return
      const point = stagePoint(stageRef, event)
      setAnimated(false)
      setView((current) => zoomAt(current, wheelFactor(event.deltaY, event.deltaMode), point.x, point.y, box))
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    lastPointerType.current = event.pointerType
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointers.current.set(event.pointerId, stagePoint(stageRef, event))
    const [a, b] = [...pointers.current.values()]
    if (a && b) gesture.current = { kind: 'pinch', start: viewRef.current, mid: midpoint(a, b), distance: distance(a, b) }
    else if (a) gesture.current = { kind: 'drag', start: viewRef.current, origin: a, moved: false }
    setAnimated(false)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    const point = stagePoint(stageRef, event)
    pointers.current.set(event.pointerId, point)
    const current = gesture.current
    const box = measure(stageRef, imgRef)
    if (!current || !box) return
    if (current.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()]
      if (a && b) setView(pinchView(current.start, current.mid, current.distance, midpoint(a, b), distance(a, b), box))
      return
    }
    const dx = point.x - current.origin.x
    const dy = point.y - current.origin.y
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) current.moved = true
    if (current.start.scale > 1) setView(panView(current.start, dx, dy, box))
  }

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!pointers.current.delete(event.pointerId)) return
    const current = gesture.current
    const [rest] = [...pointers.current.values()]
    if (current?.kind === 'pinch') {
      // One finger left: it carries on moving the photo from where the pinch left it.
      gesture.current = rest ? { kind: 'drag', start: viewRef.current, origin: rest, moved: true } : null
      return
    }
    gesture.current = null
    if (cancelled || current?.kind !== 'drag') return
    const point = stagePoint(stageRef, event)
    const dx = point.x - current.origin.x
    const dy = point.y - current.origin.y
    // A sideways swipe (touch or pen) of the unzoomed photo steps to the next or previous slide.
    if (event.pointerType !== 'mouse' && current.start.scale === 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      onSwipe(dx < 0 ? 1 : -1)
      return
    }
    if (current.moved || event.pointerType === 'mouse') return
    const now = event.timeStamp
    const last = lastTap.current
    if (last && now - last.time < 320 && Math.hypot(point.x - last.x, point.y - last.y) < 30) {
      lastTap.current = null
      change((view, box) => toggleZoom(view, point.x, point.y, box), true)
    } else lastTap.current = { time: now, x: point.x, y: point.y }
  }

  return (
    <div
      ref={stageRef}
      className={cn('relative flex size-full touch-none items-center justify-center overflow-hidden select-none', view.scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => onPointerEnd(event, false)}
      onPointerCancel={(event) => onPointerEnd(event, true)}
      onDoubleClick={(event) => {
        // Touch screens zoom on their own double tap (above); this is the mouse's double click.
        if (lastPointerType.current !== 'mouse') return
        const point = stagePoint(stageRef, event)
        change((current, box) => toggleZoom(current, point.x, point.y, box), true)
      }}
      data-testid="lightbox-stage"
      data-scale={view.scale.toFixed(2)}
    >
      <img
        ref={imgRef}
        src={image.url}
        alt={alt}
        decoding="async"
        draggable={false}
        className={cn('block max-h-full max-w-full object-contain', animated && 'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out')}
        style={{ transform: view.scale === 1 ? undefined : `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' }}
      />
    </div>
  )
}
