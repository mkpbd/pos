/*
 * B19 editor model (pure): the scroll story and horizontal gallery elements — plain-words option
 * lists, friendly messages for their prop problems, and small list helpers (links that are null
 * when unset, switching the gallery between pictures and products, the product list, the tiring
 * pinned-scroll hint). Types, enums, limits and the rules themselves are the storefront's
 * (`@/storefront/builder/types`, `validate`). Missing pictures and alt texts are warnings (page
 * check SCROLL_STORY_MEDIA), not errors: a new story or a template saves without pictures and
 * shows placeholders until they are chosen.
 */

import type { HorizontalGalleryItem, HorizontalGalleryProps, ScrollStoryStep } from '@/storefront/builder/types'
import { B19_LIMITS, B19_TEXT_LIMITS, type PropProblem } from '@/storefront/builder/validate'
import type { Translations } from './bangla'

export const B19_TYPES: ReadonlySet<string> = new Set(['scroll_story', 'horizontal_gallery'])

/* ----------------------------------------------------------------------------------------------
 * Words
 * -------------------------------------------------------------------------------------------- */

export const MEDIA_SIDES = [
  { value: 'left', label: 'Picture on the left' },
  { value: 'right', label: 'Picture on the right' },
] as const

export const MEDIA_RATIOS = [
  { value: 'portrait', label: 'Tall (portrait)' },
  { value: 'square', label: 'Square' },
  { value: 'landscape', label: 'Wide (landscape)' },
] as const

export const STORY_TRANSITIONS = [
  { value: 'fade', label: 'Fade into the next picture' },
  { value: 'slide', label: 'Slide up to the next picture' },
  { value: 'zoom', label: 'Zoom into the next picture' },
] as const

export const GALLERY_SOURCES = [
  { value: 'images', label: 'Pictures' },
  { value: 'products', label: 'Products' },
] as const

export const CARD_WIDTHS = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
] as const

/* ----------------------------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------------------------- */

/** A new step, every key present (no picture yet: a placeholder until one is chosen). */
export function newStep(id: string, number: number): ScrollStoryStep {
  return { id, media_id: null, alt: '', kicker: `Step ${number}`, heading: 'A new chapter', text: 'Tell this part of the story in a sentence or two.', link: null }
}

/** A new gallery picture, every key present. */
export function newGalleryItem(id: string, mediaId: string | null = null, alt = ''): HorizontalGalleryItem {
  return { id, media_id: mediaId || null, alt, caption: '', link: null }
}

/** A step's link: a URL sets it (keeping its text), null removes it. */
export function withStepLink(step: ScrollStoryStep, url: string | null): ScrollStoryStep {
  if (url === null || url === '') return { ...step, link: null }
  return { ...step, link: { label: step.link?.label ?? 'Learn more', url } }
}

/** Translations without one key in every language (a removed step link takes its Bangla text along). */
export function withoutTranslation(translations: Translations, key: string): Translations {
  const out: Translations = {}
  for (const [locale, texts] of Object.entries(translations ?? {})) {
    const { [key]: _drop, ...rest } = texts
    if (Object.keys(rest).length > 0) out[locale] = rest
  }
  return out
}

/** A step's link text (only when the step has a link). */
export function withStepLinkLabel(step: ScrollStoryStep, label: string): ScrollStoryStep {
  return step.link ? { ...step, link: { ...step.link, label } } : step
}

/** A gallery picture's link: a URL sets it, null removes it. */
export function withItemLink(item: HorizontalGalleryItem, url: string | null): HorizontalGalleryItem {
  return { ...item, link: url === null || url === '' ? null : { url } }
}

/**
 * Switching between pictures and products: the other source's list is emptied (the server does
 * the same on save); `restore` brings back what that source had earlier in this session.
 */
export function withSource(props: HorizontalGalleryProps, source: HorizontalGalleryProps['source'], restore?: { items?: HorizontalGalleryItem[]; product_ids?: string[] }): HorizontalGalleryProps {
  if (source === props.source) return props
  return source === 'products'
    ? { ...props, source, items: [], product_ids: restore?.product_ids ?? [] }
    : { ...props, source, product_ids: [], items: restore?.items ?? [] }
}

/** The card title of a step. */
export function stepSummary(step: ScrollStoryStep, index: number): string {
  return step.heading.trim() || step.kicker.trim() || `Step ${index + 1}`
}

/** How many cards the gallery shows (the list of its source). */
export function galleryCount(props: Pick<HorizontalGalleryProps, 'source' | 'items' | 'product_ids'>): number {
  return props.source === 'products' ? (props.product_ids ?? []).length : (props.items ?? []).length
}

