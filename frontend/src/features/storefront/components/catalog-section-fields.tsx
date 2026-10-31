import { useMemo } from 'react'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { flattenCategoryTree, useCatalogList } from '@/features/catalog/api'
import { OptionPicker, ProductPicker } from '@/features/online-catalog/components/ordered-picker'
import { moveItem, type PickedItem } from '@/features/online-catalog/move'
import { useProductNames } from '@/features/products/api'
import { PRODUCT_SOURCES, type AnySectionConfig, type ProductSource, type ProductTab, type SectionConfigs, type TabSource } from '@/features/storefront/api'
import {
  LIMIT_RANGE,
  MANUAL_ITEM_MAX,
  MAX_TABS,
  PRODUCT_SOURCE_LABELS,
  SECTION_ITEM_KIND,
  TAB_LABEL_MAX,
  TAB_SOURCES,
  usesManualItems,
  type CatalogSectionType,
} from '@/features/storefront/catalog-sections'

type Errors = Record<string, string>

type Props = {
  type: CatalogSectionType
  config: AnySectionConfig
  onChange: (config: AnySectionConfig) => void
  /** Hand-picked items; names may be empty for records not yet looked up. */
  items: PickedItem[]
  onItemsChange: (items: PickedItem[]) => void
  errors: Errors
}

const range = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i)

