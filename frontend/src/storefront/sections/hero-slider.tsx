import { useEffect, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MenuLink } from '../components/menu-link'
import { useLocale } from '../i18n/locale'
import { useStoreLayout } from '../theme'
import type { StoreBanner, StoreSection } from '../types'
import { BannerPicture, BannerText, SaleBannerText } from './banner-content'

type Props = { section: Extract<StoreSection, { type: 'hero_slider' }> }

const JUSTIFY = { left: 'justify-start', center: 'justify-center', right: 'justify-end' } as const

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The hero in the theme's `hero_style`: full-width slides (`full`, `sale`) or editorial tiles (`tiles`). */
export function HeroSlider({ section }: Props) {
  const { hero_style: style } = useStoreLayout()
  if (style === 'tiles') return <HeroTiles section={section} />
  return <HeroCarousel section={section} sale={style === 'sale'} />
}

/**
 * Full-width slides. Autoplay (if configured) pauses on hover and keyboard focus, can be
 * stopped with a button (WCAG 2.2.2), and is off for visitors who prefer reduced motion.
 * `sale` (classic): left-aligned heavy UPPERCASE headline with every button of the slide.
 */
function HeroCarousel({ section, sale }: Props & { sale: boolean }) {
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
      data-hero-style={sale ? 'sale' : undefined}
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
              <div className={cn('absolute inset-0 flex items-center', sale ? JUSTIFY.left : JUSTIFY[banner.text_position])}>
                <div className="mx-auto w-full max-w-sf px-6 lg:px-4">
                  {sale ? <SaleBannerText banner={banner} /> : <BannerText banner={banner} size="hero" />}
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

/** At most three banners as tiles: side by side from `md`, stacked below. */
const MAX_TILES = 3

/**
 * Editorial tiles (handmade): the slider's first three banners side by side, each an image with
 * its kicker, heading and link below. The heading link covers the whole tile.
 */
function HeroTiles({ section }: Props) {
  const { t } = useLocale()
  const tiles = section.banners.slice(0, MAX_TILES)
  if (tiles.length === 0) return null

  return (
    <section aria-label={section.title ?? t('content.section.featured')} className="mx-auto max-w-sf px-4 py-8 lg:py-12" data-hero-style="tiles">
      <ul className={cn('grid gap-6 lg:gap-8', tiles.length === 2 && 'md:grid-cols-2', tiles.length === 3 && 'md:grid-cols-3')}>
        {tiles.map((banner, i) => (
          <li key={banner.id}>
            <HeroTile banner={banner} priority={i === 0} wide={tiles.length === 1} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function HeroTile({ banner, priority, wide }: { banner: StoreBanner; priority: boolean; wide: boolean }) {
  const { t } = useLocale()
  const url = banner.link_url ?? banner.secondary_link_url
  const label = banner.button_label ?? (url ? t('theme.hero.shopNow') : null)
  const cover = 'after:absolute after:inset-0 focus-visible:outline-none'

  return (
    <article className="group relative flex h-full flex-col rounded-sf-card has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-sf-accent" data-testid="hero-tile">
      <div className="overflow-hidden rounded-sf-card bg-sf-canvas">
        <BannerPicture
          banner={banner}
          sizes={wide ? '100vw' : '(min-width: 768px) 33vw, 100vw'}
          priority={priority}
          className={cn('transition-transform duration-700 ease-out group-hover:scale-[1.03] motion-reduce:transition-none', wide ? 'aspect-[16/7]' : 'aspect-[4/3] md:aspect-[4/5]')}
        />
      </div>
      <div className="flex flex-col items-start gap-2 pt-5">
        {banner.kicker && <p className="text-xs font-medium tracking-[0.2em] text-sf-text uppercase">{banner.kicker}</p>}
        {banner.title ? (
          <h2 className="sf-heading-case text-2xl leading-tight font-semibold lg:text-3xl">
            {url ? (
              <MenuLink url={url} className={cn(cover, 'transition-colors hover:text-sf-accent')}>
                {banner.title}
              </MenuLink>
            ) : (
              banner.title
            )}
          </h2>
        ) : (
          url && (
            <MenuLink url={url} className={cover}>
              <span className="sr-only">{banner.image.alt ?? t('content.section.openOffer')}</span>
            </MenuLink>
          )
        )}
        {banner.subtitle && <p className="max-w-md text-sm leading-relaxed">{banner.subtitle}</p>}
        {label && (
          <span aria-hidden className="mt-1 inline-flex items-center gap-2 border-b border-current pb-0.5 text-sm font-semibold text-sf-heading transition-colors group-hover:text-sf-accent">
            {label}
            <span className="transition-transform group-hover:translate-x-1 motion-reduce:transition-none">→</span>
          </span>
        )}
      </div>
    </article>
  )
}
