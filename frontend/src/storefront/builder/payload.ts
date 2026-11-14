import type { BuilderPage, ProductZoneKey, RenderColumn, RenderSection, ZoneKey } from './types'
import type { ProductDetail, StorefrontBootstrap } from '../types'

/** A render payload worth drawing: an object with a sections list. Anything else (null, absent, malformed) = the classic rendering. */
export function isBuilderPayload(value: unknown): value is BuilderPage {
  return typeof value === 'object' && value !== null && Array.isArray((value as BuilderPage).sections)
}

/** The bootstrap's payload of a zone (B4), or null. */
export function zonePayload(bootstrap: Pick<StorefrontBootstrap, 'builder'>, key: ZoneKey): BuilderPage | null {
  const zones = bootstrap.builder?.zones
  const page = zones && Object.hasOwn(zones, key) ? zones[key] : null
  return isBuilderPayload(page) ? page : null
}

/**
 * P1b: a product page zone for this product. The product payload's `zones` are already resolved
 * (product → nearest category → all products, drafts in a staff `?preview=draft`) and are the only
 * source when present; a payload from before P1b keeps the bootstrap's store-wide `product.after`.
 */
export function productZonePayload(product: Pick<ProductDetail, 'zones'>, bootstrap: Pick<StorefrontBootstrap, 'builder'>, key: ProductZoneKey): BuilderPage | null {
  const zones: unknown = product.zones
  if (typeof zones === 'object' && zones !== null) {
    const page = Object.hasOwn(zones, key) ? (zones as Record<string, unknown>)[key] : null
    return isBuilderPayload(page) ? page : null
  }
  return key === 'product.after' ? zonePayload(bootstrap, key) : null
}

/** Whether a payload contains an element of this type that visitors see (the header's announcement replaces the top bar's). */
export function containsElement(page: BuilderPage, type: string): boolean {
  const inColumns = (columns: RenderColumn[] | undefined): boolean =>
    (Array.isArray(columns) ? columns : []).some((column) =>
      (Array.isArray(column.elements) ? column.elements : []).some(
        (element) => !element.hidden && !element.state && (element.type === type || ('columns' in element && inColumns(element.columns as RenderColumn[]))),
      ),
    )
  return page.sections.some((section: RenderSection) => !section.hidden && !section.state && inColumns(section.columns))
}

/** Whether a payload draws a heading of this level (CMS pages keep their title band unless the design has its own h1). */
export function hasHeadingLevel(sections: readonly RenderSection[] | undefined, level: number): boolean {
  const inColumns = (columns: RenderColumn[] | undefined): boolean =>
    (Array.isArray(columns) ? columns : []).some((column) =>
      (Array.isArray(column.elements) ? column.elements : []).some(
        (element) =>
          !element.hidden &&
          !element.state &&
          ((element.type === 'heading' && element.props?.level === level) || (element.type === 'inner_row' && 'columns' in element && inColumns(element.columns))),
      ),
    )
  return (Array.isArray(sections) ? sections : []).some((section) => !section.hidden && !section.state && inColumns(section.columns))
}
