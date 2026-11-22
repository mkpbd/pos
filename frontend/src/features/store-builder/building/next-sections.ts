import type { Column, Element, InnerRowElement, Section } from '@/storefront/builder/types'

/*
 * B21 "What next?": a small, pure rule engine. From what the page is (home, sale, about, contact …
 * from its key and title words) and the sections it already has (their role, read from the
 * template id in `props.source_template` when present, else from the element types inside), it
 * suggests the next three sections — each one a built-in section template. Single-use sections
 * (a hero, a countdown, the FAQ …) are never suggested twice.
 */

export type SectionRole =
  | 'hero'
  | 'products'
  | 'categories'
  | 'trust'
  | 'testimonials'
  | 'faq'
  | 'cta'
  | 'countdown'
  | 'newsletter'
  | 'contact'
  | 'story'
  | 'brands'
  | 'gallery'
  | 'order_form'

export type PageType = 'home' | 'sale' | 'festival' | 'launch' | 'about' | 'contact' | 'page'

export type NextSuggestion = { role: SectionRole; templateId: string; label: string; hint: string }

/** The words of each suggestion (the editor is English). */
export const ROLE_WORDS: Record<SectionRole, { label: string; hint: string }> = {
  hero: { label: 'Big picture with a headline', hint: 'The first thing shoppers see: a picture, a headline and a button.' },
  products: { label: 'Products', hint: 'A grid of your products with a link to the shop.' },
  categories: { label: 'Categories', hint: 'Your categories as picture tiles.' },
  trust: { label: 'Trust badges', hint: 'Delivery, cash on delivery, returns and support in one row.' },
  testimonials: { label: 'Customer reviews', hint: 'What your customers say about you.' },
  faq: { label: 'Questions and answers', hint: 'Answers to the questions shoppers ask most.' },
  cta: { label: 'Call to action', hint: 'A band with one clear button: order, shop or call.' },
  countdown: { label: 'Countdown', hint: 'The time left in your sale.' },
  newsletter: { label: 'Newsletter sign-up', hint: 'Collect email addresses for your offers.' },
  contact: { label: 'Contact form', hint: 'Shoppers send you a message or their phone number.' },
  story: { label: 'Picture and text', hint: 'Tell your story beside a picture.' },
  brands: { label: 'Brand logos', hint: 'The brands you sell.' },
  gallery: { label: 'Photo gallery', hint: 'Several pictures in a grid.' },
  order_form: { label: 'Order form', hint: 'Shoppers order with cash on delivery.' },
}

/** The built-in templates of each role, best first (the first one this store can use wins). */
export const ROLE_TEMPLATES: Record<SectionRole, readonly string[]> = {
  hero: ['classic-sale-hero', 'neutral-image-text'],
  products: ['classic-best-sellers', 'neutral-on-sale-grid', 'classic-collection-tabs'],
  categories: ['classic-categories'],
  trust: ['neutral-trust-strip', 'neutral-why-us-animated', 'neutral-icon-columns', 'classic-service-strip'],
  testimonials: ['neutral-testimonials', 'neutral-review-wall'],
  faq: ['neutral-faq-accordion', 'neutral-faq-teaser'],
  cta: ['neutral-cta-band', 'classic-sale-cta'],
  countdown: ['neutral-flash-sale-bar', 'classic-flash-sale'],
  newsletter: ['neutral-newsletter-inline'],
  contact: ['neutral-contact-form', 'neutral-store-hours-map'],
  story: ['neutral-image-text', 'neutral-scroll-story', 'neutral-how-it-works'],
  brands: ['neutral-brand-strip', 'classic-brand-wall'],
  gallery: ['neutral-photo-gallery', 'neutral-swipe-gallery'],
  order_form: [],
}

/** Sections a page has once. */
const SINGLE_USE: ReadonlySet<SectionRole> = new Set(['hero', 'countdown', 'faq', 'newsletter', 'contact', 'testimonials', 'trust', 'categories', 'brands', 'order_form'])

