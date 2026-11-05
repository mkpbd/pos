import { useEffect, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MenuLink } from '../components/menu-link'
import { useLocale } from '../i18n/locale'
import type { StoreSection } from '../types'
import { BannerPicture, BannerText } from './banner-content'

type Props = { section: Extract<StoreSection, { type: 'hero_slider' }> }

const JUSTIFY = { left: 'justify-start', center: 'justify-center', right: 'justify-end' } as const

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Full-width slides. Autoplay (if configured) pauses on hover and keyboard focus, can be
 * stopped with a button (WCAG 2.2.2), and is off for visitors who prefer reduced motion.
 */
export function HeroSlider({ section }: Props) {
  const { banners, config } = section
  const { t } = useLocale()
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(() => config.autoplay_seconds > 0 && banners.length > 1 && !prefersReducedMotion())
  const [hovered, setHovered] = useState(false)
  const count = banners.length
  const current = Math.min(index, count - 1)

  useEffect(() => {
    if (!playing || hovered || count < 2) return
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % count), config.autoplay_seconds * 1000)
    return () => window.clearTimeout(timer)
  }, [playing, hovered, count, current, config.autoplay_seconds])

  const go = (next: number) => setIndex((next + count) % count)

  return (
    <section
      aria-roledescription="carousel"
      aria-label={section.title ?? t('content.section.featured')}
      className="relative overflow-hidden bg-sf-heading"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={() => setHovered(false)}
    >
      <div aria-live={playing ? 'off' : 'polite'} className={cn('relative', config.height === 'large' ? 'h-[26rem] md:h-[40rem]' : 'h-[20rem] md:h-[28rem]')}>
        {banners.map((banner, i) => {
          const linkWhole = banner.link_url && !banner.button_label && !banner.secondary_button_label
          const content = (
            <>
              <BannerPicture banner={banner} sizes="100vw" priority={i === 0} className="absolute inset-0" />
              <div className={cn('absolute inset-0 flex items-center', JUSTIFY[banner.text_position])}>
                <div className="mx-auto w-full max-w-sf px-6 lg:px-4">
                  <BannerText banner={banner} size="hero" />
                </div>
              </div>
            </>
          )

          return (
            <div
              key={banner.id}
              role="group"
              aria-roledescription="slide"
              aria-label={banner.title ? t('content.section.slideTitled', { index: i + 1, count, title: banner.title }) : t('content.section.slide', { index: i + 1, count })}
              aria-hidden={i !== current}
              inert={i !== current}
              className={cn('absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none', i === current ? 'opacity-100' : 'pointer-events-none opacity-0')}
            >
              {linkWhole ? (
                <MenuLink url={banner.link_url!} aria-label={banner.title ?? banner.image.alt ?? t('content.section.openOffer')} className="block size-full">
                  {content}
                </MenuLink>
              ) : (
                content
              )}
            </div>
          )
        })}
      </div>

      {count > 1 && (
        <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-3">
          <button type="button" aria-label={t('content.section.previousSlide')} onClick={() => go(current - 1)} className="grid size-10 place-items-center rounded-full bg-white/90 text-sf-heading shadow hover:bg-white">
            <ChevronLeftIcon className="size-5" />
          </button>
          <div className="flex gap-2">
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                aria-label={t('content.section.goToSlide', { index: i + 1 })}
                aria-current={i === current ? 'true' : undefined}
                onClick={() => go(i)}
                className={cn('size-3 rounded-full border-2 border-white', i === current ? 'bg-white' : 'bg-white/30')}
              />
            ))}
          </div>
          <button type="button" aria-label={t('content.section.nextSlide')} onClick={() => go(current + 1)} className="grid size-10 place-items-center rounded-full bg-white/90 text-sf-heading shadow hover:bg-white">
            <ChevronRightIcon className="size-5" />
          </button>
          {config.autoplay_seconds > 0 && (
            <button
              type="button"
              aria-label={playing ? t('content.section.stopSlides') : t('content.section.startSlides')}
              onClick={() => setPlaying((p) => !p)}
              className="grid size-10 place-items-center rounded-full bg-white/90 text-sf-heading shadow hover:bg-white"
            >
              {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
