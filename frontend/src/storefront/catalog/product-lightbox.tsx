import type { KeyboardEvent } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useLocale } from '../i18n/locale'
import type { ProductDetail } from '../types'

export type GalleryImage = ProductDetail['images'][number]

/** The gallery's full-screen viewer: one image at a time, arrow keys step through them. Loaded on demand. */
export function ProductLightbox({
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
  const { t, formatNumber } = useLocale()
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
        <DialogDescription className="sr-only">{t('catalog.gallery.arrowHint')}</DialogDescription>
        {image && <img src={image.url} alt={image.alt || label(index)} decoding="async" className="max-h-[85dvh] max-w-full object-contain" />}
        {count > 1 && (
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => go(index - 1)} aria-label={t('catalog.gallery.previousImage')} className="grid size-11 place-items-center rounded-full bg-white/15 hover:bg-white/30">
              <ChevronLeftIcon aria-hidden className="size-6" />
            </button>
            <p aria-live="polite" className="text-sm tabular-nums">
              {formatNumber(index + 1)} / {formatNumber(count)}
            </p>
            <button type="button" onClick={() => go(index + 1)} aria-label={t('catalog.gallery.nextImage')} className="grid size-11 place-items-center rounded-full bg-white/15 hover:bg-white/30">
              <ChevronRightIcon aria-hidden className="size-6" />
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
