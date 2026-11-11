/*
 * Element types of the builder, mirroring the backend ElementRegistry (GET
 * /storefront/builder/elements): group, label, translatable props, prop defaults and whether the
 * type holds columns. The editor (B2) reads the server's copy; the storefront uses this one to
 * know which types it can draw.
 */

import type { ElementType, WrappedSectionType } from './types'

export type ElementGroup = 'layout' | 'content' | 'commerce' | 'marketing'

export type ElementMeta = {
  type: ElementType
  group: ElementGroup
  label: string
  /** Props (and, for wrapped sections, config fields) that can be translated per locale. */
  translatable: readonly string[]
  /** Props after normalize when nothing was set. */
  props: Readonly<Record<string, unknown>>
  children: 'columns' | null
}

export const WRAPPED_SECTION_TYPES = [
  'hero_slider',
  'banner_grid',
  'rich_text',
  'features_strip',
  'testimonials',
  'newsletter',
  'product_carousel',
  'product_grid',
  'product_tabs',
  'category_strip',
  'brand_strip',
  'hot_deals',
  'blog_posts',
] as const satisfies readonly WrappedSectionType[]

/** The homepage section config defaults (backend SectionType::defaults). */
const SECTION_CONFIG_DEFAULTS: Record<WrappedSectionType, Record<string, unknown>> = {
  hero_slider: { autoplay_seconds: 6, height: 'large' },
  banner_grid: { layout: '3-col' },
  rich_text: { body_html: '', alignment: 'left', width: 'narrow', background: null },
  features_strip: { items: [], background: null },
  testimonials: { items: [], background: null },
  newsletter: { text: null, button_label: 'Subscribe', image_media_id: null, background: '#c2410c', foreground: '#ffffff' },
  product_carousel: { source: 'featured', category_id: null, limit: 8, view_all_url: null },
  product_grid: { source: 'featured', category_id: null, limit: 8, columns: 4, view_all_url: null },
  product_tabs: { tabs: [], limit: 8 },
  category_strip: { source: 'top_level', limit: 8 },
  brand_strip: { source: 'all', limit: 12 },
  hot_deals: { promotion_id: null, limit: 8, view_all_url: null },
  blog_posts: { category_id: null, limit: 3, view_all_url: '/blog' },
}

/** Translatable config fields per section type (backend SectionType::translatableConfigFields). */
const SECTION_TRANSLATABLE_CONFIG: Partial<Record<WrappedSectionType, readonly string[]>> = {
  rich_text: ['body_html'],
  newsletter: ['text', 'button_label'],
}

const SECTION_META: Record<WrappedSectionType, { group: ElementGroup; label: string }> = {
  hero_slider: { group: 'marketing', label: 'Hero slider' },
  banner_grid: { group: 'marketing', label: 'Banner grid' },
  rich_text: { group: 'content', label: 'Text block' },
  features_strip: { group: 'marketing', label: 'Features strip' },
  testimonials: { group: 'marketing', label: 'Testimonials' },
  newsletter: { group: 'marketing', label: 'Newsletter sign-up' },
  product_carousel: { group: 'commerce', label: 'Product carousel' },
  product_grid: { group: 'commerce', label: 'Product grid' },
  product_tabs: { group: 'commerce', label: 'Product tabs' },
  category_strip: { group: 'commerce', label: 'Category strip' },
  brand_strip: { group: 'commerce', label: 'Brand strip' },
  hot_deals: { group: 'marketing', label: 'Hot deals' },
  blog_posts: { group: 'content', label: 'Blog posts' },
}

const BASIC: ElementMeta[] = [
  { type: 'heading', group: 'content', label: 'Heading', translatable: ['text'], props: { text: 'Heading', level: 2, link: null }, children: null },
  { type: 'text', group: 'content', label: 'Text', translatable: ['html'], props: { html: '<p>Write something here.</p>' }, children: null },
  {
    type: 'image',
    group: 'content',
    label: 'Image',
    translatable: ['alt'],
    props: { media_id: null, alt: '', link: null, aspect: 'auto', fit: 'cover' },
    children: null,
  },
  {
    type: 'button',
    group: 'content',
    label: 'Button',
    translatable: ['label'],
    props: { label: 'Shop now', link: { url: '/shop' }, variant: 'primary', size: 'md', full_width: false },
    children: null,
  },
  { type: 'spacer', group: 'layout', label: 'Spacer', translatable: [], props: {}, children: null },
  {
    type: 'divider',
    group: 'layout',
    label: 'Divider',
    translatable: [],
    props: { line: 'solid', thickness: 1, width: 100, color: 'theme:border', align: 'center' },
    children: null,
  },
  { type: 'inner_row', group: 'layout', label: 'Inner row', translatable: [], props: {}, children: 'columns' },
]

export const ELEMENT_REGISTRY: readonly ElementMeta[] = [
  ...BASIC,
  ...WRAPPED_SECTION_TYPES.map(
    (type): ElementMeta => ({
      type,
      ...SECTION_META[type],
      translatable: ['title', 'subtitle', ...(SECTION_TRANSLATABLE_CONFIG[type] ?? [])],
      props: { title: null, subtitle: null, config: SECTION_CONFIG_DEFAULTS[type], items: [] },
      children: null,
    }),
  ),
]

const BY_TYPE = new Map<string, ElementMeta>(ELEMENT_REGISTRY.map((meta) => [meta.type, meta]))

export function elementMeta(type: string): ElementMeta | undefined {
  return BY_TYPE.get(type)
}

export function isWrappedSectionType(type: string): type is WrappedSectionType {
  return (WRAPPED_SECTION_TYPES as readonly string[]).includes(type)
}

/** Document limits (contract §1). */
export const BUILDER_LIMITS = {
  sections: 60,
  nodes: 400,
  bytes: 256 * 1024,
  columnsPerRow: 6,
  elementsPerColumn: 40,
} as const

/** `^[a-z][a-z0-9_-]{1,31}$`: safe inside a `[data-b="…"]` selector. */
export const NODE_ID = /^[a-z][a-z0-9_-]{1,31}$/
