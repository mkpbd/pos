import { useEffect, useRef, useState } from 'react'
import { PlayIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import { ProductImage } from './product-image'
import { PROVIDER_NAMES, type GalleryVideo } from './product-video'

/**
 * P1b: the product video behind its poster (the product's first image) and a play button. Nothing
 * is requested from YouTube or Vimeo until the shopper presses play (no cookies, no thumbnails);
 * then the privacy-enhanced player loads in place and takes the focus.
 */
export function ProductVideoPlayer({ video, name, className }: { video: GalleryVideo; name: string; className?: string }) {
  const { t } = useLocale()
  const [playing, setPlaying] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const provider = PROVIDER_NAMES[video.video.provider]

  useEffect(() => {
    if (playing) frameRef.current?.focus()
  }, [playing])

  return (
    <div className={cn('relative aspect-square w-full overflow-hidden bg-neutral-950', className)} data-testid="product-video">
      {playing ? (
        <iframe
          ref={frameRef}
          src={video.src}
          title={t('catalog.gallery.videoTitle', { name })}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 size-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={t('catalog.gallery.playVideo', { name })}
          className="group absolute inset-0 block size-full focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-sf-accent"
          data-testid="product-video-play"
        >
          {video.poster ? <ProductImage image={video.poster} alt="" className="absolute inset-0 size-full bg-neutral-950 opacity-80" /> : null}
          <span aria-hidden className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/25 p-4 text-center text-white">
            <span className="grid size-16 place-items-center rounded-full bg-white/95 text-neutral-900 shadow-lg transition group-hover:scale-105 motion-reduce:transition-none">
              <PlayIcon className="ml-1 size-7 fill-current" />
            </span>
            <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-medium">{t('catalog.gallery.videoSource', { provider })}</span>
          </span>
        </button>
      )}
    </div>
  )
}
