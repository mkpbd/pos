/*
 * Client checks of one builder node, mirroring the server (BuilderDocumentSchema::normalize,
 * SectionConfigRules, the homepage section rules). Paths are relative to the node, e.g.
 * `props.text`, `props.config.limit`, `props.items`, `translations.bn.title`, `schedule.ends_at`.
 * Document-wide rules (unique ids and anchors, limits) are the editor's and the server's job.
 */

import type { SectionConfigs, SectionType, SectionTypeInfo } from '@/features/storefront/api'
import { validateSectionDraft } from '@/features/storefront/components/section-draft'
import { isWrappedSectionType, matchesTranslatable, NODE_ID } from '@/storefront/builder/registry'
import type { Column, DocumentContext, Element, Section, WrappedElement, WrappedSectionType } from '@/storefront/builder/types'
import { ICON_NAMES } from '@/storefront/builder/icons'
import { B8A_TYPES as B8A_TYPE_LIST } from '@/storefront/builder/elements/b8a-types'
import {
  B4_ENUMS,
  B6_LIMITS,
  B6_TEXT_LIMITS,
  B8A_LIMITS,
  B8A_TEXT_LIMITS,
  B8B_LIMITS,
  B8B_TEXT_LIMITS,
  b8bPropProblems,
  b6PropProblems,
  b8aPropProblems,
  ENUMS,
  ORDER_FORM_LIMITS,
  ORDER_FORM_TEXT_LIMITS,
  orderFormPropProblems,
  isUuid,
  normalizeColor,
  normalizeSectionShape,
  normalizeWidthValue,
  parseVideoUrl,
  safeUrl,
  type PropProblem,
} from '@/storefront/builder/validate'
import type { BuilderNode, Problem } from './types'

/** Text limits of the basic elements (backend ElementRegistry::TEXT_LIMITS). */
export const TEXT_LIMITS = { heading: 200, text: 20000, buttonLabel: 60, alt: 200 } as const
export const SECTION_TITLE_MAX = 120
export const SECTION_SUBTITLE_MAX = 255
export const DIVIDER_THICKNESS = { min: 1, max: 10 } as const
export const DIVIDER_WIDTH = { min: 10, max: 100 } as const
export const ANCHOR_PATTERN = /^[a-z][a-z0-9-]{0,59}$/
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/
const HEX6 = /^#[0-9a-f]{6}$/i

/** B4 element types (contract §2). */
export const B4_TYPES: ReadonlySet<string> = new Set([
  'video', 'icon', 'countdown', 'discount', 'cta', 'search_box', 'promo_card', 'logo', 'menu', 'account_link', 'wishlist_link', 'cart_icon',
  'language_switch', 'announcement', 'social_icons', 'payment_icons', 'contact_block', 'copyright', 'newsletter_form', 'faq_list', 'contact_form', 'custom_html',
])

/** B4 translatable props and their maximum length (backend ElementRegistry::TRANSLATABLE; the base prop has the same limit). */
export const B4_TEXT_LIMITS: Record<string, Record<string, number>> = {
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
}

/** Other B4 bounds (backend ElementRegistry). */
export const B4_BOUNDS = {
  videoUrl: 500,
  videoStart: { min: 0, max: 86_400 },
  iconSize: { min: 16, max: 128 },
  logoHeight: { min: 24, max: 96 },
  socialSize: { min: 16, max: 48 },
  paymentHeight: { min: 16, max: 48 },
  customHtml: 20_000,
} as const

/** B6 element types (contract §1). */
export const B6_TYPES: ReadonlySet<string> = new Set([
  'accordion', 'tabs', 'icon_box', 'icon_list', 'quote', 'notice', 'counter', 'steps', 'chart', 'gallery', 'image_carousel', 'logo_carousel', 'map',
  'category_card', 'product_spotlight', 'shop_the_look', 'trust_badges', 'recently_viewed', 'marquee',
])

/** B8a element types (contract §1). */
export const B8A_TYPES: ReadonlySet<string> = new Set(B8A_TYPE_LIST)

/** B8b element types (contract §2). */
export const B8B_TYPES: ReadonlySet<string> = new Set(['form'])

/** P2a element types: the one-product order form. */
export const P2A_TYPES: ReadonlySet<string> = new Set(['order_form'])

/** B6 / B8a props that are not translated although they have a text limit (a person's name isn't). */
const B6_NOT_TRANSLATED: Record<string, readonly string[]> = { counter: ['items.*.prefix'], chart: ['unit'], team: ['members.*.name'] }

const B6_TEXTS = { ...B6_TEXT_LIMITS, ...B8A_TEXT_LIMITS, form: B8B_TEXT_LIMITS.form, order_form: ORDER_FORM_TEXT_LIMITS } as Record<string, Record<string, number>>