/** Element type → role (the first match in a section decides). */
const TYPE_ROLES: [SectionRole, readonly string[]][] = [
  ['order_form', ['order_form']],
  ['countdown', ['countdown', 'flash_sale_bar', 'hot_deals']],
  ['hero', ['hero_slider']],
  ['products', ['product_grid', 'product_carousel', 'product_tabs', 'product_listing', 'product_spotlight', 'bundle', 'shop_the_look', 'promo_card']],
  ['categories', ['category_strip', 'category_card']],
  ['testimonials', ['testimonials', 'review_wall', 'quote']],
  ['faq', ['faq_list', 'accordion']],
  ['newsletter', ['newsletter', 'newsletter_form']],
  ['contact', ['contact_form', 'contact_block', 'map', 'store_hours', 'form']],
  ['trust', ['trust_badges', 'features_strip', 'delivery_promise', 'payment_badges', 'icon_box', 'animated_icon', 'comparison_table', 'counter']],
  ['brands', ['brand_strip', 'logo_carousel']],
  ['gallery', ['gallery', 'image_carousel', 'photo_grid', 'horizontal_gallery']],
  ['story', ['scroll_story', 'steps', 'video', 'team']],
  ['cta', ['cta', 'discount']],
]

/** Template id → role, for `props.source_template` (built-in ids and their categories). */
function roleOfTemplate(id: string): SectionRole | null {
  for (const [role, ids] of Object.entries(ROLE_TEMPLATES) as [SectionRole, readonly string[]][]) if (ids.includes(id)) return role
  if (/-hero(-|$)/.test(id)) return 'hero'
  if (/(best-sellers|new-arrivals|top-picks|products|on-sale|deals)/.test(id)) return 'products'
  if (/testimonials|reviews/.test(id)) return 'testimonials'
  if (/faq/.test(id)) return 'faq'
  if (/newsletter/.test(id)) return 'newsletter'
  if (/flash-sale|countdown/.test(id)) return 'countdown'
  if (/categories|aisles/.test(id)) return 'categories'
  return null
}

function elementTypes(columns: readonly Column[], out: string[] = []): string[] {
  for (const column of columns) {
    for (const element of column.elements as Element[]) {
      if (element.hidden) continue
      out.push(element.type)
      if (element.type === 'inner_row') elementTypes((element as InnerRowElement).columns as Column[], out)
    }
  }
  return out
}

/** What a section is for (null: can't tell — plain text, spacing …). */
export function sectionRole(section: Section, index: number): SectionRole | null {
  // A global section reference (B9) has no props or columns of its own here: its role is unknown.
  if (!section.props || !Array.isArray(section.columns)) return null
  const source = (section.props as { source_template?: unknown }).source_template
  if (typeof source === 'string') {
    const role = roleOfTemplate(source)
    if (role) return role
  }
  const types = elementTypes(section.columns)
  for (const [role, list] of TYPE_ROLES) if (types.some((type) => list.includes(type))) return role
  // The first section with a heading, a button and a picture (or a background picture) is a hero.
  const background = section.style?.base?.background
  const picture = types.includes('image') || types.includes('illustration') || background?.type === 'image' || !!background?.video
  if (index === 0 && types.includes('heading') && (types.includes('button') || types.includes('cta')) && picture) return 'hero'
  if (types.includes('image') && (types.includes('heading') || types.includes('text'))) return 'story'
  if (types.includes('button') && types.includes('heading')) return 'cta'
  return null
}

const WORDS: [PageType, RegExp][] = [
  ['festival', /\b(eid|puja|boishakh|ramadan|ramzan|ekushey|victory|independence|11\.11|festival)\b|ঈদ|পূজা|বৈশাখ|রমজান|উৎসব/i],
  ['sale', /\b(sale|offer|offers|discount|deal|deals|flash|clearance|black friday)\b|সেল|অফার|ছাড়|ডিসকাউন্ট/i],
  ['launch', /\b(new|launch|arrival|arrivals|collection)\b|নতুন|কালেকশন/i],
  ['about', /\b(about|story|who we are|our team)\b|আমাদের|গল্প/i],
  ['contact', /\b(contact|reach us|find us|visit us)\b|যোগাযোগ/i],
]

/** What kind of page it is, from its key and title words. */
export function pageTypeOf(doc: { key: string; title: string }): PageType {
  if (doc.key === 'home') return 'home'
  const text = `${doc.key.replace(/^(landing|cms):/, '').replace(/[-_]+/g, ' ')} ${doc.title}`
  for (const [type, re] of WORDS) if (re.test(text)) return type
  return 'page'
}

