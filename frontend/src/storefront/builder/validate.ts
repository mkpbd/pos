/*
 * Value rules of the builder document (contract §1), mirroring the backend
 * BuilderDocumentSchema::normalize for styles, column widths and links. The server validates on
 * save; the storefront validates again before anything reaches CSS or an href (defence in depth):
 * invalid values are dropped, unknown keys are dropped, nothing is filled in.
 */

import type { ListingColumns, ThemeColors } from '../types'
import { ICON_NAMES } from './icons'
import type {
  Background,
  BackgroundVideo,
  Gradient,
  GradientStop,
  Length,
  Motion,
  ResponsiveStyle,
  SectionShape,
  Shadow,
  Sides,
  Style,
  Typography,
  VideoProvider,
} from './types'

type Obj = Record<string, unknown>

export const THEME_COLOR_ROLES = [
  'primary',
  'primary_foreground',
  'accent',
  'accent_foreground',
  'highlight',
  'sale',
  'heading',
  'text',
  'canvas',
  'surface',
  'border',
] as const satisfies readonly (keyof ThemeColors)[]

export const ENUMS = {
  layout: ['boxed', 'full', 'full-bleed'],
  backgroundType: ['none', 'color', 'gradient', 'image'],
  gradientType: ['linear', 'radial'],
  gradientShape: ['circle', 'ellipse'],
  backgroundPosition: ['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'],
  backgroundSize: ['cover', 'contain', 'auto'],
  font: ['theme:heading', 'theme:body'],
  textAlign: ['left', 'center', 'right', 'justify'],
  textTransform: ['none', 'uppercase', 'lowercase', 'capitalize'],
  align: ['start', 'center', 'end', 'stretch'],
  justify: ['start', 'center', 'end', 'between', 'around'],
  borderStyle: ['none', 'solid', 'dashed', 'dotted'],
  hoverTransform: ['none', 'lift', 'grow'],
  imageAspect: ['auto', '1:1', '4:3', '3:2', '16:9', '3:4'],
  imageFit: ['cover', 'contain'],
  buttonVariant: ['primary', 'accent', 'outline', 'link'],
  buttonSize: ['sm', 'md', 'lg'],
  dividerLine: ['solid', 'dashed', 'dotted'],
  dividerAlign: ['left', 'center', 'right'],
} as const

const HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const LENGTH = /^(-?)(\d{1,4}(?:\.\d{1,2})?)(px|rem|em|%|vh|vw)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LENGTH_MAX: Record<string, number> = { px: 2000, rem: 100, em: 100, '%': 100, vh: 100, vw: 100 }

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function inRange(value: unknown, min: number, max: number): value is number {
  return isNumber(value) && value >= min && value <= max
}

export function oneOf<const T extends readonly string[]>(value: unknown, options: T): T[number] | undefined {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T[number]) : undefined
}

/** Removes undefined entries; undefined when nothing is left (empty groups are dropped). */
function compact<T extends Obj>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined)
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** `#rrggbb` / `#rrggbbaa` (lower-cased) or `theme:<role>`; anything else is invalid. */
export function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (HEX_COLOR.test(value)) return value.toLowerCase()
  if (value.startsWith('theme:') && (THEME_COLOR_ROLES as readonly string[]).includes(value.slice(6))) return value
  return undefined
}

type LengthRules = { auto?: boolean; nonNegative?: boolean; units?: readonly string[]; max?: number }

/** A bounded CSS length (`12px`, `1.5rem`, `-8px`, `50%`, …); `auto` only where allowed. */
export function normalizeLength(value: unknown, rules: LengthRules = {}): Length | undefined {
  if (typeof value !== 'string') return undefined
  if (value === 'auto') return rules.auto ? value : undefined
  const match = LENGTH.exec(value)
  if (!match) return undefined
  const [, sign, digits, unit] = match as unknown as [string, string, string, string]
  const amount = Number(digits)
  if (rules.units && !rules.units.includes(unit)) return undefined
  if (amount > (LENGTH_MAX[unit] ?? 0)) return undefined
  if (rules.max !== undefined && amount > rules.max) return undefined
  if (sign === '-' && rules.nonNegative && amount !== 0) return undefined
  return value
}

export function normalizeGradient(value: unknown): Gradient | undefined {
  if (!isObject(value)) return undefined
  const type = oneOf(value.type, ENUMS.gradientType)
  if (!type || !Array.isArray(value.stops) || value.stops.length < 2 || value.stops.length > 5) return undefined
  const stops: GradientStop[] = []
  for (const stop of value.stops) {
    const color = isObject(stop) ? normalizeColor(stop.color) : undefined
    if (!color || !isObject(stop) || !inRange(stop.position, 0, 100)) return undefined
    stops.push({ color, position: stop.position })
  }
  const gradient: Gradient = { type, stops }
  if (type === 'linear' && inRange(value.angle, 0, 360)) gradient.angle = value.angle
  if (type === 'radial') {
    const shape = oneOf(value.shape, ENUMS.gradientShape)
    if (shape) gradient.shape = shape
  }
  return gradient
}

function normalizeBackground(value: unknown): Background | undefined {
  if (!isObject(value)) return undefined
  const type = oneOf(value.type, ENUMS.backgroundType)
  if (!type) return undefined
  let image: Background['image']
  if (isObject(value.image)) {
    const { media_id, position, size, repeat } = value.image
    const pos = oneOf(position, ENUMS.backgroundPosition)
    const fit = oneOf(size, ENUMS.backgroundSize)
    if (isUuid(media_id) && pos && fit && typeof repeat === 'boolean') image = { media_id, position: pos, size: fit, repeat }
  }
  const overlay = typeof value.overlay === 'string' ? normalizeColor(value.overlay) : normalizeGradient(value.overlay)
  return compact({ type, color: normalizeColor(value.color), gradient: normalizeGradient(value.gradient), image, overlay, video: normalizeBackgroundVideo(value.video) })
}

/**
 * B6 `background.video`: a URL the video element accepts (provider and id are derived from it, as
 * the server does) and an optional poster image. Anything else is dropped.
 */
export function normalizeBackgroundVideo(value: unknown): BackgroundVideo | undefined {
  if (!isObject(value)) return undefined
  const parsed = parseVideoUrl(value.url)
  if (!parsed) return undefined
  const video: BackgroundVideo = { url: value.url as string, provider: parsed.provider, video_id: parsed.video_id }
  // Absent when none was chosen (the server omits it too).
  if (isObject(value.poster) && isUuid(value.poster.media_id)) video.poster = { media_id: value.poster.media_id }
  return video
}

/** B6 `motion`: entrance plus bounded duration / delay (ms, whole numbers); `none` keeps the group. */
export function normalizeMotion(value: unknown): Motion | undefined {
  if (!isObject(value)) return undefined
  const entrance = oneOf(value.entrance, B6_ENUMS.motionEntrance)
  if (!entrance) return undefined
  const motion: Motion = { entrance }
  if (isInt(value.duration, B6_LIMITS.motionDuration.min, B6_LIMITS.motionDuration.max)) motion.duration = value.duration
  if (isInt(value.delay, B6_LIMITS.motionDelay.min, B6_LIMITS.motionDelay.max)) motion.delay = value.delay
  return motion
}

function isInt(value: unknown, min: number, max: number): value is number {
  return inRange(value, min, max) && Number.isInteger(value)
}