/**
 * Translatable fields of an element type with their maximum length (backend ElementRegistry::translatable).
 * B6 list fields are patterns (`items.*.title`, `labels.*`); see `translationLimit`.
 */
export function translatableFields(type: string): Record<string, number> {
  const b6 = B6_TEXTS[type]
  if (b6) return Object.fromEntries(Object.entries(b6).filter(([field]) => !(B6_NOT_TRANSLATED[type] ?? []).includes(field)))
  const b4 = B4_TEXT_LIMITS[type]
  if (b4) return b4
  switch (type) {
    case 'heading':
      return { text: TEXT_LIMITS.heading }
    case 'text':
      return { html: TEXT_LIMITS.text }
    case 'image':
      return { alt: TEXT_LIMITS.alt }
    case 'button':
      return { label: TEXT_LIMITS.buttonLabel }
  }
  if (!isWrappedSectionType(type)) return {}
  const fields: Record<string, number> = { title: SECTION_TITLE_MAX, subtitle: SECTION_SUBTITLE_MAX }
  if (type === 'rich_text') fields.body_html = 50000
  if (type === 'newsletter') Object.assign(fields, { text: 255, button_label: 30 })
  return fields
}

/** Banner placement and counts of the banner sections (backend SectionType::itemLimits). */
export const BANNER_SECTIONS: Partial<Record<WrappedSectionType, Pick<SectionTypeInfo, 'banner_placement' | 'items'>>> = {
  hero_slider: { banner_placement: 'hero_slider', items: { min: 1, max: 10 } },
  banner_grid: { banner_placement: 'home_promo', items: { min: 2, max: 8 } },
}

/** The homepage editor's description of a section type, enough for its shared forms and checks. */
export function sectionInfo(type: WrappedSectionType, label = '', defaults: SectionTypeInfo['defaults'] = {} as SectionTypeInfo['defaults']): SectionTypeInfo {
  const banners = BANNER_SECTIONS[type]
  return { type: type as SectionType, label, description: '', banner_placement: banners?.banner_placement ?? null, items: banners?.items ?? null, defaults }
}

/** Homepage form error key → node path. */
function wrappedPath(key: string): string {
  if (key === 'banner_ids' || key === 'item_ids') return 'props.items'
  if (key.startsWith('config.') || key === 'title' || key === 'subtitle') return `props.${key}`
  return key
}

function validateWrapped(node: WrappedElement, add: (path: string, message: string) => void) {
  const { title, subtitle, config, items } = node.props
  if (title !== null && title.length > SECTION_TITLE_MAX) add('props.title', `At most ${SECTION_TITLE_MAX} characters.`)
  if (subtitle !== null && subtitle.length > SECTION_SUBTITLE_MAX) add('props.subtitle', `At most ${SECTION_SUBTITLE_MAX} characters.`)

  const errors = validateSectionDraft(sectionInfo(node.type), {
    title: title ?? '',
    subtitle: subtitle ?? '',
    config: config as SectionTypeInfo['defaults'],
    bannerIds: items.map((i) => i.item_id),
    items: items.map((i) => ({ id: i.item_id, name: '' })),
    isEnabled: true,
    startsAt: '',
    endsAt: '',
    bn: {},
  })
  for (const [key, message] of Object.entries(errors)) add(wrappedPath(key), message)

  if (node.type === 'newsletter') {
    const c = config as SectionConfigs['newsletter']
    const label = typeof c.button_label === 'string' ? c.button_label.trim() : ''
    if (!label) add('props.config.button_label', 'Enter the button label.')
    else if (label.length > 30) add('props.config.button_label', 'At most 30 characters.')
    if (!HEX6.test(String(c.background))) add('props.config.background', 'Use a colour such as #c2410c.')
    if (!HEX6.test(String(c.foreground))) add('props.config.foreground', 'Use a colour such as #ffffff.')
  }
  if (node.type === 'rich_text' || node.type === 'features_strip' || node.type === 'testimonials') {
    const background = (config as { background?: string | null }).background
    if (background != null && !HEX6.test(background)) add('props.config.background', 'Use a colour such as #f3f7fa.')
  }
}

function validateLink(link: unknown, required: boolean, add: (path: string, message: string) => void) {
  if (link === null && !required) return
  const url = typeof link === 'object' && link !== null ? (link as { url?: unknown }).url : undefined
  if (required && (typeof url !== 'string' || url.trim() === '')) return add('props.link', 'Choose where the button leads.')
  if (safeUrl(url) === null) add('props.link', 'Use a site path such as /sale or an http(s) URL.')
}

