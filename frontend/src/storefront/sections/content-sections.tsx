import { BadgePercentIcon, ClockIcon, CreditCardIcon, GiftIcon, HeadsetIcon, HeartIcon, LeafIcon, RotateCcwIcon, ShieldCheckIcon, StarIcon, StoreIcon, TruckIcon, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MediaImage } from '../components/media-image'
import { RichText } from '../components/rich-text'
import { useLocale } from '../i18n/locale'
import type { FeatureIconKey, StoreSection } from '../types'
import { SectionHeading } from './section-heading'

const ICONS: Record<FeatureIconKey, LucideIcon> = {
  truck: TruckIcon,
  'shield-check': ShieldCheckIcon,
  'credit-card': CreditCardIcon,
  headset: HeadsetIcon,
  gift: GiftIcon,
  'rotate-ccw': RotateCcwIcon,
  'badge-percent': BadgePercentIcon,
  clock: ClockIcon,
  leaf: LeafIcon,
  heart: HeartIcon,
  star: StarIcon,
  store: StoreIcon,
}

export function RichTextSection({ section }: { section: Extract<StoreSection, { type: 'rich_text' }> }) {
  const { config } = section

  return (
    <section style={config.background ? { backgroundColor: config.background } : undefined} aria-label={section.title ?? undefined}>
      <div className={cn('mx-auto px-4 py-12', config.width === 'narrow' ? 'max-w-3xl' : 'max-w-sf', config.alignment === 'center' && 'text-center')}>
        <SectionHeading section={section} className={config.alignment === 'left' ? 'text-left' : undefined} />
        <RichText html={config.body_html} />
      </div>
    </section>
  )
}

export function FeaturesStrip({ section }: { section: Extract<StoreSection, { type: 'features_strip' }> }) {
  const { config } = section
  const { t } = useLocale()

  return (
    <section style={config.background ? { backgroundColor: config.background } : undefined} aria-label={section.title ?? t('content.section.whyShop')}>
      <div className="mx-auto max-w-sf px-4 py-10">
        <SectionHeading section={section} />
        <ul className={cn('grid gap-6 sm:grid-cols-2', config.items.length >= 4 ? 'lg:grid-cols-4' : config.items.length === 3 ? 'lg:grid-cols-3' : '')}>
          {config.items.map((item, i) => {
            const Icon = ICONS[item.icon] ?? StarIcon
            return (
              <li key={i} className="flex items-start gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-sf-accent text-sf-accent-foreground" aria-hidden>
                  <Icon className="size-6" />
                </span>
                <div>
                  <h3 className="text-lg font-bold">{item.title}</h3>
                  {item.text && <p className="text-sm">{item.text}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

function Stars({ rating }: { rating: number }) {
  const { t } = useLocale()
  return (
    <p className="flex gap-0.5 text-sf-primary" aria-label={t('content.section.stars', { rating, max: 5 })}>
      {Array.from({ length: 5 }, (_, i) => <StarIcon key={i} className={cn('size-4', i < rating ? 'fill-current' : 'opacity-30')} aria-hidden />)}
    </p>
  )
}

export function Testimonials({ section }: { section: Extract<StoreSection, { type: 'testimonials' }> }) {
  const { config } = section
  const { t } = useLocale()

  return (
    <section style={config.background ? { backgroundColor: config.background } : undefined} aria-label={section.title ?? t('content.section.customerReviews')}>
      <div className="mx-auto max-w-sf px-4 py-12">
        <SectionHeading section={section} />
        <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {config.items.map((item, i) => (
            <li key={i}>
              <figure className="flex h-full flex-col gap-4 rounded-sf-card bg-sf-surface p-6 shadow-sm">
                {item.rating !== null && <Stars rating={item.rating} />}
                <blockquote className="flex-1 text-base italic">“{item.quote}”</blockquote>
                <figcaption className="flex items-center gap-3">
                  {item.avatar ? (
                    <MediaImage media={item.avatar} alt="" sizes="48px" className="size-12 rounded-full object-cover" />
                  ) : (
                    <span className="grid size-12 place-items-center rounded-full bg-sf-canvas font-heading text-lg font-bold text-sf-heading" aria-hidden>
                      {item.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span>
                    <span className="block font-semibold text-sf-heading">{item.name}</span>
                    {item.role && <span className="block text-sm">{item.role}</span>}
                  </span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