/** The start of an empty page of each type. */
const START: Record<PageType, SectionRole[]> = {
  home: ['hero', 'products', 'trust'],
  sale: ['hero', 'countdown', 'products'],
  festival: ['hero', 'countdown', 'products'],
  launch: ['hero', 'products', 'gallery'],
  about: ['story', 'testimonials', 'contact'],
  contact: ['contact', 'faq', 'story'],
  page: ['hero', 'products', 'cta'],
}

/** What usually follows a section of each role. */
const AFTER: Record<SectionRole, SectionRole[]> = {
  hero: ['products', 'trust', 'categories'],
  products: ['testimonials', 'faq', 'cta'],
  categories: ['products', 'trust', 'testimonials'],
  trust: ['products', 'testimonials', 'newsletter'],
  testimonials: ['faq', 'cta', 'newsletter'],
  faq: ['cta', 'contact', 'newsletter'],
  cta: ['newsletter', 'faq', 'testimonials'],
  countdown: ['products', 'trust', 'cta'],
  newsletter: ['faq', 'contact', 'cta'],
  contact: ['faq', 'newsletter', 'story'],
  story: ['products', 'testimonials', 'cta'],
  brands: ['testimonials', 'cta', 'newsletter'],
  gallery: ['testimonials', 'cta', 'products'],
  order_form: ['testimonials', 'faq', 'trust'],
}

/** Page-type touches: a sale page wants its countdown right after the hero; an about page a story. */
const PREFER: Partial<Record<PageType, Partial<Record<SectionRole, SectionRole[]>>>> = {
  sale: { hero: ['countdown', 'products', 'trust'] },
  festival: { hero: ['countdown', 'products', 'trust'] },
  about: { hero: ['story', 'testimonials', 'gallery'], story: ['gallery', 'testimonials', 'contact'] },
  contact: { hero: ['contact', 'faq', 'story'] },
  launch: { hero: ['products', 'gallery', 'trust'] },
}

/** Fallbacks when the rules above run out. */
const ANYTIME: SectionRole[] = ['products', 'testimonials', 'cta', 'faq', 'trust', 'newsletter', 'story', 'gallery']

export type NextInput = {
  document: { key: string; title: string }
  sections: readonly Section[]
  /** The section to follow (the selection's section); null = the last one. */
  afterId?: string | null
  /** The template ids this store can insert here (the Templates list); absent = every built-in. */
  available?: ReadonlySet<string> | null
  limit?: number
}

/** The next sections to suggest (up to `limit`, default 3), each with the template to insert. */
export function suggestNextSections(input: NextInput): NextSuggestion[] {
  const { document, sections, afterId = null, available = null, limit = 3 } = input
  const type = pageTypeOf(document)
  const roles = sections.map((section, index) => sectionRole(section, index))
  const present = new Set(roles.filter((r): r is SectionRole => r !== null))
  const anchorIndex = afterId ? sections.findIndex((s) => s.id === afterId) : sections.length - 1
  // The section to follow: the anchor, else the nearest one above it whose role is known.
  let anchor: SectionRole | null = null
  for (let i = Math.min(anchorIndex, sections.length - 1); i >= 0 && anchor === null; i--) anchor = roles[i] ?? null
  const wanted = sections.length === 0 ? START[type] : anchor ? (PREFER[type]?.[anchor] ?? AFTER[anchor]) : START[type].filter((r) => !present.has(r))
  const order = [...wanted, ...(type === 'sale' || type === 'festival' ? ['countdown' as const] : []), ...ANYTIME]
  const out: NextSuggestion[] = []
  const seen = new Set<SectionRole>()
  for (const role of order) {
    if (out.length >= limit) break
    if (seen.has(role)) continue
    seen.add(role)
    if (SINGLE_USE.has(role) && present.has(role)) continue
    // A hero only leads the page.
    if (role === 'hero' && sections.length > 0) continue
    const templateId = ROLE_TEMPLATES[role].find((id) => (!available || available.has(id)) && !out.some((s) => s.templateId === id))
    if (!templateId) continue
    out.push({ role, templateId, ...ROLE_WORDS[role] })
  }
  return out
}