function textRule(value: unknown, min: number, max: number, path: string, add: (path: string, message: string) => void, emptyMessage: string) {
  const text = typeof value === 'string' ? value : ''
  if (min > 0 && text.trim().length < min) add(path, emptyMessage)
  else if (text.length > max) add(path, `At most ${max} characters.`)
}

function enumRule(value: unknown, options: readonly string[], path: string, add: (path: string, message: string) => void) {
  if (typeof value !== 'string' || !options.includes(value)) add(path, `Choose one of: ${options.join(', ')}.`)
}

function intRule(value: unknown, min: number, max: number, path: string, add: (path: string, message: string) => void) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) add(path, `Enter a whole number from ${min} to ${max}.`)
}

function linkRule(link: unknown, required: boolean, path: string, add: (path: string, message: string) => void, missing = 'Choose where it leads.') {
  if (link === null && !required) return
  const url = typeof link === 'object' && link !== null ? (link as { url?: unknown }).url : undefined
  if (required && (typeof url !== 'string' || url.trim() === '')) return add(path, missing)
  if (safeUrl(url) === null) add(path, 'Use a site path such as /sale or an http(s) URL.')
}

function boolRule(value: unknown, path: string, add: (path: string, message: string) => void) {
  if (typeof value !== 'boolean') add(path, 'This is on or off.')
}

function colorRule(value: unknown, path: string, add: (path: string, message: string) => void) {
  if (value !== null && normalizeColor(value) === undefined) add(path, 'Use a colour such as #1f2937 or a theme colour.')
}

function nullableText(value: unknown, max: number, path: string, add: (path: string, message: string) => void) {
  if (value !== null) textRule(value, 0, max, path, add, '')
}

