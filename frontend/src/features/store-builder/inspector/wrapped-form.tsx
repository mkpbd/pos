/*
 * Content form of a wrapped homepage section element (hero slider, banner grid, product grids,
 * …): the homepage section editor's own fields (banner chooser with inline create, catalog
 * pickers, tabs, features, testimonials, newsletter, hot deals, blog) on the element's props
 * `{title, subtitle, config, items}`.
 */

import { useState } from 'react'
import { FormField } from '@/components/common/form-field'
import { Input } from '@/components/ui/input'
import type { PickedItem } from '@/features/online-catalog/move'
import type { AnySectionConfig, SectionConfigs } from '@/features/storefront/api'
import { isCatalogSection, SECTION_ITEM_KIND, usesManualItems } from '@/features/storefront/catalog-sections'
import { CatalogSectionFields } from '@/features/storefront/components/catalog-section-fields'
import { sectionTranslations } from '@/features/storefront/components/section-draft'
import { BannerChooser, ConfigFields } from '@/features/storefront/components/section-editor'
import type { BannerSave } from '@/features/storefront/components/banner-form'
import type { WrappedElement } from '@/storefront/builder/types'
import { editPageBanner } from '../api'
import { FieldError, LinkField, NodeBangla } from './fields'
import type { FormProps } from './content-forms'
import type { InspectorCommand } from './types'
import { BANNER_SECTIONS, SECTION_SUBTITLE_MAX, SECTION_TITLE_MAX, sectionInfo } from './validate'

function bannerLimits(node: WrappedElement): { min: number; max: number } {
  const limits = BANNER_SECTIONS[node.type]?.items ?? { min: 1, max: 10 }
  if (node.type === 'banner_grid' && (node.props.config as SectionConfigs['banner_grid']).layout === '3-col-split') return { min: 4, max: 4 }
  return limits
}

const BANNER_UPDATED = 'Banner updated'
const BANNER_COPIED = 'Banner copied for this page — the live store doesn’t change until you publish'

/**
 * The banner chooser's Edit saves through the builder (copy-on-write, see editPageBanner) and
 * tells the editor what happened.
 */
function pageBannerSave(documentId: string, onCommand: (cmd: InspectorCommand) => void): BannerSave {
  return async (id, input) => {
    const result = await editPageBanner(documentId, id, input)
    onCommand({ type: 'banner-edited', bannerId: id, replaced: result.replaced })
    return { banner: result.banner, message: result.replaced ? BANNER_COPIED : BANNER_UPDATED }
  }
}

export function WrappedSectionForm({ node, onChange, errors, bangla, documentId, onCommand }: FormProps<WrappedElement> & { documentId?: string; onCommand?: (cmd: InspectorCommand) => void }) {
  const { title, subtitle, config, items } = node.props
  const type = node.type
  const info = sectionInfo(type)
  // Names of hand-picked records seen in this session, so the list doesn't flash "loading" after each edit.
  const [names, setNames] = useState<Map<string, PickedItem>>(() => new Map())
  const setProps = (patch: Partial<WrappedElement['props']>, key?: string) =>
    onChange({ ...node, props: { ...node.props, ...patch } }, key ? { coalesceKey: `${node.id}:${key}` } : undefined)
  const setConfig = (next: AnySectionConfig) => setProps({ config: next as Record<string, unknown> }, 'config')

  const kind = SECTION_ITEM_KIND[type]
  const picked: PickedItem[] = items.map((i) => names.get(i.item_id) ?? { id: i.item_id, name: '' })
  const bnFields = bangla ? sectionTranslations(type, { title: title ?? '', subtitle: subtitle ?? '', config: config as AnySectionConfig }) : []

  return (
    <div className="flex flex-col gap-4">
      {type !== 'hero_slider' && (
        <>
          <FormField label="Title" error={errors.title} hint="Optional heading above the section.">
            <Input maxLength={SECTION_TITLE_MAX} value={title ?? ''} onChange={(e) => setProps({ title: e.target.value === '' ? null : e.target.value }, 'title')} />
          </FormField>
          <FormField label="Subtitle" error={errors.subtitle}>
            <Input maxLength={SECTION_SUBTITLE_MAX} value={subtitle ?? ''} onChange={(e) => setProps({ subtitle: e.target.value === '' ? null : e.target.value }, 'subtitle')} />
          </FormField>
        </>
      )}

      {info.banner_placement && (
        <BannerChooser
          placement={info.banner_placement}
          value={items.map((i) => i.item_id)}
          onChange={(ids) => setProps({ items: ids.map((item_id) => ({ item_type: 'banner', item_id })) })}
          limits={bannerLimits(node)}
          error={errors.banner_ids}
          saveEdit={documentId && onCommand ? pageBannerSave(documentId, onCommand) : undefined}
          linkInput={LinkField}
        />
      )}

      {isCatalogSection(type) ? (
        <CatalogSectionFields
          type={type}
          config={config as AnySectionConfig}
          onChange={setConfig}
          items={picked}
          onItemsChange={(next) => {
            setNames((current) => {
              const map = new Map(current)
              for (const item of next) if (item.name) map.set(item.id, item)
              return map
            })
            setProps({ items: next.map((i) => ({ item_type: kind ?? 'product', item_id: i.id })) })
          }}
          errors={errors}
        />
      ) : (
        <ConfigFields info={info} config={config as AnySectionConfig} onChange={setConfig} errors={errors} />
      )}
      {errors.item_ids && !usesManualItems(type, config as AnySectionConfig) && <FieldError message={errors.item_ids} />}

      {bnFields.length > 0 && (
        <NodeBangla fields={bnFields} translations={node.translations} errors={errors} onChange={(translations) => onChange({ ...node, translations }, { coalesceKey: `${node.id}:bn` })} />
      )}
    </div>
  )
}
