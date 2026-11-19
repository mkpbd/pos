/*
 * Content tab forms of the B14 elements: live text ("Text from this page": what to show, grouped
 * by where it comes from, with the value the sample gives), the product listing (which products,
 * filters, their place, order, products per page and per row), the blog post, the order details
 * and the page-not-found message. Field lists and rules: ./b14-model.ts; the sample: ../template-sample.tsx.
 */

import { useId, useState } from 'react'
import { EyeIcon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { BlogPostBodyElement, DynamicTextElement, Element, NotFoundMessageElement, OrderSummaryElement, ProductListingElement } from '@/storefront/builder/types'
import { formatDynamicText } from '@/storefront/builder/templates/context'
import type { ProductListingFilters, StoreTemplateKey } from '@/storefront/builder/templates/types'
import { B14_LIMITS, B14_TEXT_LIMITS } from '@/storefront/builder/validate'
import { sampleOptions, useLinkTargetsForSample } from '../store-pages-api'
import { sampleFieldText, sampleLabel, useTemplateSample } from '../template-sample-state'
import {
  COLUMN_DEVICES,
  CURRENT_SCOPE_TEXT,
  FILTER_LAYOUTS,
  FILTER_OPTIONS,
  FORMAT_OPTIONS,
  PAGE_SCOPES,
  PAGINATION_OPTIONS,
  PER_PAGE_OPTIONS,
  SORT_OPTIONS,
  TAG_OPTIONS,
  columnOptions,
  fieldGroups,
  fieldLabel,
  isListingTemplate,
  toggleId,
} from './b14-model'
import { FieldError } from './fields'
import { Bangla, Note } from './form-kit'
import { patch, type ElementFormProps } from './form-model'
import { ChoiceField, ManageLink, TextField, ToggleField } from './pickers'

export type B14FormProps<N> = ElementFormProps<N> & {
  /** The store page of a template document (null: a normal page). */
  template: StoreTemplateKey | null
}

/* ----------------------------------------------------------------------------------------------
 * Live text
 * -------------------------------------------------------------------------------------------- */

/** "With the sample: <value>" — what the live text shows now (the editor's sample). */
function LivePreview({ node }: { node: DynamicTextElement }) {
  const sample = useTemplateSample()
  const p = node.props
  if (!sample) return null
  const value = sample.context ? formatDynamicText(p.prefix, sampleFieldText(sample.context, p.field, p.format), p.suffix, '') : null
  const what = sample.template && sample.context?.template ? sampleLabel(sample.template, sample.context, sampleOptions(sample.template, undefined, sample.choices), sample.choice) : null
  return (
    <div role="status" aria-live="polite" data-testid="dynamic-preview" className="flex flex-col gap-1 rounded-md border bg-muted/40 p-3 text-sm">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <EyeIcon className="size-3.5" aria-hidden /> {what ? `With the sample (${what})` : 'With your store’s details'}
      </span>
      {sample.context === null ? (
        <span className="text-muted-foreground">Loading the sample…</span>
      ) : value !== null ? (
        <span className="font-medium break-words" data-testid="dynamic-preview-value">{value}</span>
      ) : p.fallback.trim() !== '' ? (
        <span>
          No value here, so shoppers see: <span className="font-medium">{p.fallback}</span>
        </span>
      ) : (
        <span>No value here, so nothing shows. Add a text for when it’s empty.</span>
      )}
    </div>
  )
}

export function DynamicTextForm(props: B14FormProps<DynamicTextElement>) {
  const { node, onChange, errors, template } = props
  const p = node.props
  const set = (values: Partial<DynamicTextElement['props']>, key?: string) => patch(node, onChange, values, key)
  const groups = fieldGroups(template)
  const known = groups.some((g) => g.fields.some((f) => f.value === p.field))
  const L = B14_TEXT_LIMITS.dynamic_text
  return (
    <div className="flex flex-col gap-4">
      <Note>Shows a detail of the page it is on — for example the category’s name on every category page — so one design fits them all.</Note>
      <FormField label="What to show" error={errors.field} hint={template ? undefined : 'On a normal page: your store’s details. Store pages offer their own, such as the category name.'}>
        <Select value={known ? p.field : undefined} onValueChange={(field) => set({ field: field as DynamicTextElement['props']['field'] })}>
          <SelectTrigger className="w-full" aria-label="What to show" data-testid="dynamic-field">
            <SelectValue placeholder={known ? undefined : `${fieldLabel(p.field)} (not on this page)`} />
          </SelectTrigger>
          <SelectContent>
            {groups.map((group) => (
              <SelectGroup key={group.source}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.fields.map((field) => (
                  <SelectItem key={field.value} value={field.value}>
                    {field.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <LivePreview node={node} />
      <TextField label="Words before" hint="Optional, e.g. “Shop”." value={p.prefix} max={L.prefix} error={errors.prefix} onChange={(prefix) => set({ prefix }, 'prefix')} />
      <TextField label="Words after" hint="Optional, e.g. “products”." value={p.suffix} max={L.suffix} error={errors.suffix} onChange={(suffix) => set({ suffix }, 'suffix')} />
      <TextField
        label="Text when empty"
        hint="Shown when the page has no value (e.g. a category without a description). Leave empty to hide it then."
        value={p.fallback}
        max={L.fallback}
        error={errors.fallback}
        onChange={(fallback) => set({ fallback }, 'fallback')}
      />
      <ChoiceField label="Text style" value={p.tag} options={TAG_OPTIONS} error={errors.tag} hint="Search engines read headings as the page outline." onChange={(tag) => set({ tag })} />
      <ChoiceField label="Show as" value={p.format} options={FORMAT_OPTIONS} error={errors.format} hint="Bangla pages show Bangla digits when your store uses them." onChange={(format) => set({ format })} />
      <Bangla
        {...props}
        fields={[
          { name: 'prefix', label: 'Words before', base: p.prefix },
          { name: 'suffix', label: 'Words after', base: p.suffix },
          { name: 'fallback', label: 'Text when empty', base: p.fallback },
        ]}
      />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Product listing
 * -------------------------------------------------------------------------------------------- */

function IdChecklist({ legend, options, ids, onChange, error, empty, loading }: {
  legend: string
  options: { id: string; label: string }[]
  ids: string[]
  onChange: (ids: string[]) => void
  error?: string
  empty: string
  loading: boolean
}) {
  const groupId = useId()
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  const known = new Set(options.map((o) => o.id))
  const gone = loading ? [] : ids.filter((id) => !known.has(id))
  const atMax = ids.length >= B14_LIMITS.scopeIds.max
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? `${groupId}-error` : undefined}>
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && options.length === 0 && <p className="text-sm text-muted-foreground">{empty}</p>}
      {options.length > 8 && <Input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={`Find in ${legend.toLowerCase()}`} placeholder="Find…" />}
      <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
        {shown.map((option) => {
          const id = `${groupId}-${option.id}`
          const on = ids.includes(option.id)
          return (
            <div key={option.id} className="flex items-center gap-2">
              <Checkbox id={id} checked={on} disabled={!on && atMax} onCheckedChange={(next) => onChange(toggleId(ids, option.id, next === true))} />
              <Label htmlFor={id} className="font-normal">
                {option.label}
              </Label>
            </div>
          )
        })}
      </div>
      {gone.length > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-amber-300/70 bg-amber-50 p-2 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          <span>{gone.length === 1 ? 'One ticked item no longer exists.' : `${gone.length} ticked items no longer exist.`}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(ids.filter((id) => known.has(id)))}>
            Untick
          </Button>
        </div>
      )}
      {atMax && <p className="text-sm text-muted-foreground">At most {B14_LIMITS.scopeIds.max}.</p>}
      <span id={`${groupId}-error`}>
        <FieldError message={error} />
      </span>
    </fieldset>
  )
}

export function ProductListingForm(props: B14FormProps<ProductListingElement>) {
  const { node, onChange, errors, template } = props
  const p = node.props
  const set = (values: Partial<ProductListingElement['props']>) => patch(node, onChange, values)
  const listing = isListingTemplate(template)
  const scoped = !listing && (p.scope === 'categories' || p.scope === 'brands')
  const targets = useLinkTargetsForSample(scoped)
  const filtersId = useId()
  const filters: ProductListingFilters = p.filters
  const pageScope = PAGE_SCOPES.some((s) => s.value === p.scope) ? p.scope : undefined
  return (
    <div className="flex flex-col gap-4">
      {listing ? (
        <div className="flex flex-col gap-2">
          <Note>{template ? CURRENT_SCOPE_TEXT[template] : null}</Note>
          {p.scope !== 'current' && (
            <>
              <FieldError message={errors.scope} />
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => set({ scope: 'current' })}>
                Show this page’s products
              </Button>
            </>
          )}
        </div>
      ) : (
        <FormField label="Products shown" error={errors.scope}>
          <Select value={pageScope} onValueChange={(scope) => set({ scope: scope as ProductListingElement['props']['scope'] })}>
            <SelectTrigger className="w-full" aria-label="Products shown" data-testid="listing-scope">
              <SelectValue placeholder="Choose which products to show" />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SCOPES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
      {!listing && p.scope === 'categories' && (
        <IdChecklist
          legend="Categories"
          options={sampleOptions('category', targets.data)}
          ids={p.category_ids}
          loading={targets.isPending}
          empty="You have no categories yet."
          error={errors.category_ids}
          onChange={(category_ids) => set({ category_ids })}
        />
      )}
      {!listing && p.scope === 'brands' && (
        <IdChecklist
          legend="Brands"
          options={sampleOptions('brand', targets.data)}
          ids={p.brand_ids}
          loading={targets.isPending}
          empty="You have no brands yet."
          error={errors.brand_ids}
          onChange={(brand_ids) => set({ brand_ids })}
        />
      )}
      <fieldset className="flex flex-col gap-2" data-testid="listing-filters">
        <legend className="mb-1 text-sm font-medium">Filters shoppers can use</legend>
        {FILTER_OPTIONS.map(({ key, label }) => {
          const id = `${filtersId}-${key}`
          return (
            <div key={key} className="flex items-center gap-2">
              <Checkbox id={id} checked={filters[key] === true} onCheckedChange={(next) => set({ filters: { ...filters, [key]: next === true } })} />
              <Label htmlFor={id} className="font-normal">
                {label}
              </Label>
            </div>
          )
        })}
        <FieldError message={errors.filters} />
      </fieldset>
      <ChoiceField label="Where the filters sit" value={p.filter_layout} options={FILTER_LAYOUTS} error={errors.filter_layout} hint="On phones the filters open from a button." onChange={(filter_layout) => set({ filter_layout })} />
      <ChoiceField label="Order at first" value={p.sort_default} options={SORT_OPTIONS} error={errors.sort_default} hint="Shoppers can change the order." onChange={(sort_default) => set({ sort_default })} />
      <ChoiceField label="Products per page" value={String(p.per_page)} options={PER_PAGE_OPTIONS} error={errors.per_page} onChange={(value) => set({ per_page: Number(value) })} />
      <ChoiceField label="More products" value={p.pagination} options={PAGINATION_OPTIONS} error={errors.pagination} onChange={(pagination) => set({ pagination })} />
      <fieldset className="flex flex-col gap-3" data-testid="listing-columns">
        <legend className="mb-1 text-sm font-medium">Products in a row</legend>
        {COLUMN_DEVICES.map(({ device, label }) => (
          <ChoiceField
            key={device}
            label={label}
            value={String(p.columns[device])}
            options={columnOptions(device)}
            onChange={(value) => set({ columns: { ...p.columns, [device]: Number(value) } as ProductListingElement['props']['columns'] })}
          />
        ))}
        <FieldError message={errors.columns} />
      </fieldset>
      <ToggleField label="Show how many products there are" checked={p.show_count} onChange={(show_count) => set({ show_count })} />
      <Note>Product cards use your store’s card style. Filters and the page number stay in the address, so shoppers can share a filtered list and go back.</Note>
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Blog post, order details, page not found
 * -------------------------------------------------------------------------------------------- */

export function BlogPostBodyForm(props: B14FormProps<BlogPostBodyElement>) {
  const { node, onChange } = props
  const p = node.props
  const set = (values: Partial<BlogPostBodyElement['props']>) => patch(node, onChange, values)
  return (
    <div className="flex flex-col gap-4">
      <Note>The post’s title, text and tags come from the post itself, so each reader sees the post they opened.</Note>
      <ToggleField label="Show the cover picture" checked={p.show_cover} onChange={(show_cover) => set({ show_cover })} />
      <ToggleField label="Show the writer, date, reading time and category" checked={p.show_meta} onChange={(show_meta) => set({ show_meta })} />
      <ToggleField label="Show the share buttons" checked={p.show_share} onChange={(show_share) => set({ show_share })} />
      <ToggleField label="Show related posts at the end" checked={p.show_related} onChange={(show_related) => set({ show_related })} />
      <ManageLink to="/content/blog">Blog posts</ManageLink>
    </div>
  )
}

type OrderProps = OrderSummaryElement['props'] & { show_items?: boolean }

export function OrderSummaryForm(props: B14FormProps<OrderSummaryElement>) {
  const { node, onChange } = props
  const p = node.props as OrderProps
  const set = (values: Partial<OrderProps>) => patch(node, onChange, values as Partial<OrderSummaryElement['props']>)
  return (
    <div className="flex flex-col gap-4">
      <Note>Each shopper sees only their own order. Here, the sample hides names, phone numbers and addresses.</Note>
      <ToggleField label="Show the order’s progress" hint="Placed, confirmed, shipped, delivered." checked={p.show_timeline} onChange={(show_timeline) => set({ show_timeline })} />
      <ToggleField label="Show the products and totals" checked={p.show_items !== false} onChange={(show_items) => set({ show_items })} />
      <ToggleField label="Show the delivery address" checked={p.show_address} onChange={(show_address) => set({ show_address })} />
      <ToggleField label="Show delivery and tracking details" checked={p.show_delivery} onChange={(show_delivery) => set({ show_delivery })} />
      <Note>How to pay, cash on delivery and the “Pay now” button always show when the order needs them.</Note>
    </div>
  )
}

export function NotFoundMessageForm(props: B14FormProps<NotFoundMessageElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  const set = (values: Partial<NotFoundMessageElement['props']>, key?: string) => patch(node, onChange, values, key)
  const L = B14_TEXT_LIMITS.not_found_message
  return (
    <div className="flex flex-col gap-4">
      <TextField label="Heading" hint="Empty: “Page not found”." value={p.heading} max={L.heading} error={errors.heading} onChange={(heading) => set({ heading }, 'heading')} />
      <TextField label="Text" multiline hint="Optional, e.g. “The page may have moved. Try searching for it.”" value={p.text} max={L.text} error={errors.text} onChange={(text) => set({ text }, 'text')} />
      <ToggleField label="Show a search box" checked={p.show_search} onChange={(show_search) => set({ show_search })} />
      <ToggleField label="Show links to the shop and the home page" checked={p.show_links} onChange={(show_links) => set({ show_links })} />
      <Note>Search engines are still told the page doesn’t exist, as before.</Note>
      <Bangla
        {...props}
        fields={[
          { name: 'heading', label: 'Heading', base: p.heading },
          { name: 'text', label: 'Text', base: p.text, kind: 'textarea' },
        ]}
      />
    </div>
  )
}

/* ---------------------------------------------------------------------------------------------- */

/** The B14 form for a node, or null for other types. */
export function B14Form(props: B14FormProps<Element>) {
  const pass = <N,>() => props as unknown as B14FormProps<N>
  switch (props.node.type as string) {
    case 'dynamic_text':
      return <DynamicTextForm {...pass<DynamicTextElement>()} />
    case 'product_listing':
      return <ProductListingForm {...pass<ProductListingElement>()} />
    case 'blog_post_body':
      return <BlogPostBodyForm {...pass<BlogPostBodyElement>()} />
    case 'order_summary':
      return <OrderSummaryForm {...pass<OrderSummaryElement>()} />
    case 'not_found_message':
      return <NotFoundMessageForm {...pass<NotFoundMessageElement>()} />
    default:
      return null
  }
}