function LimitField({ type, value, onChange, error, label = 'How many' }: { type: CatalogSectionType; value: number; onChange: (n: number) => void; error?: string; label?: string }) {
  const { min, max } = LIMIT_RANGE[type]
  return (
    <FormField label={label} error={error}>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="w-full" aria-label={label}><SelectValue /></SelectTrigger>
        <SelectContent>{range(min, max).map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
      </Select>
    </FormField>
  )
}

function CategorySelect({ label, value, onChange, options, error }: { label: string; value: string | null; onChange: (id: string) => void; options: { id: string; path: string }[]; error?: string }) {
  return (
    <FormField label={label} error={error}>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="w-full" aria-label={label}><SelectValue placeholder="Choose a category" /></SelectTrigger>
        <SelectContent>{options.map((c) => <SelectItem key={c.id} value={c.id}>{c.path}</SelectItem>)}</SelectContent>
      </Select>
    </FormField>
  )
}

function TabsEditor({ tabs, onChange, categories, errors }: { tabs: ProductTab[]; onChange: (tabs: ProductTab[]) => void; categories: { id: string; path: string }[]; errors: Errors }) {
  const patch = (i: number, p: Partial<ProductTab>) => onChange(tabs.map((t, j) => (j === i ? { ...t, ...p } : t)))

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium">Tabs</span>
      {tabs.map((tab, i) => (
        <fieldset key={i} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <legend className="sr-only">Tab {i + 1}</legend>
          <div className="flex flex-col gap-1">
            <Input aria-label={`Tab ${i + 1} label`} placeholder="Label, e.g. New arrivals" maxLength={TAB_LABEL_MAX} value={tab.label} aria-invalid={errors[`config.tabs.${i}.label`] ? true : undefined} onChange={(e) => patch(i, { label: e.target.value })} />
            {errors[`config.tabs.${i}.label`] && <p className="text-sm text-destructive">{errors[`config.tabs.${i}.label`]}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Select value={tab.source} onValueChange={(v) => patch(i, { source: v as TabSource })}>
              <SelectTrigger aria-label={`Tab ${i + 1} products`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{TAB_SOURCES.map((s) => <SelectItem key={s} value={s}>{PRODUCT_SOURCE_LABELS[s]}</SelectItem>)}</SelectContent>
            </Select>
            {tab.source === 'category' && (
              <Select value={tab.category_id ?? undefined} onValueChange={(id) => patch(i, { category_id: id })}>
                <SelectTrigger aria-label={`Tab ${i + 1} category`} className="w-full"><SelectValue placeholder="Choose a category" /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.path}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {errors[`config.tabs.${i}.category_id`] && <p className="text-sm text-destructive">{errors[`config.tabs.${i}.category_id`]}</p>}
          </div>
          <div className="flex items-start">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move tab ${i + 1} up`} disabled={i === 0} onClick={() => onChange(moveItem(tabs, i, -1))}><ArrowUpIcon /></Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move tab ${i + 1} down`} disabled={i === tabs.length - 1} onClick={() => onChange(moveItem(tabs, i, 1))}><ArrowDownIcon /></Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove tab ${i + 1}`} onClick={() => onChange(tabs.filter((_, j) => j !== i))}><Trash2Icon /></Button>
          </div>
        </fieldset>
      ))}
      {tabs.length < MAX_TABS && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onChange([...tabs, { label: '', source: 'new_arrivals', category_id: null }])}>
          <PlusIcon data-icon="inline-start" /> Add tab
        </Button>
      )}
      {errors['config.tabs'] && <p className="text-sm text-destructive">{errors['config.tabs']}</p>}
    </div>
  )
}

/** Config and hand-picked items of the product, category and brand homepage sections. */
export function CatalogSectionFields({ type, config, onChange, items, onItemsChange, errors }: Props) {
  const kind = SECTION_ITEM_KIND[type]
  const manual = usesManualItems(type, config)
  const needsCategories = type === 'product_carousel' || type === 'product_grid' || type === 'product_tabs' || type === 'category_strip'
  const categoryList = useCatalogList('categories', needsCategories)
  const brandList = useCatalogList('brands', type === 'brand_strip')
  const categories = useMemo(() => flattenCategoryTree(categoryList.data ?? []).filter((c) => c.is_active), [categoryList.data])
  const productNames = useProductNames(kind === 'product' ? items.filter((i) => !i.name).map((i) => i.id) : [])

  // Items kept by id only get their names from the lookups.
  const named = items.map((item): PickedItem => {
    if (item.name) return item
    if (kind === 'product') {
      const found = productNames.get(item.id)
      return { ...item, name: found?.name ?? 'Product not found', image_url: found?.image_url ?? null }
    }
    const source = kind === 'category' ? categories.map((c) => ({ id: c.id, name: c.path })) : (brandList.data ?? [])
    return { ...item, name: source.find((s) => s.id === item.id)?.name ?? `${kind === 'category' ? 'Category' : 'Brand'} not found` }
  })

  if (type === 'product_carousel' || type === 'product_grid') {
    const c = config as SectionConfigs['product_grid']
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Products" error={errors['config.source']}>
            <Select value={c.source} onValueChange={(v) => onChange({ ...c, source: v as ProductSource })}>
              <SelectTrigger className="w-full" aria-label="Products"><SelectValue /></SelectTrigger>
              <SelectContent>{PRODUCT_SOURCES.map((s) => <SelectItem key={s} value={s}>{PRODUCT_SOURCE_LABELS[s]}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          {c.source === 'category' && (
            <CategorySelect label="Category" value={c.category_id} onChange={(category_id) => onChange({ ...c, category_id })} options={categories} error={errors['config.category_id']} />
          )}
          {!manual && <LimitField type={type} value={c.limit} onChange={(limit) => onChange({ ...c, limit })} error={errors['config.limit']} label="Number of products" />}
          {type === 'product_grid' && (
            <FormField label="Columns on desktop" error={errors['config.columns']}>
              <Select value={String(c.columns)} onValueChange={(v) => onChange({ ...c, columns: Number(v) as 3 | 4 | 5 })}>
                <SelectTrigger className="w-full" aria-label="Columns on desktop"><SelectValue /></SelectTrigger>
                <SelectContent>{[3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
          )}
          <FormField label="“View all” link" error={errors['config.view_all_url']} hint="Optional, e.g. /shop or /category/juices.">
            <Input spellCheck={false} maxLength={255} value={c.view_all_url ?? ''} onChange={(e) => onChange({ ...c, view_all_url: e.target.value || null })} />
          </FormField>
        </div>
        {manual && (
          <ProductPicker label="Chosen products" addLabel="Add product" value={named} onChange={onItemsChange} max={MANUAL_ITEM_MAX.product} error={errors.item_ids} hint={`Shown in this order, up to ${MANUAL_ITEM_MAX.product}. Unpublished products are skipped.`} />
        )}
      </div>
    )
  }

  if (type === 'product_tabs') {
    const c = config as SectionConfigs['product_tabs']
    return (
      <div className="flex flex-col gap-4">
        <TabsEditor tabs={c.tabs} onChange={(tabs) => onChange({ ...c, tabs })} categories={categories} errors={errors} />
        <div className="grid gap-4 sm:grid-cols-2">
          <LimitField type={type} value={c.limit} onChange={(limit) => onChange({ ...c, limit })} error={errors['config.limit']} label="Products per tab" />
        </div>
      </div>
    )
  }

  if (type === 'category_strip') {
    const c = config as SectionConfigs['category_strip']
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Categories">
            <Select value={c.source} onValueChange={(v) => onChange({ ...c, source: v as 'manual' | 'top_level' })}>
              <SelectTrigger className="w-full" aria-label="Categories"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="top_level">Top-level categories</SelectItem>
                <SelectItem value="manual">Hand-picked categories</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          {!manual && <LimitField type={type} value={c.limit} onChange={(limit) => onChange({ ...c, limit })} error={errors['config.limit']} label="Number of categories" />}
        </div>
        {manual && (
          <OptionPicker
            label="Chosen categories"
            addLabel="Add category"
            value={named}
            onChange={onItemsChange}
            options={categories.map((cat) => ({ id: cat.id, name: cat.path }))}
            max={MANUAL_ITEM_MAX.category}
            error={errors.item_ids}
            hint={`Shown in this order, up to ${MANUAL_ITEM_MAX.category}. Categories hidden on the web are skipped.`}
          />
        )}
      </div>
    )
  }

  const c = config as SectionConfigs['brand_strip']
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Brands">
          <Select value={c.source} onValueChange={(v) => onChange({ ...c, source: v as 'manual' | 'all' })}>
            <SelectTrigger className="w-full" aria-label="Brands"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All visible brands</SelectItem>
              <SelectItem value="manual">Hand-picked brands</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        {!manual && <LimitField type={type} value={c.limit} onChange={(limit) => onChange({ ...c, limit })} error={errors['config.limit']} label="Number of brands" />}
      </div>
      {manual && (
        <OptionPicker
          label="Chosen brands"
          addLabel="Add brand"
          value={named}
          onChange={onItemsChange}
          options={(brandList.data ?? []).filter((b) => b.is_active).map((b) => ({ id: b.id, name: b.name }))}
          max={MANUAL_ITEM_MAX.brand}
          error={errors.item_ids}
          hint={`Shown in this order, up to ${MANUAL_ITEM_MAX.brand}. Brands hidden on the web are skipped.`}
        />
      )}
    </div>
  )
}
