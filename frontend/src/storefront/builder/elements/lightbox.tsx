import { useState, type KeyboardEvent } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useLocale } from '../../i18n/locale'

export type LightboxImage = { id: string; url: string; srcset?: string; alt: string; caption: string }

/**
 * The builder gallery's full-screen viewer (an accessible modal dialog): the image with its
 * caption, previous / next buttons and arrow keys, Escape or the close button to leave; the focus
 * then returns to the photo that opened it.
 */
export function BuilderLightbox({
  images,
  index,
  onIndexChange,
  onClose,
  returnFocus,
}: {
  images: LightboxImage[]
  /** The image shown; null = closed. */
  index: number | null
  onIndexChange: (index: number) => void
  onClose: () => void
  /** Where the focus goes once the viewer has closed (the photo that opened it). */
  returnFocus: () => void
}) {
  const { t, formatNumber } = useLocale()
  const count = images.length
  const open = index !== null && count > 0
  // While closing, the last image stays (the dialog keeps its title through its exit animation).
  const [current, setCurrent] = useState(0)
  const wanted = open ? Math.min(Math.max(index, 0), count - 1) : current
  if (wanted !== current) setCurrent(wanted)
  const image = images[current]
  const go = (next: number) => onIndexChange((next + count) % count)

  const onKeyDown = (event: KeyboardEvent) => {
    if (count < 2) return
    if (event.key === 'ArrowRight') go(current + 1)
    else if (event.key === 'ArrowLeft') go(current - 1)
    else return
    event.preventDefault()
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex h-[100dvh] max-h-none w-screen max-w-none flex-col items-center justify-center gap-3 rounded-none border-0 bg-black/95 p-4 text-white ring-0 sm:max-w-none [&>[data-slot=dialog-close]]:text-white [&>[data-slot=dialog-close]]:hover:bg-white/20"
        onKeyDown={onKeyDown}
        // Back to the photo that opened the viewer (it is not a Radix trigger).
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocus()
        }}
        data-testid="builder-lightbox"
      >
        {image && (
          <>
            <DialogTitle className="sr-only">{image.alt || t('content.builder.gallery.image', { index: current + 1, count })}</DialogTitle>
            <DialogDescription className="sr-only">{t('content.builder.lightbox.hint')}</DialogDescription>
            <figure className="flex max-h-full min-h-0 flex-col items-center gap-3">
              <img src={image.url} srcSet={image.srcset || undefined} sizes="100vw" alt={image.alt} decoding="async" className="max-h-[80dvh] max-w-full object-contain" />
              {image.caption && <figcaption className="max-w-2xl text-center text-sm text-white/90">{image.caption}</figcaption>}
            </figure>
            {count > 1 && (
              <div className="flex items-center gap-4">
                <button type="button" onClick={() => go(current - 1)} aria-label={t('catalog.gallery.previousImage')} className="grid size-11 place-items-center rounded-full bg-white/15 hover:bg-white/30 focus-visible:outline-2 focus-visible:outline-white">
                  <ChevronLeftIcon aria-hidden className="size-6" />
                </button>
                <p aria-live="polite" className="text-sm tabular-nums">
                  {formatNumber(current + 1)} / {formatNumber(count)}
                </p>
                <button type="button" onClick={() => go(current + 1)} aria-label={t('catalog.gallery.nextImage')} className="grid size-11 place-items-center rounded-full bg-white/15 hover:bg-white/30 focus-visible:outline-2 focus-visible:outline-white">
                  <ChevronRightIcon aria-hidden className="size-6" />
                </button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
