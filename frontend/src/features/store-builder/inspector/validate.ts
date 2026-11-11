/*
 * Client checks of one builder node, mirroring the server (BuilderDocumentSchema::normalize,
 * SectionConfigRules, the homepage section rules). Paths are relative to the node, e.g.
 * `props.text`, `props.config.limit`, `props.items`, `translations.bn.title`, `schedule.ends_at`.
 * Document-wide rules (unique ids and anchors, limits) are the editor's and the server's job.
 */

import type { SectionConfigs, SectionType, SectionTypeInfo } from '@/features/storefront/api'
import { validateSectionDraft } from '@/features/storefront/components/section-draft'
import { isWrappedSectionType, NODE_ID } from '@/storefront/builder/registry'
import type { Column, Element, Section, WrappedElement, WrappedSectionType } from '@/storefront/builder/types'
import { ENUMS, isUuid, normalizeColor, normalizeWidthValue, safeUrl } from '@/storefront/builder/validate'
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

/** Translatable fields of an element type with their maximum length (backend ElementRegistry::translatable). */
export function translatableFields(type: string): Record<string, number> {
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

function validateElement(node: Element, add: (path: string, message: string) => void) {
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
  const fields = translatableFields(node.type)
  for (const [locale, texts] of Object.entries(node.translations ?? {})) {
    for (const [field, text] of Object.entries(texts ?? {})) {
      const max = fields[field]
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

/** Client-side checks of one node; empty = valid. */
export function validateNode(node: BuilderNode): Problem[] {
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
  } else {
    validateElement(node, add)
  }
  validateSchedule(node, add)
  validateTranslations(node, add)
  return problems
}