/** The registry's pin warning limit (`limits.horizontal_gallery_pin_warn`), else 8. */
export function pinWarnLimit(limits: Record<string, unknown> | undefined): number {
  const value = limits?.horizontal_gallery_pin_warn
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : B19_LIMITS.horizontalGalleryPinTiring
}

/** The tiring-scroll hint: a pinned gallery with more than `limit` (8) cards. */
export function pinIsLong(props: Pick<HorizontalGalleryProps, 'source' | 'items' | 'product_ids' | 'pin'>, limit: number = B19_LIMITS.horizontalGalleryPinTiring): boolean {
  return props.pin && galleryCount(props) > limit
}

/** What a step or picture still needs to look right (shown in its card; never blocks saving). */
export function pictureWarning(item: { media_id: string | null; alt: string }): string | null {
  if (!item.media_id) return 'Choose a picture. Until then shoppers see the text without it.'
  if (item.alt.trim() === '') return 'Describe the picture for people who can’t see it.'
  return null
}

/* ----------------------------------------------------------------------------------------------
 * Messages
 * -------------------------------------------------------------------------------------------- */

const LINK_URL = 'Use a page of your store (/…) or an address starting with https://.'

/** A friendly message for a B19 prop problem (paths relative to `props`). */
export function b19Message(type: string, problem: PropProblem): string {
  const { path, code } = problem
  const parts = path.split('.')
  const isItem = parts.length > 2 && /^\d+$/.test(parts[1] ?? '')
  const list = parts[0] ?? ''
  const field = isItem ? parts.slice(2).join('.') : path
  if (code === 'too_long') {
    const max = (B19_TEXT_LIMITS as Record<string, Record<string, number>>)[type]?.[isItem ? `${list}.*.${field}` : path]
    return max ? `At most ${max} characters.` : 'This is too long.'
  }
  if (isItem) {
    switch (field) {
      case 'heading':
        return 'Give the step a heading.'
      case 'link.label':
        return 'Enter the link text.'
      case 'link':
      case 'link.url':
        return LINK_URL
      case 'media_id':
        return 'Choose a picture from the media library.'
      case 'id':
        return code === 'duplicate' ? 'Two items have the same id. Remove one and add it again.' : 'This item is damaged. Remove it and add it again.'
      default:
        return 'This value isn’t valid.'
    }
  }
  const range = (r: { min: number; max: number }, plural: string) => (code === 'too_few' || code === 'too_many' ? `Add ${r.min} to ${r.max} ${plural}.` : null)
  switch (`${type}.${list}`) {
    case 'scroll_story.steps':
      return range(B19_LIMITS.scrollStorySteps, 'steps') ?? 'The steps aren’t valid.'
    case 'horizontal_gallery.items':
      return range(B19_LIMITS.horizontalGalleryItems, 'pictures') ?? 'The pictures aren’t valid.'
    case 'horizontal_gallery.product_ids':
      if (code === 'duplicate') return 'A product is in the list twice.'
      return range(B19_LIMITS.horizontalGalleryProducts, 'products') ?? 'Choose products from your catalogue.'
    case 'scroll_story.media_side':
      return 'Choose where the picture goes.'
    case 'scroll_story.media_ratio':
      return 'Choose a picture shape.'
    case 'scroll_story.transition':
      return 'Choose how the pictures change.'
    case 'horizontal_gallery.source':
      return 'Choose pictures or products.'
    case 'horizontal_gallery.card_width':
      return 'Choose a card width.'
    default:
      return 'This value isn’t valid.'
  }
}

/* ----------------------------------------------------------------------------------------------
 * Inserting
 * -------------------------------------------------------------------------------------------- */

/**
 * Starting lists of a new element when the registry's defaults have none: a story with 3 steps,
 * a gallery with 2 pictures (no media yet — placeholders until chosen, which saves fine).
 */
export function b19StartingProps(type: string, props: Record<string, unknown>): Record<string, unknown> {
  if (type === 'scroll_story' && (!Array.isArray(props.steps) || props.steps.length === 0)) {
    return { steps: [1, 2, 3].map((n) => newStep(`s_${n}`, n)) }
  }
  if (type === 'horizontal_gallery' && props.source !== 'products' && (!Array.isArray(props.items) || props.items.length === 0)) {
    return { items: [1, 2].map((n) => newGalleryItem(`i_${n}`)) }
  }
  return {}
}
