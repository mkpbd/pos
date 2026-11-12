/*
 * Test helpers: the shared sample document (lead-owned fixture) and a render payload built from it
 * the way the backend resolves one (translations applied for a locale, hidden / off-schedule nodes
 * dropped from published pages or marked in a draft, wrapped-section data from /store/homepage).
 */

import { productCard } from '../test-fixtures'
import type { StoreBanner, StoreSection } from '../types'
import fixture from './__fixtures__/sample-document.v1.json'
import { elementMeta, isTranslatableKey, isWrappedSectionType } from './registry'
import type { BuilderData, BuilderDocument, BuilderMedia, BuilderPage, Element, NodeState, Section } from './types'

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
  for (const [key, value] of Object.entries(texts)) {
    if (!isTranslatableKey(node.type, key)) continue
    if (isWrappedSectionType(node.type) && key !== 'title' && key !== 'subtitle') (props.config as Record<string, unknown>)[key] = value
    else if (key.includes('.')) {
      // A nested prop (`primary.label`), a list item field by item id (`items.<item_id>.title`,
      // B8a nested `plans.<plan_id>.features.<feature_id>.text`, `rows.<row_id>.cells.<column_id>.text`)
      // or a chart label by index (`labels.<index>`).
      const path = key.split('.')
      let target: unknown = props
      for (const segment of path.slice(0, -1)) {
        if (Array.isArray(target)) target = target.find((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).id === segment)
        else target = target && typeof target === 'object' ? (target as Record<string, unknown>)[segment] : undefined
      }
      const last = path[path.length - 1]!
      if (Array.isArray(target)) {
        const index = Number(last)
        if (Number.isInteger(index) && index >= 0 && index < target.length) target[index] = value
      } else if (target && typeof target === 'object') (target as Record<string, unknown>)[last] = value
    } else props[key] = value
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

/* ----------------------------------------------------------------------------------------------
 * B4 helpers: a document of given elements (one boxed section, one full-width column each row)
 * -------------------------------------------------------------------------------------------- */

const VISIBLE = { desktop: true, tablet: true, mobile: true }

/** An element node with the registry's defaults under `props`. */
export function elementNode(type: string, id: string, props: Record<string, unknown> = {}, extra: Partial<Element> = {}): Element {
  const defaults = structuredClone((elementMeta(type)?.props ?? {}) as Record<string, unknown>)
  return { id, type, props: { ...defaults, ...props }, style: {}, visibility: VISIBLE, hidden: false, schedule: null, translations: {}, ...extra } as unknown as Element
}

/** A document with one section per list of elements. */
export function documentOf(...rows: Element[][]): BuilderDocument {
  const sections: Section[] = rows.map((elements, i) => ({
    id: `s_row${i}`,
    type: 'section',
    props: { layout: 'boxed', anchor: null },
    style: {},
    visibility: VISIBLE,
    hidden: false,
    schedule: null,
    translations: {},
    columns: [{ id: `c_row${i}`, type: 'column', width: { base: 100 }, style: {}, elements }],
  }))
  return { schema_version: 1, sections }
}

/** The render payload of a document (published unless `source: 'draft'`) with the given `data`. */
export function payloadOf(
  document: BuilderDocument,
  options: { key?: string; title?: string; source?: 'published' | 'draft'; locale?: string; data?: Record<string, BuilderData>; media?: Record<string, BuilderMedia> } = {},
): BuilderPage {
  const page = samplePage({ document, key: options.key, title: options.title, source: options.source, locale: options.locale })
  return { ...page, data: options.data ?? {}, media: options.media ?? sampleMedia }
}
