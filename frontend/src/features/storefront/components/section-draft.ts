/*
 * The pure part of the homepage section editor (E5/E12b): the draft it edits, its Bangla fields
 * and its client checks. Shared with the store builder's inspector (B2), which edits the same
 * section types as builder elements.
 */
import type { PickedItem } from '@/features/online-catalog/move'
import type { AnySectionConfig, SectionConfigs, SectionTypeInfo } from '@/features/storefront/api'
import { validateBlogPosts } from '@/features/storefront/blog-posts-section'
import { isCatalogSection, validateCatalogSection } from '@/features/storefront/catalog-sections'
import { validateHotDeals } from '@/features/storefront/hot-deals'
import { validateBn, type BnValues, type TranslationField } from '@/features/translations/translations'

type Errors = Record<string, string>

export type SectionDraft = { title: string; subtitle: string; config: AnySectionConfig; bannerIds: string[]; items: PickedItem[]; isEnabled: boolean; startsAt: string; endsAt: string; bn: BnValues }

/** Every key a section's Bangla texts can use (E12b). */
export const SECTION_TRANSLATION_NAMES = ['title', 'subtitle', 'body_html', 'text', 'button_label']

/**
 * The Bangla fields of a section type, with the English values of the draft: the title and
 * subtitle (hero sliders have neither; their banners carry the text), the rich-text body and
 * the newsletter's line and button.
 */
export function sectionTranslations(type: SectionTypeInfo['type'], d: Pick<SectionDraft, 'title' | 'subtitle' | 'config'>): TranslationField[] {
  if (type === 'hero_slider') return []
  const fields: TranslationField[] = [
    { name: 'title', label: 'Title', base: d.title, max: 120 },
    { name: 'subtitle', label: 'Subtitle', base: d.subtitle, max: 255 },
  ]
  if (type === 'rich_text') fields.push({ name: 'body_html', label: 'Section text', base: (d.config as SectionConfigs['rich_text']).body_html, kind: 'rich' })
  if (type === 'newsletter') {
    const c = d.config as SectionConfigs['newsletter']
    fields.push({ name: 'text', label: 'Newsletter text', base: c.text, max: 255 }, { name: 'button_label', label: 'Button label', base: c.button_label, max: 30 })
  }
  return fields
}

/** Client checks before saving, keyed like the API's validation errors. */
export function validateSectionDraft(info: SectionTypeInfo, d: SectionDraft): Errors {
  const errors: Errors = isCatalogSection(info.type) ? validateCatalogSection(info.type, d.config, d.items.length) : {}
  if (info.banner_placement && info.items) {
    let { min, max } = info.items
    if (info.type === 'banner_grid') {
      const layout = (d.config as SectionConfigs['banner_grid']).layout
      min = { '2-col': 2, '3-col': 3, '3-col-split': 4, '4-col': 4 }[layout]
      if (layout === '3-col-split') max = 4
    }
    if (d.bannerIds.length < min || d.bannerIds.length > max) errors.banner_ids = min === max ? `Choose exactly ${min} banners.` : `Choose ${min} to ${max} banners.`
  }
  if (info.type === 'hot_deals') Object.assign(errors, validateHotDeals(d.config as SectionConfigs['hot_deals']))
  if (info.type === 'blog_posts') Object.assign(errors, validateBlogPosts(d.config as SectionConfigs['blog_posts']))
  if (info.type === 'rich_text' && !(d.config as SectionConfigs['rich_text']).body_html) errors['config.body_html'] = 'Write some text.'
  if (info.type === 'features_strip' || info.type === 'testimonials') {
    const items = (d.config as SectionConfigs['features_strip'] | SectionConfigs['testimonials']).items
    if (items.length === 0) errors['config.items'] = 'Add at least one.'
    items.forEach((item, i) => {
      if ('title' in item && !item.title.trim()) errors[`config.items.${i}.title`] = 'Enter a title.'
      if ('quote' in item && !item.quote.trim()) errors[`config.items.${i}.quote`] = 'Enter the quote.'
      if ('name' in item && !item.name.trim()) errors[`config.items.${i}.name`] = 'Enter a name.'
    })
  }
  if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) errors.ends_at = 'The end must be after the start.'
  Object.assign(errors, validateBn(d.bn, sectionTranslations(info.type, d)))
  return errors
}
