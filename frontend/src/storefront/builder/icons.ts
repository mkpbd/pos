import { createElement, type ComponentType, type ReactNode } from 'react'
import {
  BadgePercentIcon,
  CheckIcon,
  ClockIcon,
  CreditCardIcon,
  GiftIcon,
  HeadsetIcon,
  HeartIcon,
  LeafIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  StarIcon,
  StoreIcon,
  TruckIcon,
  type LucideProps,
} from 'lucide-react'
import type { SocialNetwork } from '../types'

/*
 * The store builder's icon set (contract §2 `icon.name`): the homepage features-strip icons
 * (backend SectionType::FEATURE_ICONS) plus contact and social glyphs — the same list as the
 * backend's ElementRegistry::ICONS (`GET /storefront/builder/elements` → icons). Lucide no longer
 * ships brand marks, so the social glyphs are drawn here (simple, single colour, `currentColor`).
 * Plain .ts (createElement) so the constants and the components can share one module.
 */

export const ICON_NAMES = [
  'truck',
  'shield-check',
  'credit-card',
  'headset',
  'gift',
  'rotate-ccw',
  'badge-percent',
  'clock',
  'leaf',
  'heart',
  'star',
  'store',
  'phone',
  'mail',
  'map-pin',
  'instagram',
  'facebook',
  'youtube',
  'check',
  'sparkles',
] as const

export type IconName = (typeof ICON_NAMES)[number]

export type IconComponent = ComponentType<LucideProps>

export function isIconName(value: unknown): value is IconName {
  return typeof value === 'string' && (ICON_NAMES as readonly string[]).includes(value)
}

const h = createElement

/** A single-colour glyph (`currentColor`) drawn on a 24 px grid; P2b's share and WhatsApp marks use it too. */
export function glyph(name: string, paint: 'fill' | 'stroke', ...body: ReactNode[]): IconComponent {
  function Glyph({ size = 24, strokeWidth = 2, color = 'currentColor', absoluteStrokeWidth, ...props }: LucideProps) {
    void absoluteStrokeWidth
    return h(
      'svg',
      {
        xmlns: 'http://www.w3.org/2000/svg',
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: paint === 'fill' ? color : 'none',
        stroke: paint === 'stroke' ? color : 'none',
        strokeWidth: paint === 'stroke' ? strokeWidth : undefined,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'data-icon': name,
        ...props,
      },
      ...body,
    )
  }
  Glyph.displayName = `Glyph(${name})`
  return Glyph
}

export const FacebookGlyph = glyph(
  'facebook',
  'fill',
  h('path', { key: 'p', d: 'M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21h3Z' }),
)

export const InstagramGlyph = glyph(
  'instagram',
  'stroke',
  h('rect', { key: 'r', x: 3, y: 3, width: 18, height: 18, rx: 5 }),
  h('circle', { key: 'c', cx: 12, cy: 12, r: 4 }),
  h('path', { key: 'd', d: 'M17.5 6.5h.01' }),
)

export const YoutubeGlyph = glyph(
  'youtube',
  'fill',
  h('path', {
    key: 'p',
    fillRule: 'evenodd',
    d: 'M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8A26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z',
  }),
)

export const TiktokGlyph = glyph('tiktok', 'stroke', h('path', { key: 'p', d: 'M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.5 2.5 2.4 4 5 4' }))

export const XGlyph = glyph('x', 'stroke', h('path', { key: 'p', d: 'M4 4h4.5L20 20h-4.5L4 4Zm16 0-6.6 7.2M10.6 12.8 4 20' }))

export const LinkedinGlyph = glyph(
  'linkedin',
  'stroke',
  h('rect', { key: 'r', x: 3, y: 3, width: 18, height: 18, rx: 3 }),
  h('path', { key: 'p', d: 'M8 10.5V17M8 7.5v.01M12 17v-6.5M12 13.5a2.5 2.5 0 0 1 5 0V17' }),
)

/** Every icon name with its component (the icon element, the editor's icon picker). */
export const BUILDER_ICONS: Record<IconName, IconComponent> = {
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
  phone: PhoneIcon,
  mail: MailIcon,
  'map-pin': MapPinIcon,
  instagram: InstagramGlyph,
  facebook: FacebookGlyph,
  youtube: YoutubeGlyph,
  check: CheckIcon,
  sparkles: SparklesIcon,
}

/** The theme footer's social networks with their glyphs (social icons element). */
export const SOCIAL_GLYPHS: Record<SocialNetwork, IconComponent> = {
  facebook: FacebookGlyph,
  instagram: InstagramGlyph,
  youtube: YoutubeGlyph,
  tiktok: TiktokGlyph,
  x: XGlyph,
  linkedin: LinkedinGlyph,
}

/** An icon of the set by name: decorative (aria-hidden) unless the caller passes its own aria props; unknown names draw nothing. */
export function BuilderIcon({ name, size = 24, ...props }: { name: string } & LucideProps) {
  if (!isIconName(name)) return null
  return h(BUILDER_ICONS[name], { size, 'aria-hidden': true, ...props })
}
