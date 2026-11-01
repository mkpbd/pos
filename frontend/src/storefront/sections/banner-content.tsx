import { cn } from '@/lib/utils'
import { MenuLink } from '../components/menu-link'
import type { StoreBanner } from '../types'

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

/** Kicker, headline, text and buttons laid over a banner image. */
export function BannerText({ banner, size }: { banner: StoreBanner; size: 'hero' | 'tile' }) {
  const hasText = banner.kicker || banner.title || banner.subtitle || banner.button_label || banner.secondary_button_label
  if (!hasText) return null
  const Heading = size === 'hero' ? 'h2' : 'h3'

  return (
    <div className={cn('flex flex-col gap-3', POSITION[banner.text_position])} style={{ color: banner.text_color }}>
      {banner.kicker && <p className={cn('font-heading font-semibold', size === 'hero' ? 'text-xl lg:text-2xl' : 'text-sm uppercase tracking-wide')}>{banner.kicker}</p>}
      {banner.title && (
        <Heading className={cn('leading-tight font-extrabold text-inherit', size === 'hero' ? 'max-w-2xl text-4xl lg:text-6xl' : 'text-2xl')} style={{ color: banner.text_color }}>
          {banner.title}
        </Heading>
      )}
      {banner.subtitle && <p className={cn('max-w-xl', size === 'hero' ? 'text-lg' : 'text-sm')}>{banner.subtitle}</p>}
      {(banner.button_label || banner.secondary_button_label) && (
        <div className="flex flex-wrap gap-3 pt-2">
          {banner.button_label && banner.link_url && (
            <MenuLink url={banner.link_url} className="inline-flex items-center rounded-sf-button bg-sf-primary px-6 py-3 text-sm font-semibold text-sf-primary-foreground uppercase transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2">
              {banner.button_label}
            </MenuLink>
          )}
          {banner.secondary_button_label && banner.secondary_link_url && (
            <MenuLink url={banner.secondary_link_url} className="inline-flex items-center rounded-sf-button bg-sf-accent px-6 py-3 text-sm font-semibold text-sf-accent-foreground uppercase transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2">
              {banner.secondary_button_label}
            </MenuLink>
          )}
        </div>
      )}
    </div>
  )
}