/** B4 elements (contract §2), mirroring the backend normalizer and the reference checks that can be done offline. */
function validateB4(node: Element, add: (path: string, message: string) => void, icons: readonly string[]) {
  const p = node.props as Record<string, unknown>
  const limits = B4_TEXT_LIMITS[node.type] ?? {}
  const text = (field: string, min = 0, empty = '') => textRule(p[field] ?? '', min, limits[field] ?? 255, `props.${field}`, add, empty)
  switch (node.type) {
    case 'video': {
      const url = typeof p.url === 'string' ? p.url.trim() : ''
      if (!url) add('props.url', 'Paste the link of a YouTube or Vimeo video.')
      else if (url.length > B4_BOUNDS.videoUrl || !parseVideoUrl(url)) add('props.url', 'Use a YouTube link (youtube.com/watch?v=…, youtu.be/…, youtube.com/shorts/…) or a Vimeo link (vimeo.com/123456).')
      text('title', 1, 'Describe the video in a few words (for screen readers).')
      enumRule(p.aspect, B4_ENUMS.videoAspect, 'props.aspect', add)
      boolRule(p.autoplay, 'props.autoplay', add)
      intRule(p.start, B4_BOUNDS.videoStart.min, B4_BOUNDS.videoStart.max, 'props.start', add)
      return
    }
    case 'icon':
      if (typeof p.name !== 'string' || !icons.includes(p.name)) add('props.name', 'Choose an icon.')
      intRule(p.size, B4_BOUNDS.iconSize.min, B4_BOUNDS.iconSize.max, 'props.size', add)
      colorRule(p.color, 'props.color', add)
      text('label')
      linkRule(p.link, false, 'props.link', add)
      return
    case 'countdown':
      enumRule(p.source, B4_ENUMS.countdownSource, 'props.source', add)
      if (p.source === 'promotion') {
        if (typeof p.promotion_id !== 'string' || !isUuid(p.promotion_id)) add('props.promotion_id', 'Choose the sale to count down to.')
      } else if (typeof p.ends_at !== 'string' || !INSTANT.test(p.ends_at) || Number.isNaN(Date.parse(p.ends_at))) add('props.ends_at', 'Choose the date and time the countdown ends.')
      text('title')
      text('expired_text')
      enumRule(p.style, B4_ENUMS.countdownStyle, 'props.style', add)
      return
    case 'discount':
      if (typeof p.promotion_id !== 'string' || !isUuid(p.promotion_id)) add('props.promotion_id', 'Choose the promotion to show.')
      text('title')
      text('text')
      boolRule(p.show_code, 'props.show_code', add)
      text('button_label')
      linkRule(p.link, false, 'props.link', add)
      return
    case 'cta': {
      text('title', 1, 'Enter the title.')
      text('text')
      const button = (key: 'primary' | 'secondary') => {
        const value = p[key] as { label?: unknown; link?: unknown } | null | undefined
        if (key === 'secondary' && value === null) return
        if (!value || typeof value !== 'object') return add(`props.${key}.label`, 'Enter the button text.')
        textRule(value.label ?? '', 1, limits[`${key}.label`] ?? 60, `props.${key}.label`, add, 'Enter the button text.')
        linkRule(value.link, true, `props.${key}.link`, add, 'Choose where the button leads.')
      }
      button('primary')
      button('secondary')
      enumRule(p.align, B4_ENUMS.ctaAlign, 'props.align', add)
      return
    }
    case 'search_box':
      text('placeholder')
      text('button_label')
      return
    case 'promo_card':
      if (typeof p.product_id !== 'string' || !isUuid(p.product_id)) add('props.product_id', 'Choose the product to promote.')
      text('badge')
      nullableText(p.title, limits.title ?? 120, 'props.title', add)
      text('text')
      text('button_label')
      return
    case 'logo':
      intRule(p.height, B4_BOUNDS.logoHeight.min, B4_BOUNDS.logoHeight.max, 'props.height', add)
      linkRule(p.link, false, 'props.link', add)
      return
    case 'menu':
      if (typeof p.menu_id !== 'string' || !isUuid(p.menu_id)) add('props.menu_id', 'Choose a menu.')
      enumRule(p.layout, B4_ENUMS.menuLayout, 'props.layout', add)
      enumRule(p.show_children, [...new Set<string>([...B4_ENUMS.menuChildrenHeader, ...B4_ENUMS.menuChildrenFooter])], 'props.show_children', add)
      return
    case 'account_link':
    case 'wishlist_link':
      boolRule(p.show_label, 'props.show_label', add)
      return
    case 'cart_icon':
      boolRule(p.show_count, 'props.show_count', add)
      boolRule(p.show_total, 'props.show_total', add)
      return
    case 'language_switch':
      enumRule(p.style, B4_ENUMS.languageStyle, 'props.style', add)
      return
    case 'social_icons':
      intRule(p.size, B4_BOUNDS.socialSize.min, B4_BOUNDS.socialSize.max, 'props.size', add)
      enumRule(p.style, B4_ENUMS.socialStyle, 'props.style', add)
      colorRule(p.color, 'props.color', add)
      return
    case 'payment_icons':
      intRule(p.height, B4_BOUNDS.paymentHeight.min, B4_BOUNDS.paymentHeight.max, 'props.height', add)
      return
    case 'contact_block':
      for (const key of ['show_phone', 'show_email', 'show_address']) boolRule(p[key], `props.${key}`, add)
      enumRule(p.layout, B4_ENUMS.blockLayout, 'props.layout', add)
      return
    case 'copyright':
      nullableText(p.text, limits.text ?? 200, 'props.text', add)
      return
    case 'newsletter_form':
      text('title')
      text('text')
      text('button_label', 1, 'Enter the button text.')
      enumRule(p.layout, B4_ENUMS.blockLayout, 'props.layout', add)
      return
    case 'faq_list':
      nullableText(p.title, limits.title ?? 120, 'props.title', add)
      enumRule(p.style, B4_ENUMS.faqStyle, 'props.style', add)
      return
    case 'contact_form':
      nullableText(p.title, limits.title ?? 120, 'props.title', add)
      boolRule(p.show_details, 'props.show_details', add)
      return
    case 'custom_html':
      textRule(p.html ?? '', 0, B4_BOUNDS.customHtml, 'props.html', add, '')
      return
  }
}

/** The maximum length of a stored translation key (`items.i_ab12cd.title` → the `items.*.title` limit); undefined = not translatable. */
export function translationLimit(type: string, key: string): number | undefined {
  for (const [pattern, max] of Object.entries(translatableFields(type))) if (matchesTranslatable(pattern, key)) return max
  return undefined
}

/* ----------------------------------------------------------------------------------------------
 * B6: the storefront's prop rules (b6PropProblems) with messages
 * -------------------------------------------------------------------------------------------- */

type Range = { min: number; max: number }

