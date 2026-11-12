/*
 * Element types of the builder, mirroring the backend ElementRegistry (GET
 * /storefront/builder/elements): group, label, translatable props, prop defaults and whether the
 * type holds columns. The editor (B2) reads the server's copy; the storefront uses this one to
 * know which types it can draw.
 */

import type { DocumentContext, ElementType, WrappedSectionType } from './types'

/** B4: `site` = header / footer parts (logo, menu, account, cart, social icons, …). B6: `media` (gallery, carousels, map). */
export type ElementGroup = 'layout' | 'content' | 'media' | 'commerce' | 'marketing' | 'site'

export type ElementMeta = {
  type: ElementType
  group: ElementGroup
  label: string
  /**
   * Props (and, for wrapped sections, config fields) that can be translated per locale. A nested
   * prop is named with a dot (`primary.label` of a call to action).
   */
  translatable: readonly string[]
  /** Props after normalize when nothing was set. */
  props: Readonly<Record<string, unknown>>
  children: 'columns' | null
  /** B4: the document contexts the type may be used in. */
  allowed_in: readonly DocumentContext[]
}

type BaseMeta = Omit<ElementMeta, 'allowed_in'>

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

const BASIC: BaseMeta[] = [
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

/**
 * B4 elements (contract §2). Defaults are what normalize keeps when nothing was set; a video
 * (url) and a promo card (product) are invalid until set up, a countdown until it has an end or a
 * promotion, a discount until it has a promotion, a menu until it has a menu.
 */
const B4: BaseMeta[] = [
  {
    type: 'video',
    group: 'content',
    label: 'Video',
    translatable: ['title'],
    props: { url: '', provider: 'youtube', video_id: '', title: '', aspect: '16:9', autoplay: false, start: 0 },
    children: null,
  },
  { type: 'icon', group: 'content', label: 'Icon', translatable: ['label'], props: { name: 'star', size: 32, color: null, label: '', link: null }, children: null },
  {
    type: 'countdown',
    group: 'marketing',
    label: 'Countdown',
    translatable: ['title', 'expired_text'],
    props: { source: 'date', ends_at: null, promotion_id: null, title: '', expired_text: '', style: 'boxes' },
    children: null,
  },
  {
    type: 'discount',
    group: 'marketing',
    label: 'Discount',
    translatable: ['title', 'text', 'button_label'],
    props: { promotion_id: null, title: '', text: '', show_code: true, button_label: 'Shop now', link: { url: '/shop' } },
    children: null,
  },
  {
    type: 'cta',
    group: 'marketing',
    label: 'Call to action',
    translatable: ['title', 'text', 'primary.label', 'secondary.label'],
    props: { title: 'Ready when you are', text: '', primary: { label: 'Shop now', link: { url: '/shop' } }, secondary: null, align: 'center' },
    children: null,
  },
  {
    type: 'search_box',
    group: 'commerce',
    label: 'Search box',
    translatable: ['placeholder', 'button_label'],
    props: { placeholder: 'Search products', button_label: '' },
    children: null,
  },
  {
    type: 'promo_card',
    group: 'commerce',
    label: 'Promoted product',
    translatable: ['badge', 'title', 'text', 'button_label'],
    props: { product_id: null, badge: '', title: null, text: '', button_label: 'Shop now' },
    children: null,
  },
  { type: 'logo', group: 'site', label: 'Logo', translatable: [], props: { height: 48, link: { url: '/' } }, children: null },
  { type: 'menu', group: 'site', label: 'Menu', translatable: [], props: { menu_id: null, layout: 'horizontal', show_children: 'dropdown' }, children: null },
  { type: 'account_link', group: 'site', label: 'Account', translatable: [], props: { show_label: false }, children: null },
  { type: 'wishlist_link', group: 'site', label: 'Wishlist', translatable: [], props: { show_label: false }, children: null },
  { type: 'cart_icon', group: 'site', label: 'Cart', translatable: [], props: { show_count: true, show_total: false }, children: null },
  { type: 'language_switch', group: 'site', label: 'Language switch', translatable: [], props: { style: 'links' }, children: null },
  { type: 'announcement', group: 'site', label: 'Announcement', translatable: [], props: {}, children: null },
  { type: 'social_icons', group: 'site', label: 'Social icons', translatable: [], props: { size: 24, style: 'plain', color: null }, children: null },
  { type: 'payment_icons', group: 'site', label: 'Payment icons', translatable: [], props: { height: 24 }, children: null },
  {
    type: 'contact_block',
    group: 'site',
    label: 'Contact details',
    translatable: [],
    props: { show_phone: true, show_email: true, show_address: true, layout: 'stacked' },
    children: null,
  },
  { type: 'copyright', group: 'site', label: 'Copyright', translatable: ['text'], props: { text: null }, children: null },
  {
    type: 'newsletter_form',
    group: 'marketing',
    label: 'Newsletter form',
    translatable: ['title', 'text', 'button_label'],
    props: { title: 'Join our newsletter', text: '', button_label: 'Subscribe', layout: 'inline' },
    children: null,
  },
  { type: 'faq_list', group: 'content', label: 'FAQ list', translatable: ['title'], props: { title: null, style: 'accordion' }, children: null },
  { type: 'contact_form', group: 'content', label: 'Contact form', translatable: ['title'], props: { title: null, show_details: true }, children: null },
  { type: 'custom_html', group: 'content', label: 'Custom HTML', translatable: [], props: { html: '' }, children: null },
]

/**
 * B6 elements (contract §1). Item lists hold sample items where the element needs them to be
 * valid; elements that need a reference or an upload (gallery and carousel images, logos, the
 * category, the product, the shop-the-look image, the map address) are invalid until set up.
 * Translatable item fields are spelled `<list>.*.<field>` (stored as `<list>.<item_id>.<field>`);
 * chart labels `labels.*` (stored as `labels.<index>`).
 */
const B6: BaseMeta[] = [
  {
    type: 'accordion',
    group: 'content',
    label: 'Accordion',
    translatable: ['items.*.title', 'items.*.html'],
    props: { items: [{ id: 'item-1', title: 'A question shoppers ask', html: '<p>The answer.</p>' }], open_first: true, allow_multiple: false, style: 'boxed' },
    children: null,
  },
  {
    type: 'tabs',
    group: 'content',
    label: 'Tabs',
    translatable: ['items.*.title', 'items.*.html'],
    props: {
      items: [
        { id: 'tab-1', title: 'Details', html: '<p>Write something here.</p>' },
        { id: 'tab-2', title: 'Delivery', html: '<p>Write something here.</p>' },
      ],
      layout: 'horizontal',
    },
    children: null,
  },
  {
    type: 'icon_box',
    group: 'content',
    label: 'Icon box',
    translatable: ['title', 'text'],
    props: { icon: 'truck', title: 'Fast delivery', text: '', link: null, layout: 'top', icon_style: 'circle' },
    children: null,
  },
  {
    type: 'icon_list',
    group: 'content',
    label: 'Icon list',
    translatable: ['items.*.text'],
    props: { items: [{ id: 'item-1', icon: 'check', text: 'Fresh every day', link: null }], layout: 'vertical' },
    children: null,
  },
  { type: 'quote', group: 'content', label: 'Quote', translatable: ['text', 'author', 'role'], props: { text: 'Write the quote here.', author: '', role: '', style: 'card' }, children: null },
  { type: 'notice', group: 'content', label: 'Notice', translatable: ['title', 'text'], props: { tone: 'info', title: '', text: 'Write the notice here.', show_icon: true }, children: null },
  {
    type: 'counter',
    group: 'content',
    label: 'Counter',
    translatable: ['items.*.suffix', 'items.*.label'],
    props: { items: [{ id: 'item-1', value: 100, prefix: '', suffix: '+', label: 'Happy customers' }], animate: true },
    children: null,
  },
  {
    type: 'steps',
    group: 'content',
    label: 'Steps',
    translatable: ['items.*.title', 'items.*.text'],
    props: {
      items: [
        { id: 'step-1', title: 'Choose', text: '', icon: null },
        { id: 'step-2', title: 'Order', text: '', icon: null },
        { id: 'step-3', title: 'Enjoy', text: '', icon: null },
      ],
      layout: 'horizontal',
      numbered: true,
    },
    children: null,
  },
  {
    type: 'chart',
    group: 'content',
    label: 'Chart',
    translatable: ['title', 'description', 'labels.*', 'series.*.name'],
    props: {
      kind: 'column',
      title: '',
      description: '',
      labels: ['Jan', 'Feb', 'Mar'],
      series: [{ id: 'series-1', name: 'Sales', values: [10, 20, 30] }],
      unit: '',
      unit_position: 'after',
      y_starts_at_zero: true,
      show_values: 'none',
      show_legend: true,
      show_table: false,
      height: 320,
    },
    children: null,
  },
  {
    type: 'gallery',
    group: 'media',
    label: 'Gallery',
    translatable: ['images.*.alt', 'images.*.caption'],
    props: { images: [], columns: { base: 3 }, aspect: 'square', lightbox: true, gap: 'md' },
    children: null,
  },
  {
    type: 'image_carousel',
    group: 'media',
    label: 'Image carousel',
    translatable: ['images.*.alt', 'images.*.caption'],
    props: { images: [], autoplay: 0, show_dots: true, show_arrows: true, aspect: '16:9' },
    children: null,
  },
  { type: 'logo_carousel', group: 'media', label: 'Logo carousel', translatable: ['logos.*.alt'], props: { logos: [], grayscale: true, speed: 'normal' }, children: null },
  { type: 'map', group: 'media', label: 'Map', translatable: ['query', 'title'], props: { query: '', title: '', height: 360, zoom: 15 }, children: null },
  {
    type: 'category_card',
    group: 'commerce',
    label: 'Category card',
    translatable: ['title', 'button_label'],
    props: { category_id: null, media_id: null, title: null, button_label: 'Shop now', layout: 'overlay' },
    children: null,
  },
  {
    type: 'product_spotlight',
    group: 'commerce',
    label: 'Product spotlight',
    translatable: ['badge'],
    props: { product_id: null, layout: 'image-left', show_description: true, badge: '' },
    children: null,
  },
  { type: 'shop_the_look', group: 'commerce', label: 'Shop the look', translatable: ['alt', 'title'], props: { media_id: null, alt: '', title: '', hotspots: [] }, children: null },
  {
    type: 'trust_badges',
    group: 'commerce',
    label: 'Trust badges',
    translatable: ['items.*.title', 'items.*.text'],
    props: {
      items: [
        { id: 'item-1', icon: 'truck', title: 'Fast delivery', text: '' },
        { id: 'item-2', icon: 'shield-check', title: 'Secure payment', text: '' },
        { id: 'item-3', icon: 'rotate-ccw', title: 'Easy returns', text: '' },
      ],
      style: 'row',
    },
    children: null,
  },
  { type: 'recently_viewed', group: 'commerce', label: 'Recently viewed', translatable: ['title'], props: { title: 'Recently viewed', limit: 8 }, children: null },
  {
    type: 'marquee',
    group: 'marketing',
    label: 'Marquee',
    translatable: ['items.*.text'],
    props: { items: [{ id: 'item-1', text: 'Free delivery on every order' }], speed: 'normal', direction: 'left', separator: 'dot' },
    children: null,
  },
]

const ALL: readonly DocumentContext[] = ['page', 'cms', 'header', 'footer', 'zone']
const PAGES: readonly DocumentContext[] = ['page', 'cms', 'zone']

/** Where each type may be used (contract §1 page / header / footer sets; `faq_list` and `contact_form` on CMS pages only). */
const ALLOWED_IN: Record<ElementType, readonly DocumentContext[]> = {
  heading: ALL,
  text: ALL,
  image: ALL,
  button: ALL,
  spacer: ALL,
  divider: ALL,
  inner_row: ALL,
  ...(Object.fromEntries(WRAPPED_SECTION_TYPES.map((type) => [type, PAGES])) as Record<WrappedSectionType, readonly DocumentContext[]>),
  video: PAGES,
  icon: ALL,
  countdown: PAGES,
  discount: PAGES,
  cta: PAGES,
  search_box: ['page', 'cms', 'zone', 'header'],
  promo_card: PAGES,
  logo: ['header', 'footer'],
  menu: ['header', 'footer'],
  account_link: ['header'],
  wishlist_link: ['header'],
  cart_icon: ['header'],
  language_switch: ['header', 'footer'],
  announcement: ['header'],
  social_icons: ALL,
  payment_icons: ['page', 'cms', 'zone', 'footer'],
  contact_block: ALL,
  copyright: ['footer'],
  newsletter_form: ['page', 'cms', 'zone', 'footer'],
  faq_list: ['cms'],
  contact_form: ['cms'],
  custom_html: ALL,
  accordion: ['page', 'cms', 'zone', 'footer'],
  tabs: PAGES,
  icon_box: ['page', 'cms', 'zone', 'footer'],
  icon_list: ALL,
  quote: PAGES,
  notice: PAGES,
  counter: PAGES,
  steps: PAGES,
  chart: PAGES,
  gallery: PAGES,
  image_carousel: PAGES,
  logo_carousel: ['page', 'cms', 'zone', 'footer'],
  map: ['page', 'cms', 'zone', 'footer'],
  category_card: PAGES,
  product_spotlight: PAGES,
  shop_the_look: PAGES,
  trust_badges: ['page', 'cms', 'zone', 'footer'],
  recently_viewed: PAGES,
  marquee: ALL,
}

export const ELEMENT_REGISTRY: readonly ElementMeta[] = [
  ...BASIC,
  ...WRAPPED_SECTION_TYPES.map(
    (type): BaseMeta => ({
      type,
      ...SECTION_META[type],
      translatable: ['title', 'subtitle', ...(SECTION_TRANSLATABLE_CONFIG[type] ?? [])],
      props: { title: null, subtitle: null, config: SECTION_CONFIG_DEFAULTS[type], items: [] },
      children: null,
    }),
  ),
  ...B4,
  ...B6,
].map((meta) => ({ ...meta, allowed_in: ALLOWED_IN[meta.type] }))

/** Whether a type may be used in a document of this context (the server answers 422 otherwise). */
export function isAllowedIn(type: string, context: DocumentContext): boolean {
  return elementMeta(type)?.allowed_in.includes(context) ?? false
}

/** The document context of a builder document key: `home` / `landing:*` → page, `cms:*`, `header`, `footer`, `zone:*`. */
export function documentContext(key: string): DocumentContext {
  if (key === 'header' || key === 'footer') return key
  if (key.startsWith('cms:')) return 'cms'
  if (key.startsWith('zone:')) return 'zone'
  return 'page'
}

const BY_TYPE = new Map<string, ElementMeta>(ELEMENT_REGISTRY.map((meta) => [meta.type, meta]))

export function elementMeta(type: string): ElementMeta | undefined {
  return BY_TYPE.get(type)
}

export function isWrappedSectionType(type: string): type is WrappedSectionType {
  return (WRAPPED_SECTION_TYPES as readonly string[]).includes(type)
}

/**
 * A registry translatable pattern against a stored translation key: `items.*.title` matches
 * `items.item-1.title`, `labels.*` matches `labels.0`, a plain name only itself.
 */
export function matchesTranslatable(pattern: string, key: string): boolean {
  const a = pattern.split('.')
  const b = key.split('.')
  return a.length === b.length && a.every((part, i) => (part === '*' ? /^[A-Za-z0-9_-]{1,32}$/.test(b[i]!) : part === b[i]))
}

/** Whether a stored translation key (`title`, `primary.label`, `items.item-1.title`, …) is translatable for this type. */
export function isTranslatableKey(type: string, key: string): boolean {
  return (elementMeta(type)?.translatable ?? []).some((pattern) => matchesTranslatable(pattern, key))
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
