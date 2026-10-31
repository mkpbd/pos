import type { AnySectionConfig, ProductSource, SectionConfigs, SectionType, TabSource } from '@/features/storefront/api'
import { isSafeLink } from '@/features/storefront/menu-tree'

/** Homepage sections fed by the online catalog (E6). */
export type CatalogSectionType = 'product_carousel' | 'product_grid' | 'product_tabs' | 'category_strip' | 'brand_strip'
export type ItemKind = 'product' | 'category' | 'brand'

export const CATALOG_SECTION_TYPES: readonly SectionType[] = ['product_carousel', 'product_grid', 'product_tabs', 'category_strip', 'brand_strip']

export function isCatalogSection(type: SectionType): type is CatalogSectionType {
  return CATALOG_SECTION_TYPES.includes(type)
}

/** The record kind a section's hand-picked items are, or null when it has none. */
export const SECTION_ITEM_KIND: Partial<Record<SectionType, ItemKind>> = {
  product_carousel: 'product',
  product_grid: 'product',
  category_strip: 'category',
  brand_strip: 'brand',
}

/** Hand-picked items allowed per kind. */
export const MANUAL_ITEM_MAX: Record<ItemKind, number> = { product: 24, category: 16, brand: 24 }

/** Allowed `limit` per section type (inclusive). */
export const LIMIT_RANGE: Record<CatalogSectionType, { min: number; max: number }> = {
  product_carousel: { min: 4, max: 24 },
  product_grid: { min: 4, max: 24 },
  product_tabs: { min: 4, max: 12 },
  category_strip: { min: 4, max: 16 },
  brand_strip: { min: 4, max: 24 },
}

export const MIN_TABS = 2
export const MAX_TABS = 5
export const TAB_LABEL_MAX = 40

export const PRODUCT_SOURCE_LABELS: Record<ProductSource, string> = {
  manual: 'Hand-picked products',
  featured: 'Featured products',
  new_arrivals: 'New arrivals',
  best_sellers: 'Best sellers (last 30 days)',
  on_sale: 'On sale',
  category: 'From a category',
}

export const TAB_SOURCES: TabSource[] = ['featured', 'new_arrivals', 'best_sellers', 'on_sale', 'category']

/** True when the section's config asks for hand-picked items. */
export function usesManualItems(type: SectionType, config: AnySectionConfig): boolean {
  if (!SECTION_ITEM_KIND[type]) return false
  return (config as { source?: string }).source === 'manual'
}

/**
 * Client checks for the catalog section types, keyed like the API's validation errors
 * ("config.limit", "config.tabs.1.label", "item_ids").
 */
export function validateCatalogSection(type: CatalogSectionType, config: AnySectionConfig, itemCount: number): Record<string, string> {
  const errors: Record<string, string> = {}
  const range = LIMIT_RANGE[type]
  const limit = (config as { limit: number }).limit
  if (!Number.isInteger(limit) || limit < range.min || limit > range.max) errors['config.limit'] = `Between ${range.min} and ${range.max}.`

  if (type === 'product_carousel' || type === 'product_grid') {
    const c = config as SectionConfigs['product_carousel']
    if (c.source === 'category' && !c.category_id) errors['config.category_id'] = 'Choose a category.'
    if (c.view_all_url && !isSafeLink(c.view_all_url)) errors['config.view_all_url'] = 'Use a site path such as /shop or an http(s) URL.'
  }

  if (type === 'product_tabs') {
    const tabs = (config as SectionConfigs['product_tabs']).tabs
    if (tabs.length < MIN_TABS || tabs.length > MAX_TABS) errors['config.tabs'] = `Add ${MIN_TABS} to ${MAX_TABS} tabs.`
    tabs.forEach((tab, i) => {
      if (!tab.label.trim()) errors[`config.tabs.${i}.label`] = 'Enter a label.'
      else if (tab.label.trim().length > TAB_LABEL_MAX) errors[`config.tabs.${i}.label`] = `At most ${TAB_LABEL_MAX} characters.`
      if (tab.source === 'category' && !tab.category_id) errors[`config.tabs.${i}.category_id`] = 'Choose a category.'
    })
  }

  const kind = SECTION_ITEM_KIND[type]
  if (kind && usesManualItems(type, config)) {
    const max = MANUAL_ITEM_MAX[kind]
    if (itemCount < 1) errors.item_ids = `Pick at least one ${kind}.`
    else if (itemCount > max) errors.item_ids = `Pick at most ${max}.`
  }

  return errors
}

/** The config as sent: category only with the category source, trimmed labels and links. */
export function normalizeCatalogConfig(type: CatalogSectionType, config: AnySectionConfig): AnySectionConfig {
  if (type === 'product_carousel' || type === 'product_grid') {
    const c = config as SectionConfigs['product_carousel']
    return { ...c, category_id: c.source === 'category' ? c.category_id : null, view_all_url: c.view_all_url?.trim() || null }
  }
  if (type === 'product_tabs') {
    const c = config as SectionConfigs['product_tabs']
    return { ...c, tabs: c.tabs.map((t) => ({ label: t.label.trim(), source: t.source, category_id: t.source === 'category' ? t.category_id : null })) }
  }
  return config
}