/** List props and their item counts. */
const B6_LISTS: Record<string, Record<string, Range & { noun: string; plural: string }>> = {
  accordion: { items: { ...B6_LIMITS.accordionItems, noun: 'panel', plural: 'panels' } },
  tabs: { items: { ...B6_LIMITS.tabsItems, noun: 'tab', plural: 'tabs' } },
  icon_list: { items: { ...B6_LIMITS.iconListItems, noun: 'line', plural: 'lines' } },
  counter: { items: { ...B6_LIMITS.counterItems, noun: 'number', plural: 'numbers' } },
  steps: { items: { ...B6_LIMITS.stepsItems, noun: 'step', plural: 'steps' } },
  chart: { labels: { ...B6_LIMITS.chartLabels, noun: 'row', plural: 'rows' }, series: { ...B6_LIMITS.chartSeries, noun: 'series', plural: 'series' } },
  gallery: { images: { ...B6_LIMITS.galleryImages, noun: 'image', plural: 'images' } },
  image_carousel: { images: { ...B6_LIMITS.carouselImages, noun: 'image', plural: 'images' } },
  logo_carousel: { logos: { ...B6_LIMITS.logos, noun: 'logo', plural: 'logos' } },
  shop_the_look: { hotspots: { ...B6_LIMITS.hotspots, noun: 'hotspot', plural: 'hotspots' } },
  trust_badges: { items: { ...B6_LIMITS.trustBadges, noun: 'badge', plural: 'badges' } },
  marquee: { items: { ...B6_LIMITS.marqueeItems, noun: 'text', plural: 'texts' } },
  // B8a (nested lists by pattern: `plans.*.features`).
  pricing_table: { plans: { ...B8A_LIMITS.plans, noun: 'plan', plural: 'plans' }, 'plans.*.features': { ...B8A_LIMITS.planFeatures, noun: 'feature', plural: 'features' } },
  comparison_table: { columns: { ...B8A_LIMITS.comparisonColumns, noun: 'column', plural: 'columns' }, rows: { ...B8A_LIMITS.comparisonRows, noun: 'row', plural: 'rows' } },
  bundle: { items: { ...B8A_LIMITS.bundleItems, noun: 'product', plural: 'products' } },
  team: { members: { ...B8A_LIMITS.teamMembers, noun: 'person', plural: 'people' }, 'members.*.links': { ...B8A_LIMITS.teamLinks, noun: 'link', plural: 'links' } },
  photo_grid: { images: { ...B8A_LIMITS.photoImages, noun: 'photo', plural: 'photos' } },
  progress_bars: { items: { ...B8A_LIMITS.progressItems, noun: 'bar', plural: 'bars' } },
  store_hours: { days: { min: 7, max: 7, noun: 'day', plural: 'days' } },
  // B8b
  form: { fields: { ...B8B_LIMITS.formFields, noun: 'field', plural: 'fields' }, 'fields.*.options': { ...B8B_LIMITS.formOptions, noun: 'choice', plural: 'choices' } },
}

/** Whole-number props and their ranges. */
const B6_NUMBERS: Record<string, Record<string, Range & { unit?: string }>> = {
  chart: { height: { ...B6_LIMITS.chartHeight, unit: 'px' } },
  map: { height: { ...B6_LIMITS.mapHeight, unit: 'px' }, zoom: B6_LIMITS.mapZoom },
  image_carousel: { autoplay: { ...B6_LIMITS.carouselAutoplay, unit: 's' } },
  recently_viewed: { limit: B6_LIMITS.recentlyViewed },
  gallery: { 'columns.base': B6_LIMITS.galleryColumns, 'columns.tablet': { min: 1, max: 6 }, 'columns.mobile': { min: 1, max: 6 } },
  before_after: { start: { ...B8A_LIMITS.beforeAfterStart, unit: '%' } },
  flash_sale_bar: { product_limit: B8A_LIMITS.flashSaleProducts },
  review_wall: { min_rating: B8A_LIMITS.reviewMinRating, limit: B8A_LIMITS.reviewLimit },
  team: { 'columns.base': B8A_LIMITS.teamColumns, 'columns.tablet': { min: 1, max: B8A_LIMITS.teamColumns.max }, 'columns.mobile': { min: 1, max: B8A_LIMITS.teamColumns.max } },
  photo_grid: { 'columns.base': B8A_LIMITS.photoColumns, 'columns.tablet': { min: 1, max: B8A_LIMITS.photoColumns.max }, 'columns.mobile': { min: 1, max: B8A_LIMITS.photoColumns.max } },
}

const REQUIRED_MESSAGES: Record<string, string> = {
  media_id: 'Choose an image.',
  product_id: 'Choose a product.',
  category_id: 'Choose a category.',
  query: 'Enter an address or map coordinates.',
  title: 'Enter a title.',
  text: 'Enter the text.',
  labels: 'Enter a label.',
  name: 'Enter a name.',
  label: 'Enter a label.',
}

/** `items.2.title` → `items.*.title`. */
const toPattern = (path: string) => path.replace(/\.\d+(?=\.|$)/g, '.*')