function normalizeTypography(value: unknown): Typography | undefined {
  if (!isObject(value)) return undefined
  const weight = isNumber(value.weight) && Number.isInteger(value.weight) && value.weight >= 100 && value.weight <= 900 && value.weight % 100 === 0 ? value.weight : undefined
  return compact({
    font: oneOf(value.font, ENUMS.font),
    size: normalizeLength(value.size, { nonNegative: true }),
    weight,
    line_height: inRange(value.line_height, 0.8, 3) ? value.line_height : undefined,
    letter_spacing: normalizeLength(value.letter_spacing, { units: ['em', 'px'] }),
    align: oneOf(value.align, ENUMS.textAlign),
    transform: oneOf(value.transform, ENUMS.textTransform),
  })
}

function normalizeSides(value: unknown, rules: LengthRules): Sides | undefined {
  if (!isObject(value)) return undefined
  return compact({
    top: normalizeLength(value.top, rules),
    right: normalizeLength(value.right, rules),
    bottom: normalizeLength(value.bottom, rules),
    left: normalizeLength(value.left, rules),
  })
}

export function normalizeShadow(value: unknown): Shadow | undefined {
  if (!isObject(value)) return undefined
  const color = normalizeColor(value.color)
  const { x, y, blur, spread, inset } = value
  if (!color || !inRange(x, -100, 100) || !inRange(y, -100, 100) || !inRange(blur, 0, 200) || !inRange(spread, -100, 100) || typeof inset !== 'boolean') return undefined
  return { x, y, blur, spread, color, inset }
}

function normalizeShadows(value: unknown, max: number): Shadow[] | undefined {
  if (!Array.isArray(value) || value.length > max) return undefined
  const shadows = value.map(normalizeShadow).filter((shadow): shadow is Shadow => shadow !== undefined)
  // `[]` (no shadow) is a value; a list whose every layer was invalid is dropped.
  return shadows.length === 0 && value.length > 0 ? undefined : shadows
}

const NON_NEGATIVE: LengthRules = { nonNegative: true }

/** One breakpoint's style: known groups only, each value valid. */
export function normalizeStyleValue(value: unknown): Style | undefined {
  if (!isObject(value)) return undefined
  const spacing = isObject(value.spacing)
    ? compact({ margin: normalizeSides(value.spacing.margin, { auto: true }), padding: normalizeSides(value.spacing.padding, NON_NEGATIVE) })
    : undefined
  const size = isObject(value.size)
    ? compact({
        width: normalizeLength(value.size.width, NON_NEGATIVE),
        height: normalizeLength(value.size.height, NON_NEGATIVE),
        min_height: normalizeLength(value.size.min_height, NON_NEGATIVE),
        max_width: normalizeLength(value.size.max_width, NON_NEGATIVE),
      })
    : undefined
  const layout = isObject(value.layout)
    ? compact({
        gap: normalizeLength(value.layout.gap, NON_NEGATIVE),
        row_gap: normalizeLength(value.layout.row_gap, NON_NEGATIVE),
        align: oneOf(value.layout.align, ENUMS.align),
        justify: oneOf(value.layout.justify, ENUMS.justify),
        wrap: typeof value.layout.wrap === 'boolean' ? value.layout.wrap : undefined,
      })
    : undefined
  let border: Style['border']
  if (isObject(value.border)) {
    const radius = isObject(value.border.radius)
      ? compact({
          tl: normalizeLength(value.border.radius.tl, NON_NEGATIVE),
          tr: normalizeLength(value.border.radius.tr, NON_NEGATIVE),
          br: normalizeLength(value.border.radius.br, NON_NEGATIVE),
          bl: normalizeLength(value.border.radius.bl, NON_NEGATIVE),
        })
      : undefined
    border = compact({
      width: normalizeLength(value.border.width, { units: ['px'], nonNegative: true, max: 20 }),
      style: oneOf(value.border.style, ENUMS.borderStyle),
      color: normalizeColor(value.border.color),
      radius,
    })
  }
  let effects: Style['effects']
  if (isObject(value.effects)) {
    const hover = isObject(value.effects.hover)
      ? compact({
          color: normalizeColor(value.effects.hover.color),
          background_color: normalizeColor(value.effects.hover.background_color),
          shadow: normalizeShadows(value.effects.hover.shadow, 3),
          transform: oneOf(value.effects.hover.transform, ENUMS.hoverTransform),
        })
      : undefined
    effects = compact({
      shadow: normalizeShadows(value.effects.shadow, 3),
      text_shadow: normalizeShadows(value.effects.text_shadow, 2),
      opacity: inRange(value.effects.opacity, 0, 1) ? value.effects.opacity : undefined,
      hover,
    })
  }
  return compact({
    background: normalizeBackground(value.background),
    color: normalizeColor(value.color),
    typography: normalizeTypography(value.typography),
    spacing,
    size,
    layout,
    border,
    effects,
    motion: normalizeMotion(value.motion),
  })
}

/** `{base?, tablet?, mobile?}`; anything else (or invalid) is dropped. Always an object. B6: `motion` and `background.video` are kept on `base` only. */
export function normalizeStyle(value: unknown): ResponsiveStyle {
  if (!isObject(value)) return {}
  const style: ResponsiveStyle = {}
  for (const breakpoint of ['base', 'tablet', 'mobile'] as const) {
    let normalized = normalizeStyleValue(value[breakpoint])
    if (normalized && breakpoint !== 'base' && (normalized.motion || normalized.background?.video)) {
      const { motion, background, ...rest } = normalized
      void motion
      let kept: Background | undefined = background
      if (background?.video) {
        const { video, ...other } = background
        void video
        kept = other
      }
      normalized = compact({ ...rest, background: kept })
    }
    if (normalized) style[breakpoint] = normalized
  }
  return style
}

/** A column width in percent: 5–100 with at most two decimals. */
export function normalizeWidthValue(value: unknown): number | undefined {
  return inRange(value, 5, 100) && Math.abs(Math.round(value * 100) - value * 100) < 1e-6 ? value : undefined
}

export function normalizeWidth(value: unknown): { base: number; tablet?: number; mobile?: number } {
  const width = isObject(value) ? value : {}
  const result: { base: number; tablet?: number; mobile?: number } = { base: normalizeWidthValue(width.base) ?? 100 }
  const tablet = normalizeWidthValue(width.tablet)
  const mobile = normalizeWidthValue(width.mobile)
  if (tablet !== undefined) result.tablet = tablet
  if (mobile !== undefined) result.mobile = mobile
  return result
}

