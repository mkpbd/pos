/*
 * Test helpers: the shared sample document (lead-owned fixture) and a render payload built from it
 * the way the backend resolves one (translations applied for a locale, hidden / off-schedule nodes
 * dropped from published pages or marked in a draft, wrapped-section data from /store/homepage).
 */

import { productCard } from '../test-fixtures'
import type { StoreBanner, StoreSection } from '../types'
import fixture from './__fixtures__/sample-document.v1.json'
import { elementMeta, isWrappedSectionType } from './registry'
import type { BuilderDocument, BuilderMedia, BuilderPage, NodeState } from './types'

export const sampleDocument = fixture as unknown as BuilderDocument

/** A deep copy of the sample document, safe to change in a test. */
export function cloneSample(): BuilderDocument {
  return structuredClone(sampleDocument)
}

export const IMAGE_MEDIA_ID = '01a1c9d9-0000-7000-8000-000000000002'

export const sampleMedia: Record<string, BuilderMedia> = {
  [IMAGE_MEDIA_ID]: { url: '/storage/media/o/vegetables.jpg', srcset: '/storage/media/o/vegetables-640.webp 640w, /storage/media/o/vegetables.jpg 1600w', width: 1600, height: 1200, alt: null },
}

const heroImage = { id: 'img-hero', url: '/storage/media/o/hero.jpg', srcset: '/storage/media/o/hero.jpg 1600w', width: 1600, height: 600, alt: null }

export const sampleBanner: StoreBanner = {
  id: '01a1c9d9-0000-7000-8000-000000000001',
  kicker: 'This week',
  title: 'Farm boxes are back',
  subtitle: null,
  link_url: '/shop',
  button_label: 'Order a box',
  secondary_link_url: null,
  secondary_button_label: null,
  image: heroImage,
  mobile_image: null,
  text_color: '#ffffff',
  text_position: 'left',
}

/** What /store/homepage returns for the sample's two wrapped sections (id = element id). */
export function sampleData(locale = 'en'): Record<string, StoreSection> {
  return {
    e_slider: { id: 'e_slider', type: 'hero_slider', title: null, subtitle: null, config: { autoplay_seconds: 0, height: 'large' }, banners: [sampleBanner] },
    e_grid: {
      id: 'e_grid',
      type: 'product_grid',
      title: locale === 'bn' ? 'সবচেয়ে বেশি বিক্রি' : 'Best sellers',
      subtitle: 'What everyone is buying',
      config: { source: 'best_sellers', limit: 8, columns: 4, view_all_url: '/shop?sort=popularity' },
      products: [productCard('fresh-spinach'), productCard('organic-carrots')],
    },
  }
}

type AnyNode = Record<string, unknown> & { id: string; type: string; props?: Record<string, unknown>; columns?: AnyColumn[] }
type AnyColumn = Record<string, unknown> & { elements: AnyNode[] }

function resolveNode(node: AnyNode, locale: string, draft: boolean): AnyNode | null {
  const { translations, ...rest } = node as AnyNode & { translations?: Record<string, Record<string, string>> }
  const props = structuredClone(node.props ?? {})
  const texts = translations?.[locale] ?? {}
  const translatable = elementMeta(node.type)?.translatable ?? []
  for (const [key, value] of Object.entries(texts)) {
    if (!translatable.includes(key)) continue
    if (isWrappedSectionType(node.type) && key !== 'title' && key !== 'subtitle') (props.config as Record<string, unknown>)[key] = value
    else props[key] = value
  }
  const out: AnyNode = { ...rest, props }
  let state: NodeState | null = null
  if (node.hidden === true) state = 'hidden'
  if (state && !draft) return null
  if (state) out.state = state
  if (Array.isArray(node.columns)) out.columns = node.columns.map((column) => resolveColumn(column, locale, draft))
  return out
}

function resolveColumn(column: AnyColumn, locale: string, draft: boolean): AnyColumn {
  return { ...column, elements: column.elements.map((element) => resolveNode(element, locale, draft)).filter((element): element is AnyNode => element !== null) }
}

/** The render payload of the sample document (published unless `source: 'draft'`). */
export function samplePage(options: { locale?: string; source?: 'published' | 'draft'; document?: BuilderDocument; key?: string; title?: string } = {}): BuilderPage {
  const locale = options.locale ?? 'en'
  const draft = options.source === 'draft'
  const document = options.document ?? sampleDocument
  const sections = (document.sections as unknown as AnyNode[]).map((section) => resolveNode(section, locale, draft)).filter((section): section is AnyNode => section !== null)
  return {
    document: { id: '01a1c9d9-0000-7000-8000-0000000000d1', key: options.key ?? 'home', title: options.title ?? 'Home', version: draft ? null : 3, source: draft ? 'draft' : 'published' },
    sections: sections as unknown as BuilderPage['sections'],
    media: sampleMedia,
    data: sampleData(locale),
  }
}