/** A friendly message for a B6 prop problem. */
export function b6Message(type: string, problem: PropProblem): string {
  const { path, code } = problem
  const parts = path.split('.')
  const last = parts[parts.length - 1] ?? ''
  const field = /^\d+$/.test(last) ? (parts[parts.length - 2] ?? '') : last
  const list = B6_LISTS[type]?.[toPattern(path)]
  switch (code) {
    case 'required':
      return REQUIRED_MESSAGES[field] ?? 'This can’t be empty.'
    case 'too_long': {
      const max = B6_TEXTS[type]?.[toPattern(path)]
      return max ? `At most ${max} characters.` : 'This is too long.'
    }
    case 'too_few':
      if (type === 'chart' && path === 'series') return 'A stacked chart needs at least 2 series (columns of numbers).'
      return list ? `Add at least ${list.min} ${list.min === 1 ? list.noun : list.plural}.` : 'Add more.'
    case 'too_many':
      if (type === 'chart' && path === 'series') return 'A pie or donut chart shows exactly one series.'
      if (type === 'chart' && path === 'labels') return 'Too many rows for this chart (pie and donut: at most 8; others: at most 24).'
      return list ? `At most ${list.max} ${list.plural}.` : 'Too many.'
    case 'duplicate':
      if (field === 'product_id') return 'This product is already in the list; choose another one.'
      return 'Two items share the same id; remove one and add it again.'
    case 'out_of_range': {
      if (type === 'counter' && field === 'value') return 'Use a number from 0 to 1,000,000,000 with at most 2 decimals.'
      if (field === 'x' || field === 'y') return 'Use a position from 0 to 100 %.'
      if (type === 'progress_bars' && field === 'value') return 'Use a number from 0 to 100 with at most 1 decimal.'
      if (type === 'chart' && field === 'values') return 'Pie, donut and stacked charts can’t show negative numbers.'
      const range = B6_NUMBERS[type]?.[path]
      return range ? `Use ${range.min} to ${range.max}${range.unit ? ` ${range.unit}` : ''}.` : 'This number is out of range.'
    }
    default: {
      if (field === 'link') return 'Use a site path such as /sale or an http(s) URL.'
      // B8a
      if (field === 'price') return 'Use a price such as 1250 or 99.50 (no minus, at most 2 decimals).'
      if (type === 'team' && field === 'url') return 'Use a full https:// address (email: an address such as hello@myshop.com).'
      if (field === 'url') return 'Use a site path such as /sale or an http(s) URL.'
      if (field === 'open' || field === 'close') return 'Enter a time such as 10:00.'
      if (field === 'data_source') return 'Choose where the numbers come from.'
      if (field === 'source_product_id') return 'Choose a product, or show the ratings of all products.'
      if (field === 'promotion_id') return 'Choose a sale.'
      if (field === 'icon') return 'Choose an icon.'
      if (field === 'media_id') return 'Choose an image from the media library.'
      if (field === 'product_id') return 'Choose a product.'
      if (field === 'category_id') return 'Choose a category.'
      if (type === 'chart' && field === 'values') return /^\d+$/.test(last) ? 'Enter a number.' : 'Each series needs one number per row.'
      if (type === 'counter' && field === 'value') return 'Enter a number.'
      const range = B6_NUMBERS[type]?.[path]
      if (range) return `Enter a whole number from ${range.min} to ${range.max}.`
      return 'Choose one of the offered options.'
    }
  }
}

function validateB6(node: Element, add: (path: string, message: string) => void) {
  if (node.type === 'chart') {
    // B8a: the server's extra chart rule (first, so its message wins for `kind`).
    const p = node.props
    const stacked = p.kind === 'stacked-column' || p.kind === 'stacked-bar'
    if (stacked && p.data_source !== undefined && p.data_source !== 'manual') add('props.kind', 'Numbers from your store make one series, which can’t be stacked. Choose another chart kind.')
  }
  for (const problem of b6PropProblems(node.type, node.props)) add(`props.${problem.path}`, b6Message(node.type, problem))
}

/** B8a: the storefront's prop rules plus the server's extra ones (contract §1, backend registry notes). */
function validateB8a(node: Element, add: (path: string, message: string) => void) {
  for (const problem of b8aPropProblems(node.type, node.props)) add(`props.${problem.path}`, b6Message(node.type, problem))
  const p = node.props as Record<string, unknown>
  if (node.type === 'pricing_table' && Array.isArray(p.plans)) {
    ;(p.plans as { price?: unknown; price_text?: unknown }[]).forEach((plan, i) => {
      if (plan && plan.price === null && (typeof plan.price_text !== 'string' || plan.price_text.trim() === '')) add(`props.plans.${i}.price_text`, 'Enter what to show instead of a price, e.g. “Free”.')
    })
  }
  if (node.type === 'comparison_table') {
    const seen = new Set<string>()
    ;((p.columns as { product_id?: unknown }[] | undefined) ?? []).forEach((column, i) => {
      const id = column?.product_id
      if (typeof id !== 'string') return
      if (seen.has(id)) add(`props.columns.${i}.product_id`, 'This product is already in another column; choose another one.')
      seen.add(id)
    })
    ;((p.rows as { cells?: Record<string, { kind?: unknown; text?: unknown }> }[] | undefined) ?? []).forEach((row, r) => {
      for (const [columnId, cell] of Object.entries(row?.cells ?? {})) {
        if (cell?.kind === 'text' && (typeof cell.text !== 'string' || cell.text.trim() === '')) add(`props.rows.${r}.cells.${columnId}.text`, 'Enter the text for this cell, or choose Yes or No.')
      }
    })
  }
}

