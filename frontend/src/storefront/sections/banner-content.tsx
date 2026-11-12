import { cn } from '@/lib/utils'
import { MenuLink } from '../components/menu-link'
import { isLightColor } from '../color'
import type { StoreBanner } from '../types'
import { useBannerButtonColors } from './banner-colors'

const POSITION = {
  left: 'items-start text-left',
  center: 'items-center text-center',
  right: 'items-end text-right',
} as const

/**
 * Responsive banner picture: the mobile image (if any) below 768px. Lazy, unless `priority`
 * (the hero's first slide, the homepage's LCP image: eager at high priority).
 */
export function BannerPicture({ banner, sizes, priority = false, className }: { banner: StoreBanner; sizes: string; priority?: boolean; className?: string }) {
  const { image, mobile_image: mobile } = banner

  return (
    <picture>
      {mobile && <source media="(max-width: 767px)" srcSet={mobile.srcset} sizes="100vw" />}
      <img
        src={image.url}
        srcSet={image.srcset}
        sizes={sizes}
        width={image.width}
        height={image.height}
        alt={image.alt ?? ''}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
        className={cn('size-full object-cover', className)}
      />
    </picture>
  )
}

const SCRIM_DIRECTION = { left: 'to right', center: 'to right', right: 'to left', bottom: 'to top' } as const

/**
 * A gradient behind banner text so it stays readable on any photo: dark under light text,
 * light under dark text, strongest on the text's side. Decorative (aria-hidden); rendered only
 * when the banner has text.
 */
export function BannerScrim({ banner, from }: { banner: StoreBanner; from: keyof typeof SCRIM_DIRECTION }) {
  const hasText = banner.kicker || banner.title || banner.subtitle || banner.button_label || banner.secondary_button_label
  if (!hasText) return null
  const tone = isLightColor(banner.text_color) ? '0 0 0' : '255 255 255'
  const background =
    from === 'center'
      ? `radial-gradient(ellipse at center, rgb(${tone} / 0.55) 0%, rgb(${tone} / 0.25) 55%, rgb(${tone} / 0) 80%)`
      : `linear-gradient(${SCRIM_DIRECTION[from]}, rgb(${tone} / 0.7) 0%, rgb(${tone} / 0.45) 40%, rgb(${tone} / 0) 75%)`

  if (from === 'bottom') return <div aria-hidden="true" data-testid="banner-scrim" className="pointer-events-none absolute inset-0" style={{ background }} />

  // Below md the text spans the whole slide, so the wash is even instead of one-sided.
  return (
    <>
      <div aria-hidden="true" data-testid="banner-scrim" className="pointer-events-none absolute inset-0 hidden md:block" style={{ background }} />
      <div aria-hidden="true" data-testid="banner-scrim-mobile" className="pointer-events-none absolute inset-0 md:hidden" style={{ background: `rgb(${tone} / 0.55)` }} />
    </>
  )
}

/** Kicker, headline, text and buttons laid over a banner image. */
export function BannerText({ banner, size }: { banner: StoreBanner; size: 'hero' | 'tile' }) {
  const hasText = banner.kicker || banner.title || banner.subtitle || banner.button_label || banner.secondary_button_label
  const Heading = size === 'hero' ? 'h2' : 'h3'
  const buttonColors = useBannerButtonColors(banner)
  if (!hasText) return null

  return (
    <div className={cn('flex flex-col gap-3', POSITION[banner.text_position])} style={{ color: banner.text_color }}>
      {banner.kicker && <p className={cn('font-heading font-semibold', size === 'hero' ? 'text-xl lg:text-2xl' : 'text-sm uppercase tracking-wide')}>{banner.kicker}</p>}
      {banner.title && (
        <Heading className={cn('sf-heading-case leading-tight font-extrabold text-inherit', size === 'hero' ? 'max-w-2xl text-4xl lg:text-6xl' : 'text-2xl')} style={{ color: banner.text_color }}>
          {banner.title}
        </Heading>
      )}
      {banner.subtitle && <p className={cn('max-w-xl', size === 'hero' ? 'text-lg' : 'text-sm')}>{banner.subtitle}</p>}
      {(banner.button_label || banner.secondary_button_label) && (
        <div className="flex flex-wrap gap-3 pt-2">
          {banner.button_label && banner.link_url && (
            <MenuLink url={banner.link_url} style={buttonColors.primary} className="inline-flex items-center sf-button rounded-sf-button bg-sf-button px-6 py-3 text-sm font-semibold text-sf-button-foreground uppercase transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2">
              {banner.button_label}
            </MenuLink>
          )}
          {banner.secondary_button_label && banner.secondary_link_url && (
            <MenuLink url={banner.secondary_link_url} style={buttonColors.secondary} className="inline-flex items-center rounded-sf-button bg-sf-accent px-6 py-3 text-sm font-semibold text-sf-accent-foreground uppercase transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2">
              {banner.secondary_button_label}
            </MenuLink>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The sale hero's text (classic): a kicker chip, a heavy UPPERCASE headline, the subtitle and
 * every button of the slide, always left-aligned.
 */
export function SaleBannerText({ banner }: { banner: StoreBanner }) {
  const hasText = banner.kicker || banner.title || banner.subtitle || banner.button_label || banner.secondary_button_label
  const buttonColors = useBannerButtonColors(banner)
  if (!hasText) return null
  const button = 'inline-flex items-center rounded-sf-button px-7 py-3.5 text-sm font-bold tracking-wider uppercase transition focus-visible:outline-2 focus-visible:outline-offset-2'

  return (
    <div className="flex max-w-2xl flex-col items-start gap-4 text-left" style={{ color: banner.text_color }} data-testid="sale-banner-text">
      {banner.kicker && <p className="inline-flex rounded-sm bg-sf-sale px-3 py-1.5 text-xs font-bold tracking-[0.2em] text-white uppercase">{banner.kicker}</p>}
      {banner.title && (
        <h2 className="text-5xl leading-[0.95] font-black tracking-tight text-inherit uppercase lg:text-7xl" style={{ color: banner.text_color }}>
          {banner.title}
        </h2>
      )}
      {banner.subtitle && <p className="max-w-lg text-lg font-medium">{banner.subtitle}</p>}
      {(banner.button_label || banner.secondary_button_label) && (
        <div className="flex flex-wrap gap-3 pt-3">
          {banner.button_label && banner.link_url && (
            <MenuLink url={banner.link_url} style={buttonColors.primary} className={cn(button, 'sf-button bg-sf-button text-sf-button-foreground hover:brightness-95')}>
              {banner.button_label}
            </MenuLink>
          )}
          {banner.secondary_button_label && banner.secondary_link_url && (
            <MenuLink url={banner.secondary_link_url} style={buttonColors.secondary} className={cn(button, 'bg-sf-accent text-sf-accent-foreground hover:brightness-110')}>
              {banner.secondary_button_label}
            </MenuLink>
          )}
        </div>
      )}
    </div>
  )
}