/**
 * A link target the storefront may follow: a site-relative path (`/shop`, not `//host` or `/\host`)
 * or an absolute http(s) URL, without whitespace. `javascript:`, `data:` and the like are refused.
 */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null
  if (/[\s\\<>"]/.test(value)) return null
  if (/^\/(?![/\\])/.test(value) || value === '/') return value
  if (/^https?:\/\/[^/]/i.test(value)) return value
  return null
}

/** `{url}` with a safe url, else null. */
export function safeLink(value: unknown): string | null {
  return isObject(value) ? safeUrl(value.url) : null
}

/* ----------------------------------------------------------------------------------------------
 * B4 elements (contract §2)
 * -------------------------------------------------------------------------------------------- */

export const B4_ENUMS = {
  videoProvider: ['youtube', 'vimeo'],
  videoAspect: ['16:9', '4:3', '1:1', '9:16'],
  countdownSource: ['date', 'promotion'],
  countdownStyle: ['boxes', 'inline'],
  ctaAlign: ['left', 'center', 'right'],
  menuLayout: ['horizontal', 'vertical'],
  /** Header menus: none | dropdown | mega; footer menus: none | list. */
  menuChildrenHeader: ['none', 'dropdown', 'mega'],
  menuChildrenFooter: ['none', 'list'],
  languageStyle: ['links', 'select'],
  socialStyle: ['plain', 'circle', 'square'],
  blockLayout: ['stacked', 'inline'],
  faqStyle: ['accordion', 'list'],
} as const

/** Bounds of the B4 numeric and text props. */
export const B4_LIMITS = {
  videoStart: { min: 0, max: 86_400 },
  iconSize: { min: 16, max: 128 },
  socialSize: { min: 16, max: 48 },
  paymentHeight: { min: 16, max: 48 },
  logoHeight: { min: 24, max: 96 },
  ctaTitle: 120,
  ctaText: 400,
  promoBadge: 24,
  customHtml: 20_000,
} as const

/** Maximum length of each translatable B4 text prop (backend ElementRegistry::TRANSLATABLE; nested props with a dot). */
export const B4_TEXT_LIMITS = {
  video: { title: 200 },
  icon: { label: 120 },
  countdown: { title: 120, expired_text: 200 },
  discount: { title: 120, text: 400, button_label: 60 },
  cta: { title: 120, text: 400, 'primary.label': 60, 'secondary.label': 60 },
  search_box: { placeholder: 80, button_label: 30 },
  promo_card: { badge: 24, title: 120, text: 200, button_label: 30 },
  copyright: { text: 200 },
  newsletter_form: { title: 120, text: 300, button_label: 40 },
  faq_list: { title: 120 },
  contact_form: { title: 120 },
} as const

const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/
const VIMEO_ID = /^\d{1,20}$/

/** Longest video URL normalize accepts (backend ElementRegistry::VIDEO_URL_MAX). */
export const VIDEO_URL_MAX = 500

const VIDEO_PATTERNS: [VideoProvider, RegExp][] = [
  ['youtube', /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:[^\s#]*&)?v=([A-Za-z0-9_-]{6,20})(?:[&#][^\s]*)?$/],
  ['youtube', /^https?:\/\/youtu\.be\/([A-Za-z0-9_-]{6,20})(?:[?#][^\s]*)?$/],
  ['youtube', /^https?:\/\/(?:www\.|m\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]{6,20})(?:[?#][^\s]*)?$/],
  ['vimeo', /^https?:\/\/(?:www\.)?vimeo\.com\/(\d{1,20})(?:[/?#][^\s]*)?$/],
]

/**
 * A video URL the builder accepts → provider and id (the backend's ElementRegistry::parseVideoUrl
 * patterns): YouTube `youtube.com/watch?v=<id>`, `youtu.be/<id>`, `youtube.com/shorts/<id>`
 * (id 6–20 of `[A-Za-z0-9_-]`); Vimeo `vimeo.com/<digits>`. Anything else is null.
 */
export function parseVideoUrl(value: unknown): { provider: VideoProvider; video_id: string } | null {
  if (typeof value !== 'string' || value.length > VIDEO_URL_MAX) return null
  for (const [provider, pattern] of VIDEO_PATTERNS) {
    const match = pattern.exec(value)
    if (match?.[1]) return { provider, video_id: match[1] }
  }
  return null
}

/** The privacy-enhanced player URL of a video (no cookies before play; Vimeo `dnt=1`). Null for an invalid id. */
export function videoEmbedUrl(provider: unknown, videoId: unknown, options: { autoplay?: boolean; start?: number } = {}): string | null {
  const start = typeof options.start === 'number' && Number.isInteger(options.start) && options.start > 0 ? options.start : 0
  if (provider === 'youtube' && typeof videoId === 'string' && YOUTUBE_ID.test(videoId)) {
    const query = new URLSearchParams({ rel: '0' })
    // The visitor clicked play: start playing (muted when the owner asked for autoplay).
    query.set('autoplay', '1')
    if (options.autoplay) query.set('mute', '1')
    if (start) query.set('start', String(start))
    return `https://www.youtube-nocookie.com/embed/${videoId}?${query.toString()}`
  }
  if (provider === 'vimeo' && typeof videoId === 'string' && VIMEO_ID.test(videoId)) {
    const query = new URLSearchParams({ dnt: '1', autoplay: '1' })
    if (options.autoplay) query.set('muted', '1')
    return `https://player.vimeo.com/video/${videoId}?${query.toString()}${start ? `#t=${start}s` : ''}`
  }
  return null
}

/**
 * B6 section background video: the privacy-enhanced player muted, autoplaying, looping, without
 * controls and inline on phones (YouTube `playlist=<id>` makes `loop` work; Vimeo `background=1`).
 */
export function backgroundVideoEmbedUrl(provider: unknown, videoId: unknown): string | null {
  if (provider === 'youtube' && typeof videoId === 'string' && YOUTUBE_ID.test(videoId)) {
    const query = new URLSearchParams({ autoplay: '1', mute: '1', loop: '1', playlist: videoId, controls: '0', playsinline: '1', rel: '0', disablekb: '1', modestbranding: '1' })
    return `https://www.youtube-nocookie.com/embed/${videoId}?${query.toString()}`
  }
  if (provider === 'vimeo' && typeof videoId === 'string' && VIMEO_ID.test(videoId)) {
    const query = new URLSearchParams({ background: '1', dnt: '1', autoplay: '1', muted: '1', loop: '1', playsinline: '1' })
    return `https://player.vimeo.com/video/${videoId}?${query.toString()}`
  }
  return null
}

/** An integer in [min, max], else the fallback. */
export function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
  return isNumber(value) && Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

/* ----------------------------------------------------------------------------------------------
 * B4 theme `layout.listing_columns`
 * -------------------------------------------------------------------------------------------- */

export const LISTING_COLUMN_OPTIONS = { desktop: [3, 4, 5], tablet: [2, 3, 4], mobile: [1, 2] } as const

/** Today's listing grid (`grid-cols-2 md:grid-cols-3`): 3 per row from 768 px, 2 below. */
export const DEFAULT_LISTING_COLUMNS = { desktop: 3, tablet: 3, mobile: 2 } as const satisfies ListingColumns

/** The theme's products per row with every device set; missing or invalid values take today's grid. */
export function normalizeListingColumns(value: unknown): ListingColumns {
  const source = isObject(value) ? value : {}
  const pick = <K extends keyof ListingColumns>(key: K): ListingColumns[K] =>
    ((LISTING_COLUMN_OPTIONS[key] as readonly number[]).includes(source[key] as number) ? source[key] : DEFAULT_LISTING_COLUMNS[key]) as ListingColumns[K]
  return { desktop: pick('desktop'), tablet: pick('tablet'), mobile: pick('mobile') }
}

/* ----------------------------------------------------------------------------------------------
 * B6 elements, motion, section shapes (contract §1)
 * -------------------------------------------------------------------------------------------- */

export const B6_ENUMS = {
  motionEntrance: ['none', 'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom'],
  shape: ['wave', 'curve', 'tilt', 'triangle', 'zigzag'],
  accordionStyle: ['plain', 'boxed'],
  tabsLayout: ['horizontal', 'vertical'],
  iconBoxLayout: ['top', 'left'],
  iconStyle: ['plain', 'circle', 'square'],
  iconListLayout: ['vertical', 'inline'],
  quoteStyle: ['plain', 'card', 'large'],
  noticeTone: ['info', 'success', 'warning', 'promo'],
  stepsLayout: ['horizontal', 'vertical'],
  /** B8a adds the stacked kinds. */
  chartKind: ['bar', 'column', 'line', 'area', 'pie', 'donut', 'stacked-column', 'stacked-bar'],
  chartUnitPosition: ['before', 'after'],
  chartShowValues: ['none', 'last', 'all-small'],
  galleryAspect: ['square', '4:3', '3:4', '16:9', 'auto'],
  galleryGap: ['sm', 'md', 'lg'],
  speed: ['slow', 'normal', 'fast'],
  marqueeDirection: ['left', 'right'],
  marqueeSeparator: ['dot', 'star', 'leaf', 'none'],
  categoryCardLayout: ['overlay', 'below'],
  spotlightLayout: ['image-left', 'image-right'],
  trustBadgesStyle: ['row', 'grid'],
} as const

/** Item counts and numeric bounds of the B6 props (min / max inclusive). */
export const B6_LIMITS = {
  motionDuration: { min: 200, max: 2000 },
  motionDelay: { min: 0, max: 2000 },
  shapeHeight: { min: 16, max: 200 },
  accordionItems: { min: 1, max: 20 },
  tabsItems: { min: 2, max: 8 },
  iconListItems: { min: 1, max: 20 },
  counterItems: { min: 1, max: 6 },
  counterValue: { min: 0, max: 1_000_000_000 },
  stepsItems: { min: 2, max: 8 },
  galleryImages: { min: 1, max: 30 },
  galleryColumns: { min: 2, max: 6 },
  carouselImages: { min: 1, max: 20 },
  carouselAutoplay: { min: 0, max: 15 },
  logos: { min: 2, max: 24 },
  mapHeight: { min: 200, max: 600 },
  mapZoom: { min: 3, max: 20 },
  hotspots: { min: 1, max: 8 },
  trustBadges: { min: 1, max: 6 },
  recentlyViewed: { min: 4, max: 12 },
  marqueeItems: { min: 1, max: 10 },
  chartLabels: { min: 1, max: 24 },
  chartSeries: { min: 1, max: 6 },
  chartPieLabels: 8,
  chartHeight: { min: 200, max: 600 },
  counterPrefix: 4,
} as const

/**
 * Maximum length of each B6 text prop (✱ = translatable). Item fields are named `<list>.*.<field>`,
 * chart labels `labels.*`. `counter` `items.*.prefix` and `chart` `unit` are not translated.
 */
export const B6_TEXT_LIMITS = {
  accordion: { 'items.*.title': 120, 'items.*.html': 5000 },
  tabs: { 'items.*.title': 60, 'items.*.html': 8000 },
  icon_box: { title: 120, text: 400 },
  icon_list: { 'items.*.text': 160 },
  quote: { text: 600, author: 80, role: 80 },
  notice: { title: 120, text: 400 },
  counter: { 'items.*.prefix': 4, 'items.*.suffix': 8, 'items.*.label': 60 },
  steps: { 'items.*.title': 80, 'items.*.text': 300 },
  chart: { title: 120, description: 300, 'labels.*': 40, 'series.*.name': 40, unit: 8 },
  gallery: { 'images.*.alt': 200, 'images.*.caption': 200 },
  image_carousel: { 'images.*.alt': 200, 'images.*.caption': 200 },
  logo_carousel: { 'logos.*.alt': 200 },
  map: { query: 200, title: 120 },
  category_card: { title: 120, button_label: 30 },
  product_spotlight: { badge: 24 },
  shop_the_look: { alt: 200, title: 120 },
  trust_badges: { 'items.*.title': 60, 'items.*.text': 120 },
  recently_viewed: { title: 120 },
  marquee: { 'items.*.text': 120 },
} as const

/** A list item's id: like a node id (`^[a-z][a-z0-9_-]{1,31}$`), unique within its list. */
export const ITEM_ID = /^[a-z][a-z0-9_-]{1,31}$/

/** A finite number with at most two decimals. */
export function hasTwoDecimals(value: unknown): value is number {
  return isNumber(value) && Math.abs(Math.round(value * 100) - value * 100) < 1e-6
}

/** B6 section `shape_top` / `shape_bottom`: null, or a valid shape (anything else is dropped to null). */
export function normalizeSectionShape(value: unknown): SectionShape | null {
  if (!isObject(value)) return null
  const shape = oneOf(value.shape, B6_ENUMS.shape)
  const color = normalizeColor(value.color)
  if (!shape || !color || !isInt(value.height, B6_LIMITS.shapeHeight.min, B6_LIMITS.shapeHeight.max)) return null
  return { shape, color, height: value.height, flip: value.flip === true }
}

/** Gallery `columns`: base 2–6 (default 3); tablet / mobile only when valid. */
export function normalizeGalleryColumns(value: unknown): { base: number; tablet?: number; mobile?: number } {
  const source = isObject(value) ? value : {}
  const { min, max } = B6_LIMITS.galleryColumns
  const out: { base: number; tablet?: number; mobile?: number } = { base: isInt(source.base, min, max) ? source.base : 3 }
  // Phones may show one column per row.
  if (isInt(source.tablet, 1, max)) out.tablet = source.tablet
  if (isInt(source.mobile, 1, max)) out.mobile = source.mobile
  return out
}

/** The items of a list prop that have a valid id (unique), in order; non-objects are skipped. */
export function listItems(value: unknown, max: number): Obj[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: Obj[] = []
  for (const item of value) {
    if (!isObject(item) || typeof item.id !== 'string' || !ITEM_ID.test(item.id) || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
    if (out.length >= max) break
  }
  return out
}

/** One problem with an element's props: the prop path (`items.2.title`) and a short code. */
export type PropProblem = { path: string; code: 'required' | 'invalid' | 'too_long' | 'too_few' | 'too_many' | 'out_of_range' | 'duplicate' }

type Problems = PropProblem[]

function text(problems: Problems, path: string, value: unknown, max: number, required = false) {
  if (typeof value !== 'string') problems.push({ path, code: 'invalid' })
  else if (value.length > max) problems.push({ path, code: 'too_long' })
  else if (required && value.trim() === '') problems.push({ path, code: 'required' })
}

function nullableText(problems: Problems, path: string, value: unknown, max: number) {
  if (value !== null) text(problems, path, value, max)
}

function enumOf(problems: Problems, path: string, value: unknown, options: readonly string[]) {
  if (!oneOf(value, options)) problems.push({ path, code: 'invalid' })
}

function flag(problems: Problems, path: string, value: unknown) {
  if (typeof value !== 'boolean') problems.push({ path, code: 'invalid' })
}

function int(problems: Problems, path: string, value: unknown, range: { min: number; max: number }) {
  if (!isInt(value, range.min, range.max)) problems.push({ path, code: isNumber(value) ? 'out_of_range' : 'invalid' })
}

function link(problems: Problems, path: string, value: unknown) {
  if (value !== null && !safeLink(value)) problems.push({ path, code: 'invalid' })
}

function icon(problems: Problems, path: string, value: unknown, nullable = false) {
  if (nullable && value === null) return
  if (!(ICON_NAMES as readonly unknown[]).includes(value)) problems.push({ path, code: 'invalid' })
}

function uuid(problems: Problems, path: string, value: unknown) {
  if (value === null || value === undefined || value === '') problems.push({ path, code: 'required' })
  else if (!isUuid(value)) problems.push({ path, code: 'invalid' })
}

/** Checks a list prop's shape and count, then each item with `each` (path `list.<index>`). */
function list(problems: Problems, path: string, value: unknown, range: { min: number; max: number }, each: (item: Obj, at: string) => void) {
  if (!Array.isArray(value)) {
    problems.push({ path, code: 'invalid' })
    return
  }
  if (value.length < range.min) problems.push({ path, code: 'too_few' })
  if (value.length > range.max) problems.push({ path, code: 'too_many' })
  const seen = new Set<string>()
  value.forEach((item, index) => {
    const at = `${path}.${index}`
    if (!isObject(item)) {
      problems.push({ path: at, code: 'invalid' })
      return
    }
    if (typeof item.id !== 'string' || !ITEM_ID.test(item.id)) problems.push({ path: `${at}.id`, code: 'invalid' })
    else if (seen.has(item.id)) problems.push({ path: `${at}.id`, code: 'duplicate' })
    else seen.add(item.id)
    each(item, at)
  })
}

/** Chart props: shape, counts, lengths and the pie / donut rules (contract §3). */
export function chartProblems(p: Obj): Problems {
  const problems: Problems = []
  const L = B6_TEXT_LIMITS.chart
  enumOf(problems, 'kind', p.kind, B6_ENUMS.chartKind)
  text(problems, 'title', p.title, L.title)
  text(problems, 'description', p.description, L.description)
  const labels = Array.isArray(p.labels) ? p.labels : null
  if (!labels) problems.push({ path: 'labels', code: 'invalid' })
  else {
    if (labels.length < B6_LIMITS.chartLabels.min) problems.push({ path: 'labels', code: 'too_few' })
    if (labels.length > B6_LIMITS.chartLabels.max) problems.push({ path: 'labels', code: 'too_many' })
    labels.forEach((label, i) => text(problems, `labels.${i}`, label, L['labels.*'], true))
  }
  list(problems, 'series', p.series, B6_LIMITS.chartSeries, (series, at) => {
    text(problems, `${at}.name`, series.name, L['series.*.name'])
    if (!Array.isArray(series.values)) problems.push({ path: `${at}.values`, code: 'invalid' })
    else {
      if (labels && series.values.length !== labels.length) problems.push({ path: `${at}.values`, code: 'invalid' })
      series.values.forEach((v, i) => {
        if (!isNumber(v) || Math.abs(v) > 1e12) problems.push({ path: `${at}.values.${i}`, code: 'invalid' })
      })
    }
  })
  const stacked = p.kind === 'stacked-column' || p.kind === 'stacked-bar'
  // B8a: a store source draws one series, so it is never stacked.
  if (stacked && isStoreSource(p.data_source)) problems.push({ path: 'kind', code: 'invalid' })
  if (stacked && !isStoreSource(p.data_source)) {
    // B8a: stacked kinds compare 2–6 parts of a whole; a negative part has no place in a stack.
    if (Array.isArray(p.series) && p.series.length < B8A_LIMITS.stackedSeries.min) problems.push({ path: 'series', code: 'too_few' })
    if (Array.isArray(p.series))
      p.series.forEach((series: unknown, s: number) => {
        if (isObject(series) && Array.isArray(series.values))
          series.values.forEach((v, i) => {
            if (isNumber(v) && v < 0) problems.push({ path: `series.${s}.values.${i}`, code: 'out_of_range' })
          })
      })
  }
  // B8a: absent on older documents (= manual).
  if (p.data_source !== undefined) enumOf(problems, 'data_source', p.data_source, B8A_ENUMS.chartDataSource)
  if (p.source_product_id !== undefined && p.source_product_id !== null) {
    // One product's reviews: a rating-breakdown chart only.
    if (!isUuid(p.source_product_id) || p.data_source !== 'store.rating_breakdown') problems.push({ path: 'source_product_id', code: 'invalid' })
  }
  if (p.kind === 'pie' || p.kind === 'donut') {
    if (Array.isArray(p.series) && p.series.length !== 1) problems.push({ path: 'series', code: 'too_many' })
    if (labels && labels.length > B6_LIMITS.chartPieLabels) problems.push({ path: 'labels', code: 'too_many' })
    if (Array.isArray(p.series))
      p.series.forEach((series: unknown, s: number) => {
        if (isObject(series) && Array.isArray(series.values))
          series.values.forEach((v, i) => {
            if (isNumber(v) && v < 0) problems.push({ path: `series.${s}.values.${i}`, code: 'out_of_range' })
          })
      })
  }
  text(problems, 'unit', p.unit, L.unit)
  enumOf(problems, 'unit_position', p.unit_position, B6_ENUMS.chartUnitPosition)
  flag(problems, 'y_starts_at_zero', p.y_starts_at_zero)
  enumOf(problems, 'show_values', p.show_values, B6_ENUMS.chartShowValues)
  flag(problems, 'show_legend', p.show_legend)
  flag(problems, 'show_table', p.show_table)
  int(problems, 'height', p.height, B6_LIMITS.chartHeight)
  return problems
}

/**
 * The client mirror of the server's B6 prop rules: every problem with an element's props (empty =
 * valid). The editor uses it for live validation; the server still decides on save. Types this
 * function does not know return [].
 */
export function b6PropProblems(type: string, props: unknown): PropProblem[] {
  const p: Obj = isObject(props) ? props : {}
  const problems: Problems = []
  const T = B6_TEXT_LIMITS
  switch (type) {
    case 'accordion':
      list(problems, 'items', p.items, B6_LIMITS.accordionItems, (item, at) => {
        text(problems, `${at}.title`, item.title, T.accordion['items.*.title'], true)
        text(problems, `${at}.html`, item.html, T.accordion['items.*.html'])
      })
      flag(problems, 'open_first', p.open_first)
      flag(problems, 'allow_multiple', p.allow_multiple)
      enumOf(problems, 'style', p.style, B6_ENUMS.accordionStyle)
      break
    case 'tabs':
      list(problems, 'items', p.items, B6_LIMITS.tabsItems, (item, at) => {
        text(problems, `${at}.title`, item.title, T.tabs['items.*.title'], true)
        text(problems, `${at}.html`, item.html, T.tabs['items.*.html'])
      })
      enumOf(problems, 'layout', p.layout, B6_ENUMS.tabsLayout)
      break
    case 'icon_box':
      icon(problems, 'icon', p.icon)
      text(problems, 'title', p.title, T.icon_box.title)
      text(problems, 'text', p.text, T.icon_box.text)
      link(problems, 'link', p.link)
      enumOf(problems, 'layout', p.layout, B6_ENUMS.iconBoxLayout)
      enumOf(problems, 'icon_style', p.icon_style, B6_ENUMS.iconStyle)
      break
    case 'icon_list':
      list(problems, 'items', p.items, B6_LIMITS.iconListItems, (item, at) => {
        icon(problems, `${at}.icon`, item.icon)
        text(problems, `${at}.text`, item.text, T.icon_list['items.*.text'], true)
        link(problems, `${at}.link`, item.link)
      })
      enumOf(problems, 'layout', p.layout, B6_ENUMS.iconListLayout)
      break
    case 'quote':
      text(problems, 'text', p.text, T.quote.text, true)
      text(problems, 'author', p.author, T.quote.author)
      text(problems, 'role', p.role, T.quote.role)
      enumOf(problems, 'style', p.style, B6_ENUMS.quoteStyle)
      break
    case 'notice':
      enumOf(problems, 'tone', p.tone, B6_ENUMS.noticeTone)
      text(problems, 'title', p.title, T.notice.title)
      text(problems, 'text', p.text, T.notice.text)
      flag(problems, 'show_icon', p.show_icon)
      break
    case 'counter':
      list(problems, 'items', p.items, B6_LIMITS.counterItems, (item, at) => {
        if (!hasTwoDecimals(item.value) || item.value < B6_LIMITS.counterValue.min || item.value > B6_LIMITS.counterValue.max)
          problems.push({ path: `${at}.value`, code: isNumber(item.value) ? 'out_of_range' : 'invalid' })
        text(problems, `${at}.prefix`, item.prefix, T.counter['items.*.prefix'])
        text(problems, `${at}.suffix`, item.suffix, T.counter['items.*.suffix'])
        text(problems, `${at}.label`, item.label, T.counter['items.*.label'])
      })
      flag(problems, 'animate', p.animate)
      break
    case 'steps':
      list(problems, 'items', p.items, B6_LIMITS.stepsItems, (item, at) => {
        text(problems, `${at}.title`, item.title, T.steps['items.*.title'], true)
        text(problems, `${at}.text`, item.text, T.steps['items.*.text'])
        icon(problems, `${at}.icon`, item.icon, true)
      })
      enumOf(problems, 'layout', p.layout, B6_ENUMS.stepsLayout)
      flag(problems, 'numbered', p.numbered)
      break
    case 'chart':
      return chartProblems(p)
    case 'gallery':
      list(problems, 'images', p.images, B6_LIMITS.galleryImages, (item, at) => {
        uuid(problems, `${at}.media_id`, item.media_id)
        text(problems, `${at}.alt`, item.alt, T.gallery['images.*.alt'])
        text(problems, `${at}.caption`, item.caption, T.gallery['images.*.caption'])
      })
      if (!isObject(p.columns) || !isInt(p.columns.base, B6_LIMITS.galleryColumns.min, B6_LIMITS.galleryColumns.max)) problems.push({ path: 'columns.base', code: 'invalid' })
      else {
        for (const device of ['tablet', 'mobile'] as const) {
          const v = p.columns[device]
          if (v !== undefined && !isInt(v, 1, B6_LIMITS.galleryColumns.max)) problems.push({ path: `columns.${device}`, code: 'invalid' })
        }
      }
      enumOf(problems, 'aspect', p.aspect, B6_ENUMS.galleryAspect)
      flag(problems, 'lightbox', p.lightbox)
      enumOf(problems, 'gap', p.gap, B6_ENUMS.galleryGap)
      break
    case 'image_carousel':
      list(problems, 'images', p.images, B6_LIMITS.carouselImages, (item, at) => {
        uuid(problems, `${at}.media_id`, item.media_id)
        text(problems, `${at}.alt`, item.alt, T.image_carousel['images.*.alt'])
        text(problems, `${at}.caption`, item.caption, T.image_carousel['images.*.caption'])
        link(problems, `${at}.link`, item.link)
      })
      int(problems, 'autoplay', p.autoplay, B6_LIMITS.carouselAutoplay)
      flag(problems, 'show_dots', p.show_dots)
      flag(problems, 'show_arrows', p.show_arrows)
      enumOf(problems, 'aspect', p.aspect, B6_ENUMS.galleryAspect)
      break
    case 'logo_carousel':
      list(problems, 'logos', p.logos, B6_LIMITS.logos, (item, at) => {
        uuid(problems, `${at}.media_id`, item.media_id)
        text(problems, `${at}.alt`, item.alt, T.logo_carousel['logos.*.alt'])
        link(problems, `${at}.link`, item.link)
      })
      flag(problems, 'grayscale', p.grayscale)
      enumOf(problems, 'speed', p.speed, B6_ENUMS.speed)
      break
    case 'map':
      text(problems, 'query', p.query, T.map.query, true)
      text(problems, 'title', p.title, T.map.title)
      int(problems, 'height', p.height, B6_LIMITS.mapHeight)
      int(problems, 'zoom', p.zoom, B6_LIMITS.mapZoom)
      break
    case 'category_card':
      uuid(problems, 'category_id', p.category_id)
      if (p.media_id !== null && !isUuid(p.media_id)) problems.push({ path: 'media_id', code: 'invalid' })
      nullableText(problems, 'title', p.title, T.category_card.title)
      text(problems, 'button_label', p.button_label, T.category_card.button_label)
      enumOf(problems, 'layout', p.layout, B6_ENUMS.categoryCardLayout)
      break
    case 'product_spotlight':
      uuid(problems, 'product_id', p.product_id)
      enumOf(problems, 'layout', p.layout, B6_ENUMS.spotlightLayout)
      flag(problems, 'show_description', p.show_description)
      text(problems, 'badge', p.badge, T.product_spotlight.badge)
      break
    case 'shop_the_look':
      uuid(problems, 'media_id', p.media_id)
      text(problems, 'alt', p.alt, T.shop_the_look.alt)
      text(problems, 'title', p.title, T.shop_the_look.title)
      list(problems, 'hotspots', p.hotspots, B6_LIMITS.hotspots, (item, at) => {
        for (const axis of ['x', 'y'] as const) {
          const v = item[axis]
          if (!hasTwoDecimals(v) || v < 0 || v > 100) problems.push({ path: `${at}.${axis}`, code: isNumber(v) ? 'out_of_range' : 'invalid' })
        }
        uuid(problems, `${at}.product_id`, item.product_id)
      })
      break
    case 'trust_badges':
      list(problems, 'items', p.items, B6_LIMITS.trustBadges, (item, at) => {
        icon(problems, `${at}.icon`, item.icon)
        text(problems, `${at}.title`, item.title, T.trust_badges['items.*.title'], true)
        text(problems, `${at}.text`, item.text, T.trust_badges['items.*.text'])
      })
      enumOf(problems, 'style', p.style, B6_ENUMS.trustBadgesStyle)
      break
    case 'recently_viewed':
      text(problems, 'title', p.title, T.recently_viewed.title)
      int(problems, 'limit', p.limit, B6_LIMITS.recentlyViewed)
      break
    case 'marquee':
      list(problems, 'items', p.items, B6_LIMITS.marqueeItems, (item, at) => text(problems, `${at}.text`, item.text, T.marquee['items.*.text'], true))
      enumOf(problems, 'speed', p.speed, B6_ENUMS.speed)
      enumOf(problems, 'direction', p.direction, B6_ENUMS.marqueeDirection)
      enumOf(problems, 'separator', p.separator, B6_ENUMS.marqueeSeparator)
      break
    default:
      // B8a types (and [] for every other type), so callers of this function check them too.
      return b8aPropProblems(type, props)
  }
  return problems
}

/* ----------------------------------------------------------------------------------------------
 * B8a elements (contract §1): selling blocks, trust & people, progress bars, chart additions
 * -------------------------------------------------------------------------------------------- */

export const B8A_ENUMS = {
  chartDataSource: ['manual', 'store.products_per_category', 'store.rating_breakdown'],
  beforeAfterOrientation: ['horizontal', 'vertical'],
  beforeAfterAspect: ['1:1', '4:3', '3:2', '16:9'],
  comparisonCell: ['yes', 'no', 'text'],
  flashSaleStyle: ['bar', 'card'],
  teamLinkKind: ['facebook', 'instagram', 'linkedin', 'x', 'youtube', 'tiktok', 'website', 'email'],
  teamStyle: ['card', 'plain', 'circle'],
  reviewSource: ['latest', 'top_rated', 'product'],
  reviewLayout: ['grid', 'carousel'],
  photoGap: ['none', 'sm', 'md'],
  photoHover: ['none', 'zoom', 'overlay'],
  weekDay: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
  weekStarts: ['sat', 'sun', 'mon'],
  progressStyle: ['bar', 'ring'],
} as const

/** Item counts and numeric bounds of the B8a props (min / max inclusive). */
export const B8A_LIMITS = {
  plans: { min: 1, max: 4 },
  planFeatures: { min: 0, max: 12 },
  beforeAfterStart: { min: 0, max: 100 },
  comparisonColumns: { min: 2, max: 4 },
  comparisonRows: { min: 1, max: 20 },
  flashSaleProducts: { min: 2, max: 8 },
  bundleItems: { min: 2, max: 4 },
  teamMembers: { min: 1, max: 12 },
  teamLinks: { min: 0, max: 5 },
  teamColumns: { min: 2, max: 4 },
  reviewMinRating: { min: 1, max: 5 },
  reviewLimit: { min: 3, max: 12 },
  photoImages: { min: 3, max: 24 },
  photoColumns: { min: 3, max: 6 },
  progressItems: { min: 1, max: 10 },
  progressValue: { min: 0, max: 100 },
  stackedSeries: { min: 2, max: 6 },
  /** Store-source charts: at most this many categories. */
  storeChartLabels: 12,
} as const

/** Maximum length of each B8a text prop (✱ = translatable; nested list fields with `*`). Team `members.*.name` is not translated. */
export const B8A_TEXT_LIMITS = {
  pricing_table: {
    'plans.*.name': 60,
    'plans.*.price_text': 24,
    'plans.*.period': 24,
    'plans.*.description': 200,
    'plans.*.features.*.text': 120,
    'plans.*.button.label': 30,
    'plans.*.badge': 24,
  },
  before_after: { 'before.alt': 200, 'after.alt': 200, before_label: 24, after_label: 24 },
  comparison_table: { 'columns.*.title': 60, 'rows.*.label': 80, 'rows.*.cells.*.text': 60 },
  flash_sale_bar: { title: 80, text: 160, 'button.label': 30 },
  bundle: { title: 80, text: 200, button_label: 30 },
  team: { 'members.*.name': 80, 'members.*.role': 80, 'members.*.bio': 300 },
  review_wall: { title: 120 },
  photo_grid: { 'images.*.alt': 200, 'profile.label': 60 },
  store_hours: { title: 80, note: 200 },
  progress_bars: { 'items.*.label': 60 },
} as const

/** A NUMERIC money string: ≥ 0, at most two decimals ("0", "1250", "99.5", "99.50"). */
const MONEY = /^\d{1,12}(\.\d{1,2})?$/

export function isMoneyString(value: unknown): value is string {
  return typeof value === 'string' && MONEY.test(value)
}

/** "HH:MM", 00:00–23:59. */
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isTime(value: unknown): value is string {
  return typeof value === 'string' && TIME.test(value)
}

/** Minutes since midnight of a valid "HH:MM", else null. */
export function timeMinutes(value: unknown): number | null {
  if (!isTime(value)) return null
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
}

const EMAIL_LINK = /^mailto:[^\s@<>"'\\/?#]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/
const HTTPS_URL = /^https:\/\/[^/\s\\<>"]/
const HTTP_URL = /^https?:\/\/[^/\s\\<>"]/i

/** Longest team link (backend rule). */
export const TEAM_LINK_MAX = 255

/**
 * A team member's link by kind: `email` → `mailto:<address>` (a plain address, no query),
 * `website` an absolute http(s) URL, the social kinds https only; at most 255 characters.
 * Anything else is null.
 */
export function teamLinkUrl(kind: unknown, url: unknown): string | null {
  if (typeof url !== 'string' || url.length > TEAM_LINK_MAX || /[\s<>"\\]/.test(url)) return null
  if (kind === 'email') return EMAIL_LINK.test(url) ? url : null
  if (kind === 'website') return HTTP_URL.test(url) ? url : null
  if (!oneOf(kind, B8A_ENUMS.teamLinkKind)) return null
  return HTTPS_URL.test(url) ? url : null
}

/** Whether a chart's `data_source` is one of the store counts (resolved into `data[id]`). */
export function isStoreSource(value: unknown): value is 'store.products_per_category' | 'store.rating_breakdown' {
  return value === 'store.products_per_category' || value === 'store.rating_breakdown'
}

/** A number with at most one decimal (progress values). */
export function hasOneDecimal(value: unknown): value is number {
  return isNumber(value) && Math.abs(Math.round(value * 10) - value * 10) < 1e-6
}

/** `columns` of team (base 2–4) and photo grid (base 3–6): base in range (else `fallback`); tablet / mobile 1…max when valid. */
export function normalizeColumns(value: unknown, range: { min: number; max: number }, fallback: number): { base: number; tablet?: number; mobile?: number } {
  const source = isObject(value) ? value : {}
  const out: { base: number; tablet?: number; mobile?: number } = { base: isInt(source.base, range.min, range.max) ? source.base : fallback }
  if (isInt(source.tablet, 1, range.max)) out.tablet = source.tablet
  if (isInt(source.mobile, 1, range.max)) out.mobile = source.mobile
  return out
}

function columnsProblems(problems: Problems, value: unknown, range: { min: number; max: number }) {
  if (!isObject(value) || !isInt(value.base, range.min, range.max)) {
    problems.push({ path: 'columns.base', code: isObject(value) && isNumber(value.base) ? 'out_of_range' : 'invalid' })
    return
  }
  for (const device of ['tablet', 'mobile'] as const) {
    const v = value[device]
    if (v !== undefined && !isInt(v, 1, range.max)) problems.push({ path: `columns.${device}`, code: 'invalid' })
  }
}

/** `null | {label, url}` with a safe url (B8a buttons). */
function button(problems: Problems, path: string, value: unknown, max: number) {
  if (value === null) return
  if (!isObject(value)) {
    problems.push({ path, code: 'invalid' })
    return
  }
  text(problems, `${path}.label`, value.label, max, true)
  if (!safeUrl(value.url)) problems.push({ path: `${path}.url`, code: 'invalid' })
}

function nullableUuid(problems: Problems, path: string, value: unknown) {
  if (value !== null && !isUuid(value)) problems.push({ path, code: 'invalid' })
}

const WEEK = B8A_ENUMS.weekDay

/**
 * The client mirror of the server's B8a prop rules (empty = valid). Types this function does not
 * know return []. `b6PropProblems` falls through to it, so existing callers check B8a types too.
 */
export function b8aPropProblems(type: string, props: unknown): PropProblem[] {
  const p: Obj = isObject(props) ? props : {}
  const problems: Problems = []
  const T = B8A_TEXT_LIMITS
  switch (type) {
    case 'pricing_table':
      list(problems, 'plans', p.plans, B8A_LIMITS.plans, (plan, at) => {
        const L = T.pricing_table
        text(problems, `${at}.name`, plan.name, L['plans.*.name'], true)
        if (plan.price !== null && !isMoneyString(plan.price)) problems.push({ path: `${at}.price`, code: 'invalid' })
        text(problems, `${at}.price_text`, plan.price_text, L['plans.*.price_text'])
        text(problems, `${at}.period`, plan.period, L['plans.*.period'])
        text(problems, `${at}.description`, plan.description, L['plans.*.description'])
        list(problems, `${at}.features`, plan.features, B8A_LIMITS.planFeatures, (feature, f) => {
          text(problems, `${f}.text`, feature.text, L['plans.*.features.*.text'], true)
          flag(problems, `${f}.included`, feature.included)
        })
        button(problems, `${at}.button`, plan.button, L['plans.*.button.label'])
        flag(problems, `${at}.highlighted`, plan.highlighted)
        text(problems, `${at}.badge`, plan.badge, L['plans.*.badge'])
      })
      break
    case 'before_after': {
      const L = T.before_after
      for (const side of ['before', 'after'] as const) {
        const image = p[side]
        if (!isObject(image)) problems.push({ path: side, code: 'invalid' })
        else {
          uuid(problems, `${side}.media_id`, image.media_id)
          text(problems, `${side}.alt`, image.alt, L[`${side}.alt`])
        }
      }
      text(problems, 'before_label', p.before_label, L.before_label)
      text(problems, 'after_label', p.after_label, L.after_label)
      int(problems, 'start', p.start, B8A_LIMITS.beforeAfterStart)
      enumOf(problems, 'orientation', p.orientation, B8A_ENUMS.beforeAfterOrientation)
      enumOf(problems, 'aspect', p.aspect, B8A_ENUMS.beforeAfterAspect)
      break
    }
    case 'comparison_table': {
      const L = T.comparison_table
      const columnIds: string[] = []
      list(problems, 'columns', p.columns, B8A_LIMITS.comparisonColumns, (column, at) => {
        if (typeof column.id === 'string') columnIds.push(column.id)
        text(problems, `${at}.title`, column.title, L['columns.*.title'], true)
        nullableUuid(problems, `${at}.product_id`, column.product_id)
        flag(problems, `${at}.highlighted`, column.highlighted)
      })
      list(problems, 'rows', p.rows, B8A_LIMITS.comparisonRows, (row, at) => {
        text(problems, `${at}.label`, row.label, L['rows.*.label'], true)
        if (!isObject(row.cells)) {
          problems.push({ path: `${at}.cells`, code: 'invalid' })
          return
        }
        const cells = row.cells
        for (const key of Object.keys(cells)) if (!columnIds.includes(key)) problems.push({ path: `${at}.cells.${key}`, code: 'invalid' })
        for (const id of columnIds) {
          const cell = cells[id]
          if (!isObject(cell)) {
            problems.push({ path: `${at}.cells.${id}`, code: 'required' })
            continue
          }
          enumOf(problems, `${at}.cells.${id}.kind`, cell.kind, B8A_ENUMS.comparisonCell)
          text(problems, `${at}.cells.${id}.text`, cell.text, L['rows.*.cells.*.text'])
        }
      })
      flag(problems, 'show_prices', p.show_prices)
      flag(problems, 'show_buttons', p.show_buttons)
      break
    }
    case 'flash_sale_bar':
      nullableUuid(problems, 'promotion_id', p.promotion_id)
      text(problems, 'title', p.title, T.flash_sale_bar.title)
      text(problems, 'text', p.text, T.flash_sale_bar.text)
      flag(problems, 'show_products', p.show_products)
      int(problems, 'product_limit', p.product_limit, B8A_LIMITS.flashSaleProducts)
      enumOf(problems, 'style', p.style, B8A_ENUMS.flashSaleStyle)
      button(problems, 'button', p.button, T.flash_sale_bar['button.label'])
      break
    case 'bundle': {
      const products = new Set<string>()
      list(problems, 'items', p.items, B8A_LIMITS.bundleItems, (item, at) => {
        uuid(problems, `${at}.product_id`, item.product_id)
        if (isUuid(item.product_id)) {
          if (products.has(item.product_id)) problems.push({ path: `${at}.product_id`, code: 'duplicate' })
          products.add(item.product_id)
        }
      })
      text(problems, 'title', p.title, T.bundle.title)
      text(problems, 'text', p.text, T.bundle.text)
      text(problems, 'button_label', p.button_label, T.bundle.button_label)
      break
    }
    case 'team':
      list(problems, 'members', p.members, B8A_LIMITS.teamMembers, (member, at) => {
        const L = T.team
        nullableUuid(problems, `${at}.media_id`, member.media_id)
        text(problems, `${at}.name`, member.name, L['members.*.name'], true)
        text(problems, `${at}.role`, member.role, L['members.*.role'])
        text(problems, `${at}.bio`, member.bio, L['members.*.bio'])
        list(problems, `${at}.links`, member.links, B8A_LIMITS.teamLinks, (item, l) => {
          enumOf(problems, `${l}.kind`, item.kind, B8A_ENUMS.teamLinkKind)
          if (oneOf(item.kind, B8A_ENUMS.teamLinkKind) && !teamLinkUrl(item.kind, item.url)) problems.push({ path: `${l}.url`, code: 'invalid' })
        })
      })
      columnsProblems(problems, p.columns, B8A_LIMITS.teamColumns)
      enumOf(problems, 'style', p.style, B8A_ENUMS.teamStyle)
      break
    case 'review_wall':
      enumOf(problems, 'source', p.source, B8A_ENUMS.reviewSource)
      if (p.source === 'product') uuid(problems, 'product_id', p.product_id)
      else nullableUuid(problems, 'product_id', p.product_id)
      int(problems, 'min_rating', p.min_rating, B8A_LIMITS.reviewMinRating)
      int(problems, 'limit', p.limit, B8A_LIMITS.reviewLimit)
      enumOf(problems, 'layout', p.layout, B8A_ENUMS.reviewLayout)
      flag(problems, 'show_product', p.show_product)
      flag(problems, 'show_summary', p.show_summary)
      text(problems, 'title', p.title, T.review_wall.title)
      break
    case 'photo_grid':
      list(problems, 'images', p.images, B8A_LIMITS.photoImages, (image, at) => {
        uuid(problems, `${at}.media_id`, image.media_id)
        text(problems, `${at}.alt`, image.alt, T.photo_grid['images.*.alt'])
        link(problems, `${at}.link`, image.link)
      })
      columnsProblems(problems, p.columns, B8A_LIMITS.photoColumns)
      enumOf(problems, 'gap', p.gap, B8A_ENUMS.photoGap)
      if (p.profile !== null) {
        if (!isObject(p.profile)) problems.push({ path: 'profile', code: 'invalid' })
        else {
          text(problems, 'profile.label', p.profile.label, T.photo_grid['profile.label'], true)
          if (!safeUrl(p.profile.url)) problems.push({ path: 'profile.url', code: 'invalid' })
        }
      }
      enumOf(problems, 'hover', p.hover, B8A_ENUMS.photoHover)
      break
    case 'store_hours':
      if (!Array.isArray(p.days)) problems.push({ path: 'days', code: 'invalid' })
      else if (p.days.length !== WEEK.length) problems.push({ path: 'days', code: p.days.length < WEEK.length ? 'too_few' : 'too_many' })
      else
        p.days.forEach((day: unknown, i: number) => {
          const at = `days.${i}`
          if (!isObject(day)) {
            problems.push({ path: at, code: 'invalid' })
            return
          }
          if (day.day !== WEEK[i]) problems.push({ path: `${at}.day`, code: 'invalid' })
          flag(problems, `${at}.closed`, day.closed)
          if (!isTime(day.open)) problems.push({ path: `${at}.open`, code: 'invalid' })
          if (!isTime(day.close)) problems.push({ path: `${at}.close`, code: 'invalid' })
        })
      text(problems, 'title', p.title, T.store_hours.title)
      text(problems, 'note', p.note, T.store_hours.note)
      flag(problems, 'show_open_now', p.show_open_now)
      flag(problems, 'highlight_today', p.highlight_today)
      enumOf(problems, 'week_starts', p.week_starts, B8A_ENUMS.weekStarts)
      break
    case 'progress_bars':
      list(problems, 'items', p.items, B8A_LIMITS.progressItems, (item, at) => {
        text(problems, `${at}.label`, item.label, T.progress_bars['items.*.label'], true)
        if (!hasOneDecimal(item.value) || item.value < B8A_LIMITS.progressValue.min || item.value > B8A_LIMITS.progressValue.max)
          problems.push({ path: `${at}.value`, code: isNumber(item.value) ? 'out_of_range' : 'invalid' })
      })
      enumOf(problems, 'style', p.style, B8A_ENUMS.progressStyle)
      flag(problems, 'show_value', p.show_value)
      flag(problems, 'animate', p.animate)
      break
    default:
      return []
  }
  return problems
}

/** Every problem with an element's props, B6 and B8a rules (empty = valid; unknown types []). */
export function elementPropProblems(type: string, props: unknown): PropProblem[] {
  return b6PropProblems(type, props)
}