/** B8b messages the shared ones don't cover (the form and a button's action). */
function b8bMessage(type: string, problem: PropProblem): string {
  const { path, code } = problem
  const last = path.split('.').pop() ?? ''
  if (type === 'button' && path === 'action') return 'Closing the popup works only inside a popup. Choose “Open a page”.'
  if (last === 'reply_to') return code === 'duplicate' ? 'Only one e-mail field can be the reply-to address.' : 'Only an e-mail field can be the reply-to address.'
  if (path === 'notify_email') return 'Enter an e-mail address such as orders@myshop.com.'
  if (last === 'min' || last === 'max') return code === 'out_of_range' && last === 'max' ? 'The largest number must not be below the smallest (at most 2 decimals).' : 'Use a number up to 1,000,000,000 with at most 2 decimals.'
  if (last === 'max_length') return `Use ${B8B_LIMITS.formMaxLength.min}–${B8B_LIMITS.formMaxLength.max} characters, or leave it empty.`
  if (code === 'required') {
    if (path === 'submit_label') return 'Enter the button text.'
    if (path === 'success_message') return 'Enter the thank-you message.'
    if (path === 'consent.text') return 'Enter what the shopper agrees to.'
  }
  if (path === 'consent.link') return 'Use a site path such as /pages/privacy-policy or an http(s) URL.'
  return b6Message(type, problem)
}

function validateB8b(node: Element, add: (path: string, message: string) => void, context?: DocumentContext) {
  for (const problem of b8bPropProblems(node.type, node.props, context)) add(`props.${problem.path}`, b8bMessage(node.type, problem))
}

/** P2a: the order form's messages. */
export function orderFormMessage(problem: PropProblem): string {
  const { path, code } = problem
  const { quantityDefault, quantityMax } = ORDER_FORM_LIMITS
  switch (path) {
    case 'product_id':
      return 'Choose the product this form sells.'
    case 'quantity.default':
      return `Use a whole number from ${quantityDefault.min} to ${quantityDefault.max}.`
    case 'quantity.max':
      return `Use a whole number from ${quantityMax.min} to ${quantityMax.max}, not below the starting quantity.`
    case 'upsell.product_id':
      return code === 'duplicate' ? 'Choose another product than the one the form sells.' : 'Choose the add-on product.'
  }
  if (code === 'required') {
    if (path === 'button_label') return 'Enter the button text.'
    if (path === 'success_message') return 'Enter the thank-you message.'
    if (path === 'upsell.label') return 'Enter the text next to the tick box.'
  }
  if (code === 'too_long') {
    const max = (ORDER_FORM_TEXT_LIMITS as Record<string, number>)[path]
    return max ? `At most ${max} characters.` : 'This is too long.'
  }
  return 'Choose one of the options.'
}

function validateElement(node: Element, add: (path: string, message: string) => void, icons: readonly string[], context?: DocumentContext) {
  if (P2A_TYPES.has(node.type)) {
    for (const problem of orderFormPropProblems(node.props)) add(`props.${problem.path}`, orderFormMessage(problem))
    return
  }
  if (B8B_TYPES.has(node.type)) return validateB8b(node, add, context)
  if (B4_TYPES.has(node.type)) return validateB4(node, add, icons)
  if (B6_TYPES.has(node.type)) return validateB6(node, add)
  if (B8A_TYPES.has(node.type)) return validateB8a(node, add)
  switch (node.type) {
    case 'heading':
      textRule(node.props.text, 1, TEXT_LIMITS.heading, 'props.text', add, 'Enter the heading text.')
      intRule(node.props.level, 1, 6, 'props.level', add)
      validateLink(node.props.link, false, add)
      return
    case 'text':
      textRule(node.props.html ?? '', 0, TEXT_LIMITS.text, 'props.html', add, '')
      return
    case 'image':
      if (node.props.media_id !== null && !isUuid(node.props.media_id)) add('props.media_id', 'Choose an image from the media library.')
      textRule(node.props.alt ?? '', 0, TEXT_LIMITS.alt, 'props.alt', add, '')
      validateLink(node.props.link, false, add)
      enumRule(node.props.aspect, ENUMS.imageAspect, 'props.aspect', add)
      enumRule(node.props.fit, ENUMS.imageFit, 'props.fit', add)
      return
    case 'button':
      textRule(node.props.label, 1, TEXT_LIMITS.buttonLabel, 'props.label', add, 'Enter the button text.')
      validateLink(node.props.link, true, add)
      enumRule(node.props.variant, ENUMS.buttonVariant, 'props.variant', add)
      enumRule(node.props.size, ENUMS.buttonSize, 'props.size', add)
      if (typeof node.props.full_width !== 'boolean') add('props.full_width', 'Full width is on or off.')
      validateB8b(node, add, context)
      return
    case 'divider':
      enumRule(node.props.line, ENUMS.dividerLine, 'props.line', add)
      intRule(node.props.thickness, DIVIDER_THICKNESS.min, DIVIDER_THICKNESS.max, 'props.thickness', add)
      intRule(node.props.width, DIVIDER_WIDTH.min, DIVIDER_WIDTH.max, 'props.width', add)
      if (normalizeColor(node.props.color) === undefined) add('props.color', 'Use a colour such as #e5e7eb or a theme colour.')
      enumRule(node.props.align, ENUMS.dividerAlign, 'props.align', add)
      return
    case 'spacer':
      return
    case 'inner_row':
      if (node.columns.length < 1 || node.columns.length > 6) add('columns', 'A row needs 1 to 6 columns.')
      return
    default:
      if (isWrappedSectionType(node.type)) validateWrapped(node as WrappedElement, add)
  }
}

function validateSchedule(node: Section | Element, add: (path: string, message: string) => void) {
  const schedule = node.schedule
  if (schedule === null) return
  const times: Partial<Record<'starts_at' | 'ends_at', number>> = {}
  for (const key of ['starts_at', 'ends_at'] as const) {
    const value = schedule[key]
    if (value === null) continue
    if (!INSTANT.test(value) || Number.isNaN(Date.parse(value))) add(`schedule.${key}`, 'Enter a valid date and time.')
    else times[key] = Date.parse(value)
  }
  if (times.starts_at !== undefined && times.ends_at !== undefined && times.ends_at <= times.starts_at) add('schedule.ends_at', 'The end must be after the start.')
}

function validateTranslations(node: Section | Element, add: (path: string, message: string) => void) {
  for (const [locale, texts] of Object.entries(node.translations ?? {})) {
    for (const [field, text] of Object.entries(texts ?? {})) {
      const max = translationLimit(node.type, field)
      if (max !== undefined && typeof text === 'string' && text.length > max) add(`translations.${locale}.${field}`, `At most ${max} characters.`)
    }
  }
}

function validateColumn(node: Column, add: (path: string, message: string) => void) {
  for (const device of ['base', 'tablet', 'mobile'] as const) {
    const width = node.width[device]
    if (width === undefined && device !== 'base') continue
    if (normalizeWidthValue(width) === undefined) add(`width.${device}`, 'A column is 5 % to 100 % wide.')
  }
}

/** Client-side checks of one node; empty = valid. `icons`: the icon names the server accepts (default: the storefront's). B8b `context`: a button's "close the popup" is for popups only. */
export function validateNode(node: BuilderNode, options: { icons?: readonly string[]; context?: DocumentContext } = {}): Problem[] {
  const problems: Problem[] = []
  const add = (path: string, message: string) => {
    if (!problems.some((p) => p.path === path)) problems.push({ path, message })
  }
  if (!NODE_ID.test(node.id)) add('id', 'An id is 2–32 lower-case letters, digits, "_" or "-", starting with a letter.')

  if (node.type === 'column') {
    validateColumn(node, add)
    return problems
  }
  if (node.type === 'section') {
    enumRule(node.props.layout, ENUMS.layout, 'props.layout', add)
    if (node.props.anchor !== null && !ANCHOR_PATTERN.test(node.props.anchor)) add('props.anchor', 'Use lower-case letters, digits and dashes, starting with a letter (at most 60).')
    if (node.columns.length < 1 || node.columns.length > 6) add('columns', 'A row needs 1 to 6 columns.')
    // B6: sticky and the shape dividers.
    const { sticky } = node.props
    if (sticky !== undefined && typeof sticky !== 'boolean') add('props.sticky', 'This is on or off.')
    for (const edge of ['shape_top', 'shape_bottom'] as const) {
      const shape = node.props[edge]
      if (shape != null && normalizeSectionShape(shape) === null) add(`props.${edge}`, `Choose a shape, a colour and a height from ${B6_LIMITS.shapeHeight.min} to ${B6_LIMITS.shapeHeight.max} px.`)
    }
  } else {
    validateElement(node, add, options.icons ?? ICON_NAMES, options.context)
  }
  validateSchedule(node, add)
  validateTranslations(node, add)
  return problems
}
