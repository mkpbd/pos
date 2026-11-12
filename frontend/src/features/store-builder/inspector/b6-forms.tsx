/*
 * Content tab forms of the B6 elements (contract §1, §3): accordion, tabs, icon box and list,
 * quote, notice, counter, steps, chart, gallery, image and logo carousels, map, category card,
 * product spotlight, shop the look, trust badges, recently viewed and marquee. Lists of items use
 * ItemList (add / remove / duplicate / drag to reorder); each item has its own Bangla fields
 * (`<list>.<item_id>.<field>`), which move along when items are removed or duplicated.
 */

import { useMemo, useState } from 'react'
import { ExternalLinkIcon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { flattenCategoryTree, useCatalogList } from '@/features/catalog/api'
import { ICON_NAMES } from '@/storefront/builder/icons'
import type {
  AccordionElement,
  AccordionItem,
  CarouselImage,
  CategoryCardElement,
  ChartDataSource,
  ChartElementNode,
  CounterElement,
  CounterItem,
  Element,
  GalleryAspect,
  GalleryElement,
  GalleryImage,
  IconBoxElement,
  IconListElement,
  IconListItem,
  ImageCarouselElement,
  LogoCarouselElement,
  LogoItem,
  MapElement,
  MarqueeElement,
  MarqueeItem,
  NoticeElement,
  ProductSpotlightElement,
  QuoteElement,
  RecentlyViewedElement,
  ShopTheLookElement,
  StepItem,
  StepsElement,
  TabItem,
  TabsElement,
  TrustBadgeItem,
  TrustBadgesElement,
} from '@/storefront/builder/types'
import { B6_LIMITS, B6_TEXT_LIMITS } from '@/storefront/builder/validate'
import { BuilderIcon } from '@/storefront/builder/icons'
import { chartLabelTranslations, mapsUrl } from './b6-model'
import { ChartDataEditor, ChartKindPicker } from './chart-data-editor'
import { DataSourceField, StoreChartPreview } from './chart-source'
import { OptionalProductPicker } from './b8a-forms'
import { isStackedKind, type ChartData, type ChartDataChange } from './chart-data'
import { FieldError, ImageChooser, LinkField } from './fields'
import { Bangla, ImageListBangla, ImageListField, ItemBangla, Note, NumberField, RichField } from './form-kit'
import { itemErrors, limitIn, patch, setList, type ElementFormProps } from './form-model'
import { HotspotEditor } from './hotspot-editor'
import { ItemList } from './item-list'
import { ChoiceField, IconPicker, PixelField, SingleProductPicker, TextField, ToggleField } from './pickers'

export type B6FormProps<N> = ElementFormProps<N>

const TEXT = B6_TEXT_LIMITS as Record<string, Record<string, number>>
/** The text limit of a prop (`title`, `items.*.title`). */
const limit = (type: string, field: string) => limitIn(TEXT, type, field)

const ICON_STYLE_OPTIONS = [
  { value: 'plain', label: 'Plain' },
  { value: 'circle', label: 'In a circle' },
  { value: 'square', label: 'In a square' },
] as const

const SPEED_OPTIONS = [
  { value: 'slow', label: 'Slow' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
] as const

const ASPECT_OPTIONS: readonly { value: GalleryAspect; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: '4:3', label: 'Landscape (4:3)' },
  { value: '3:4', label: 'Portrait (3:4)' },
  { value: '16:9', label: 'Wide (16:9)' },
  { value: 'auto', label: 'Original shape' },
]

/* ----------------------------------------------------------------------------------------------
 * Content
 * -------------------------------------------------------------------------------------------- */

export function AccordionForm(props: B6FormProps<AccordionElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <ItemList<AccordionItem>
        label="Panels"
        noun="panel"
        items={p.items}
        min={B6_LIMITS.accordionItems.min}
        max={B6_LIMITS.accordionItems.max}
        errors={errors}
        create={(id) => ({ id, title: 'New question', html: '<p>The answer.</p>' })}
        summary={(item) => item.title}
        onChange={(items, change) => setList(node, onChange, 'items', items, change)}
      >
        {(item, i, update) => {
          const e = itemErrors(errors, 'items', i)
          return (
            <>
              <TextField label="Title" value={item.title} max={limit('accordion', 'items.*.title')} error={e.title} onChange={(title) => update({ title }, 'title')} />
              <RichField id={`acc-${node.id}-${item.id}`} label="Content" value={item.html} max={limit('accordion', 'items.*.html')} error={e.html} onChange={(html) => update({ html }, 'html')} />
              <ItemBangla {...props} list="items" itemId={item.id} fields={[{ name: 'title', label: 'Title', base: item.title }, { name: 'html', label: 'Content', base: item.html, kind: 'rich' }]} />
            </>
          )
        }}
      </ItemList>
      <ToggleField label="Open the first panel" checked={p.open_first} onChange={(open_first) => patch(node, onChange, { open_first })} />
      <ToggleField label="Several panels can be open" hint="Off: opening one closes the others." checked={p.allow_multiple} onChange={(allow_multiple) => patch(node, onChange, { allow_multiple })} />
      <ChoiceField label="Look" value={p.style} error={errors.style} options={[{ value: 'boxed', label: 'Boxed' }, { value: 'plain', label: 'Plain lines' }]} onChange={(style) => patch(node, onChange, { style })} />
    </div>
  )
}

export function TabsForm(props: B6FormProps<TabsElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <ItemList<TabItem>
        label="Tabs"
        noun="tab"
        items={p.items}
        min={B6_LIMITS.tabsItems.min}
        max={B6_LIMITS.tabsItems.max}
        errors={errors}
        create={(id) => ({ id, title: 'New tab', html: '<p>Write something here.</p>' })}
        summary={(item) => item.title}
        onChange={(items, change) => setList(node, onChange, 'items', items, change)}
      >
        {(item, i, update) => {
          const e = itemErrors(errors, 'items', i)
          return (
            <>
              <TextField label="Tab name" value={item.title} max={limit('tabs', 'items.*.title')} error={e.title} onChange={(title) => update({ title }, 'title')} />
              <RichField id={`tab-${node.id}-${item.id}`} label="Content" value={item.html} max={limit('tabs', 'items.*.html')} error={e.html} onChange={(html) => update({ html }, 'html')} />
              <ItemBangla {...props} list="items" itemId={item.id} fields={[{ name: 'title', label: 'Tab name', base: item.title }, { name: 'html', label: 'Content', base: item.html, kind: 'rich' }]} />
            </>
          )
        }}
      </ItemList>
      <ChoiceField
        label="Tabs placement"
        value={p.layout}
        error={errors.layout}
        hint="Side tabs turn into a row on phones."
        options={[{ value: 'horizontal', label: 'Across the top' }, { value: 'vertical', label: 'Down the side' }]}
        onChange={(layout) => patch(node, onChange, { layout })}
      />
    </div>
  )
}

export function IconBoxForm(props: B6FormProps<IconBoxElement>) {
  const { node, onChange, errors, icons = ICON_NAMES } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <IconPicker value={p.icon} icons={icons} error={errors.icon} onChange={(icon) => patch(node, onChange, { icon })} />
      <TextField label="Title" value={p.title} max={limit('icon_box', 'title')} error={errors.title} onChange={(title) => patch(node, onChange, { title }, 'title')} />
      <TextField label="Text" multiline value={p.text} max={limit('icon_box', 'text')} error={errors.text} onChange={(text) => patch(node, onChange, { text }, 'text')} />
      <LinkField key={node.id} label="Link" value={p.link?.url ?? null} error={errors.link} hint="Optional: the whole box becomes a link." onChange={(url) => patch(node, onChange, { link: url === null ? null : { url } }, 'link')} />
      <ChoiceField label="Icon placement" value={p.layout} error={errors.layout} options={[{ value: 'top', label: 'Above the text' }, { value: 'left', label: 'Beside the text' }]} onChange={(layout) => patch(node, onChange, { layout })} />
      <ChoiceField label="Icon look" value={p.icon_style} error={errors.icon_style} options={ICON_STYLE_OPTIONS} onChange={(icon_style) => patch(node, onChange, { icon_style })} />
      <Bangla {...props} fields={[{ name: 'title', label: 'Title', base: p.title }, { name: 'text', label: 'Text', base: p.text, kind: 'textarea' }]} />
    </div>
  )
}

function IconLead({ name }: { name: string | null }) {
  return name ? <BuilderIcon name={name} size={16} /> : null
}

export function IconListForm(props: B6FormProps<IconListElement>) {
  const { node, onChange, errors, icons = ICON_NAMES } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <ItemList<IconListItem>
        label="Lines"
        noun="line"
        items={p.items}
        min={B6_LIMITS.iconListItems.min}
        max={B6_LIMITS.iconListItems.max}
        errors={errors}
        create={(id) => ({ id, icon: p.items.at(-1)?.icon ?? 'check', text: 'New line', link: null })}
        summary={(item) => item.text}
        lead={(item) => <IconLead name={item.icon} />}
        onChange={(items, change) => setList(node, onChange, 'items', items, change)}
      >
        {(item, i, update) => {
          const e = itemErrors(errors, 'items', i)
          return (
            <>
              <TextField label="Text" value={item.text} max={limit('icon_list', 'items.*.text')} error={e.text} onChange={(text) => update({ text }, 'text')} />
              <IconPicker value={item.icon} icons={icons} error={e.icon} onChange={(icon) => update({ icon })} />
              <LinkField label="Link" value={item.link?.url ?? null} error={e.link} hint="Optional." onChange={(url) => update({ link: url === null ? null : { url } }, 'link')} />
              <ItemBangla {...props} list="items" itemId={item.id} fields={[{ name: 'text', label: 'Text', base: item.text }]} />
            </>
          )
        }}
      </ItemList>
      <ChoiceField label="Layout" value={p.layout} error={errors.layout} options={[{ value: 'vertical', label: 'One below the other' }, { value: 'inline', label: 'In a row' }]} onChange={(layout) => patch(node, onChange, { layout })} />
    </div>
  )
}

export function QuoteForm(props: B6FormProps<QuoteElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <TextField label="Quote" multiline value={p.text} max={limit('quote', 'text')} error={errors.text} onChange={(text) => patch(node, onChange, { text }, 'text')} />
      <TextField label="Who said it" hint="Optional." value={p.author} max={limit('quote', 'author')} error={errors.author} onChange={(author) => patch(node, onChange, { author }, 'author')} />
      <TextField label="Their role or place" hint="Optional, e.g. “Regular customer, Dhaka”." value={p.role} max={limit('quote', 'role')} error={errors.role} onChange={(role) => patch(node, onChange, { role }, 'role')} />
      <ChoiceField label="Look" value={p.style} error={errors.style} options={[{ value: 'card', label: 'Card' }, { value: 'plain', label: 'Plain' }, { value: 'large', label: 'Large text' }]} onChange={(style) => patch(node, onChange, { style })} />
      <Bangla
        {...props}
        fields={[
          { name: 'text', label: 'Quote', base: p.text, kind: 'textarea' },
          { name: 'author', label: 'Who said it', base: p.author },
          { name: 'role', label: 'Their role or place', base: p.role },
        ]}
      />
    </div>
  )
}

export function NoticeForm(props: B6FormProps<NoticeElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <ChoiceField
        label="Kind"
        value={p.tone}
        error={errors.tone}
        hint="Each kind has its own icon and label, so it doesn’t rely on colour alone."
        options={[
          { value: 'info', label: 'Information' },
          { value: 'success', label: 'Good news' },
          { value: 'warning', label: 'Warning' },
          { value: 'promo', label: 'Promotion' },
        ]}
        onChange={(tone) => patch(node, onChange, { tone })}
      />
      <TextField label="Title" hint="Optional." value={p.title} max={limit('notice', 'title')} error={errors.title} onChange={(title) => patch(node, onChange, { title }, 'title')} />
      <TextField label="Text" multiline value={p.text} max={limit('notice', 'text')} error={errors.text} onChange={(text) => patch(node, onChange, { text }, 'text')} />
      <ToggleField label="Show the icon" checked={p.show_icon} onChange={(show_icon) => patch(node, onChange, { show_icon })} />
      <Bangla {...props} fields={[{ name: 'title', label: 'Title', base: p.title }, { name: 'text', label: 'Text', base: p.text, kind: 'textarea' }]} />
    </div>
  )
}

export function CounterForm(props: B6FormProps<CounterElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <ItemList<CounterItem>
        label="Numbers"
        noun="number"
        items={p.items}
        min={B6_LIMITS.counterItems.min}
        max={B6_LIMITS.counterItems.max}
        errors={errors}
        create={(id) => ({ id, value: 10, prefix: '', suffix: '', label: 'New number' })}
        summary={(item) => `${item.prefix}${item.value.toLocaleString()}${item.suffix} ${item.label}`.trim()}
        onChange={(items, change) => setList(node, onChange, 'items', items, change)}
      >
        {(item, i, update) => {
          const e = itemErrors(errors, 'items', i)
          return (
            <>
              <NumberField label="Number" value={item.value} min={B6_LIMITS.counterValue.min} max={B6_LIMITS.counterValue.max} step={0.01} error={e.value} hint="Up to 2 decimals." onChange={(value) => update({ value }, 'value')} />
              <div className="grid grid-cols-2 gap-2">
                <TextField label="Before" placeholder="৳" value={item.prefix} max={limit('counter', 'items.*.prefix')} error={e.prefix} onChange={(prefix) => update({ prefix }, 'prefix')} />
                <TextField label="After" placeholder="+" value={item.suffix} max={limit('counter', 'items.*.suffix')} error={e.suffix} onChange={(suffix) => update({ suffix }, 'suffix')} />
              </div>
              <TextField label="Label" value={item.label} max={limit('counter', 'items.*.label')} error={e.label} onChange={(label) => update({ label }, 'label')} />
              <ItemBangla {...props} list="items" itemId={item.id} fields={[{ name: 'suffix', label: 'After', base: item.suffix }, { name: 'label', label: 'Label', base: item.label }]} />
            </>
          )
        }}
      </ItemList>
      <ToggleField
        label="Count up when shown"
        hint="Numbers count up once when shoppers scroll to them. Shoppers who turned off animations see the final numbers at once."
        checked={p.animate}
        onChange={(animate) => patch(node, onChange, { animate })}
      />
    </div>
  )
}

export function StepsForm(props: B6FormProps<StepsElement>) {
  const { node, onChange, errors, icons = ICON_NAMES } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <ItemList<StepItem>
        label="Steps"
        noun="step"
        items={p.items}
        min={B6_LIMITS.stepsItems.min}
        max={B6_LIMITS.stepsItems.max}
        errors={errors}
        create={(id) => ({ id, title: 'New step', text: '', icon: null })}
        summary={(item, i) => `${i + 1}. ${item.title}`}
        lead={(item) => <IconLead name={item.icon} />}
        onChange={(items, change) => setList(node, onChange, 'items', items, change)}
      >
        {(item, i, update) => {
          const e = itemErrors(errors, 'items', i)
          return (
            <>
              <TextField label="Title" value={item.title} max={limit('steps', 'items.*.title')} error={e.title} onChange={(title) => update({ title }, 'title')} />
              <TextField label="Text" multiline value={item.text} max={limit('steps', 'items.*.text')} error={e.text} onChange={(text) => update({ text }, 'text')} />
              <ToggleField label="Icon" checked={item.icon !== null} onChange={(on) => update({ icon: on ? 'check' : null })} />
              {item.icon !== null && <IconPicker value={item.icon} icons={icons} error={e.icon} onChange={(icon) => update({ icon })} />}
              <ItemBangla {...props} list="items" itemId={item.id} fields={[{ name: 'title', label: 'Title', base: item.title }, { name: 'text', label: 'Text', base: item.text, kind: 'textarea' }]} />
            </>
          )
        }}
      </ItemList>
      <ChoiceField label="Layout" value={p.layout} error={errors.layout} hint="Steps side by side stack on phones." options={[{ value: 'horizontal', label: 'Side by side' }, { value: 'vertical', label: 'One below the other' }]} onChange={(layout) => patch(node, onChange, { layout })} />
      <ToggleField label="Number the steps" checked={p.numbered} onChange={(numbered) => patch(node, onChange, { numbered })} />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Chart
 * -------------------------------------------------------------------------------------------- */

export function ChartForm(props: B6FormProps<ChartElementNode>) {
  const { node, onChange, errors } = props
  const p = node.props
  const data: ChartData = { labels: p.labels, series: p.series }
  const lines = p.kind === 'line' || p.kind === 'area'
  const setData = (next: ChartData, change?: ChartDataChange) =>
    onChange(
      { ...node, props: { ...node.props, labels: next.labels, series: next.series }, translations: chartLabelTranslations(node.translations, p.labels, next.labels, change, next.series) },
      change?.typing ? { coalesceKey: `${node.id}:data:${change.typing}` } : undefined,
    )
  // B8a: the numbers may come from the store (counted by the server; one series, so not stacked).
  const source = p.data_source ?? 'manual'
  const fromStore = source !== 'manual'
  const setSource = (data_source: ChartDataSource) =>
    patch(node, onChange, {
      data_source,
      source_product_id: data_source === 'store.rating_breakdown' ? (p.source_product_id ?? null) : null,
      ...(data_source !== 'manual' && isStackedKind(p.kind) ? { kind: p.kind === 'stacked-bar' ? ('bar' as const) : ('column' as const) } : {}),
    })
  return (
    <div className="flex flex-col gap-4">
      <DataSourceField value={source} error={errors.data_source} onChange={setSource} />
      {source === 'store.rating_breakdown' && (
        <OptionalProductPicker
          label="Reviews of"
          hint="No product chosen: the reviews of all your products."
          value={p.source_product_id ?? null}
          error={errors.source_product_id}
          onChange={(source_product_id) => patch(node, onChange, { source_product_id })}
        />
      )}
      <ChartKindPicker
        kind={p.kind}
        data={data}
        onChange={(kind) => patch(node, onChange, { kind })}
        disabled={fromStore ? ['stacked-column', 'stacked-bar'] : []}
        disabledReason={fromStore ? 'Numbers from your store make one series, so they can’t be stacked.' : undefined}
        hideHint={fromStore}
      />
      {errors.kind && <FieldError message={errors.kind} />}
      <TextField label="Title" hint="Says what the chart shows, e.g. “Orders per month”." value={p.title} max={limit('chart', 'title')} error={errors.title} onChange={(title) => patch(node, onChange, { title }, 'title')} />
      <TextField
        label="Description"
        multiline
        hint="Shown under the title: the main point, e.g. “Orders doubled since January”. Also read out by screen readers."
        value={p.description}
        max={limit('chart', 'description')}
        error={errors.description}
        onChange={(description) => patch(node, onChange, { description }, 'description')}
      />
      {fromStore ? <StoreChartPreview node={node} /> : <ChartDataEditor kind={p.kind} data={data} onChange={setData} errors={errors} />}
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Unit" placeholder="৳, %, pcs" value={p.unit} max={limit('chart', 'unit')} error={errors.unit} onChange={(unit) => patch(node, onChange, { unit }, 'unit')} />
        <ChoiceField label="Unit goes" value={p.unit_position} error={errors.unit_position} options={[{ value: 'before', label: 'Before (৳ 50)' }, { value: 'after', label: 'After (50 %)' }]} onChange={(unit_position) => patch(node, onChange, { unit_position })} />
      </div>
      <ToggleField
        label="Start the scale at zero"
        hint={p.kind === 'line' ? 'Off: the scale starts near the smallest number, which makes small changes look bigger.' : 'Only for line charts: bars, areas and slices always start at zero.'}
        checked={p.kind === 'line' ? p.y_starts_at_zero : true}
        disabled={p.kind !== 'line'}
        onChange={(y_starts_at_zero) => patch(node, onChange, { y_starts_at_zero })}
      />
      <ChoiceField
        label="Numbers on the chart"
        value={p.show_values}
        error={errors.show_values}
        hint="The data table and the tooltips always show every number."
        options={[
          { value: 'none', label: 'None' },
          { value: 'last', label: lines ? 'The last point of each line' : 'The largest value' },
          { value: 'all-small', label: 'All (small charts only)' },
        ]}
        onChange={(show_values) => patch(node, onChange, { show_values })}
      />
      {lines && (
        <ToggleField
          label="Hide legend when lines are labelled"
          hint="With up to 4 lines and enough room, each line has its name at its end, so the legend can go. Otherwise the legend stays."
          checked={!p.show_legend}
          onChange={(hide) => patch(node, onChange, { show_legend: !hide })}
        />
      )}
      <ToggleField
        label="Open the data table by default"
        hint="Shoppers can always open the numbers as a table (“Show data table”), and screen readers always get it."
        checked={p.show_table}
        onChange={(show_table) => patch(node, onChange, { show_table })}
      />
      <PixelField label="Height" value={p.height} min={B6_LIMITS.chartHeight.min} max={B6_LIMITS.chartHeight.max} error={errors.height} onChange={(height) => patch(node, onChange, { height }, 'height')} />
      <Bangla
        {...props}
        fields={[
          { name: 'title', label: 'Title', base: p.title },
          { name: 'description', label: 'Description', base: p.description, kind: 'textarea' },
          // Store numbers come with their own Bangla labels.
          ...(fromStore ? [] : p.labels.map((label, i) => ({ name: `labels.${i}`, label: `Label ${i + 1}`, base: label }))),
          ...(fromStore ? [] : p.series.map((s, i) => ({ name: `series.${s.id}.name`, label: `Series ${i + 1} name`, base: s.name }))),
        ]}
      />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Media
 * -------------------------------------------------------------------------------------------- */

const COLUMN_CHOICES = [2, 3, 4, 5, 6]
const INHERIT = 'inherit'

export function GalleryForm(props: B6FormProps<GalleryElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  const setColumns = (device: 'base' | 'tablet' | 'mobile', value: string) => {
    const columns = { ...p.columns }
    if (value === INHERIT) delete columns[device as 'tablet' | 'mobile']
    else columns[device] = Number(value)
    patch(node, onChange, { columns })
  }
  return (
    <div className="flex flex-col gap-4">
      <ImageListField<GalleryImage>
        label="Images"
        noun="image"
        list="images"
        items={p.images}
        range={B6_LIMITS.galleryImages}
        errors={errors}
        make={(id, media, media_id) => ({ id, media_id, alt: media?.alt ?? '', caption: '' })}
        onChange={(images, change, media) => setList(node, onChange, 'images', images, change, media)}
      >
        {(item, i, update) => {
          const e = itemErrors(errors, 'images', i)
          return (
            <>
              <TextField label="Description (alt text)" hint="Describes the photo for screen readers." value={item.alt} max={limit('gallery', 'images.*.alt')} error={e.alt} onChange={(alt) => update({ alt }, 'alt')} />
              <TextField label="Caption" hint="Optional; shown in the large view." value={item.caption} max={limit('gallery', 'images.*.caption')} error={e.caption} onChange={(caption) => update({ caption }, 'caption')} />
              <ImageListBangla {...props} list="images" item={item} />
            </>
          )
        }}
      </ImageListField>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">Images per row</legend>
        <div className="grid grid-cols-3 gap-2">
          {(['base', 'tablet', 'mobile'] as const).map((device) => {
            const label = device === 'base' ? 'Desktop' : device === 'tablet' ? 'Tablet' : 'Mobile'
            const value = p.columns[device]
            const choices = device === 'base' ? COLUMN_CHOICES : [1, ...COLUMN_CHOICES]
            return (
              <div key={device} className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{label}</span>
                <Select value={value === undefined ? INHERIT : String(value)} onValueChange={(v) => setColumns(device, v)}>
                  <SelectTrigger className="w-full" aria-label={`Images per row on ${label.toLowerCase()}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {device !== 'base' && <SelectItem value={INHERIT}>{device === 'tablet' ? 'As desktop' : 'As tablet'}</SelectItem>}
                    {choices.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )
          })}
        </div>
        <FieldError message={errors['columns.base'] ?? errors['columns.tablet'] ?? errors['columns.mobile']} />
      </fieldset>
      <ChoiceField label="Shape" value={p.aspect} error={errors.aspect} options={ASPECT_OPTIONS} onChange={(aspect) => patch(node, onChange, { aspect })} />
      <ChoiceField label="Space between" value={p.gap} error={errors.gap} options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }]} onChange={(gap) => patch(node, onChange, { gap })} />
      <ToggleField label="Open larger when clicked" hint="A large view with arrows; Esc closes it." checked={p.lightbox} onChange={(lightbox) => patch(node, onChange, { lightbox })} />
    </div>
  )
}

export function ImageCarouselForm(props: B6FormProps<ImageCarouselElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <ImageListField<CarouselImage>
        label="Slides"
        noun="image"
        list="images"
        items={p.images}
        range={B6_LIMITS.carouselImages}
        errors={errors}
        make={(id, media, media_id) => ({ id, media_id, alt: media?.alt ?? '', caption: '', link: null })}
        onChange={(images, change, media) => setList(node, onChange, 'images', images, change, media)}
      >
        {(item, i, update) => {
          const e = itemErrors(errors, 'images', i)
          return (
            <>
              <TextField label="Description (alt text)" value={item.alt} max={limit('image_carousel', 'images.*.alt')} error={e.alt} onChange={(alt) => update({ alt }, 'alt')} />
              <TextField label="Caption" hint="Optional; shown over the slide." value={item.caption} max={limit('image_carousel', 'images.*.caption')} error={e.caption} onChange={(caption) => update({ caption }, 'caption')} />
              <LinkField label="Link" value={item.link?.url ?? null} error={e.link} hint="Optional: the slide becomes a link." onChange={(url) => update({ link: url === null ? null : { url } }, 'link')} />
              <ImageListBangla {...props} list="images" item={item} />
            </>
          )
        }}
      </ImageListField>
      <PixelField
        label="Next slide every (seconds)"
        value={p.autoplay}
        min={B6_LIMITS.carouselAutoplay.min}
        max={B6_LIMITS.carouselAutoplay.max}
        error={errors.autoplay}
        hint="0 = shoppers slide themselves. It pauses on hover and focus and stays still for shoppers who turned off animations."
        onChange={(autoplay) => patch(node, onChange, { autoplay }, 'autoplay')}
      />
      <ToggleField label="Show dots" checked={p.show_dots} onChange={(show_dots) => patch(node, onChange, { show_dots })} />
      <ToggleField label="Show arrows" checked={p.show_arrows} onChange={(show_arrows) => patch(node, onChange, { show_arrows })} />
      <ChoiceField label="Shape" value={p.aspect} error={errors.aspect} options={ASPECT_OPTIONS} onChange={(aspect) => patch(node, onChange, { aspect })} />
    </div>
  )
}

export function LogoCarouselForm(props: B6FormProps<LogoCarouselElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <ImageListField<LogoItem>
        label="Logos"
        noun="logo"
        list="logos"
        items={p.logos}
        range={B6_LIMITS.logos}
        errors={errors}
        make={(id, media, media_id) => ({ id, media_id, alt: media?.alt ?? '', link: null })}
        onChange={(logos, change, media) => setList(node, onChange, 'logos', logos, change, media)}
      >
        {(item, i, update) => {
          const e = itemErrors(errors, 'logos', i)
          return (
            <>
              <TextField label="Name (alt text)" hint="The brand or partner name." value={item.alt} max={limit('logo_carousel', 'logos.*.alt')} error={e.alt} onChange={(alt) => update({ alt }, 'alt')} />
              <LinkField label="Link" value={item.link?.url ?? null} error={e.link} hint="Optional." onChange={(url) => update({ link: url === null ? null : { url } }, 'link')} />
              <ImageListBangla {...props} list="logos" item={item} captions={false} />
            </>
          )
        }}
      </ImageListField>
      <ToggleField label="Grey logos" hint="Logos are grey and turn colourful on hover." checked={p.grayscale} onChange={(grayscale) => patch(node, onChange, { grayscale })} />
      <ChoiceField label="Speed" value={p.speed} error={errors.speed} hint="Pauses on hover and focus; a still grid for shoppers who turned off animations." options={SPEED_OPTIONS} onChange={(speed) => patch(node, onChange, { speed })} />
    </div>
  )
}

export function MapForm(props: B6FormProps<MapElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <TextField
        label="Address"
        hint="A street address or coordinates such as 23.7808, 90.4152."
        placeholder="House 12, Road 5, Dhanmondi, Dhaka"
        value={p.query}
        max={limit('map', 'query')}
        error={errors.query}
        onChange={(query) => patch(node, onChange, { query }, 'query')}
      />
      {p.query.trim() !== '' && (
        <a href={mapsUrl(p.query)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 self-start text-sm underline underline-offset-2">
          Check it on Google Maps <ExternalLinkIcon className="size-3.5" aria-hidden />
        </a>
      )}
      <TextField label="Place name" hint="Shown on the card, e.g. “Our Dhanmondi shop”; also names the map for screen readers." value={p.title} max={limit('map', 'title')} error={errors.title} onChange={(title) => patch(node, onChange, { title }, 'title')} />
      <PixelField label="Height" value={p.height} min={B6_LIMITS.mapHeight.min} max={B6_LIMITS.mapHeight.max} error={errors.height} onChange={(height) => patch(node, onChange, { height }, 'height')} />
      <ChoiceField
        label="Zoom"
        value={String(p.zoom)}
        error={errors.zoom}
        options={Array.from({ length: B6_LIMITS.mapZoom.max - B6_LIMITS.mapZoom.min + 1 }, (_, i) => {
          const z = B6_LIMITS.mapZoom.min + i
          return { value: String(z), label: z <= 6 ? `${z} – country` : z <= 10 ? `${z} – region` : z <= 13 ? `${z} – city` : z <= 16 ? `${z} – streets` : `${z} – buildings` }
        })}
        onChange={(zoom) => patch(node, onChange, { zoom: Number(zoom) })}
      />
      <Note>Shoppers see a card with the address; Google Maps loads only when they click “Show map”, so it doesn’t slow the page down or share data before then.</Note>
      <Bangla {...props} fields={[{ name: 'query', label: 'Address', base: p.query }, { name: 'title', label: 'Place name', base: p.title }]} />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Shop
 * -------------------------------------------------------------------------------------------- */

function CategoryPicker({ value, onChange, error }: { value: string | null; onChange: (id: string) => void; error?: string }) {
  const list = useCatalogList('categories')
  const categories = useMemo(() => flattenCategoryTree(list.data ?? []).filter((c) => c.is_active), [list.data])
  return (
    <FormField label="Category" error={error}>
      <Select value={value ?? undefined} onValueChange={onChange} disabled={list.isPending || categories.length === 0}>
        <SelectTrigger className="w-full" aria-label="Category">
          <SelectValue placeholder={list.isPending ? 'Loading categories…' : categories.length === 0 ? 'No categories yet' : 'Choose a category'} />
        </SelectTrigger>
        <SelectContent>
          {categories.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {'  '.repeat(c.depth)}
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  )
}

export function CategoryCardForm(props: B6FormProps<CategoryCardElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <CategoryPicker value={p.category_id} error={errors.category_id} onChange={(category_id) => patch(node, onChange, { category_id })} />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Picture</span>
        <ImageChooser title="Choose a picture" value={p.media_id} error={errors.media_id} onChange={(media_id, ref) => patch(node, onChange, { media_id }, undefined, ref ? { [ref.id]: ref } : undefined)} />
        <Note>Optional: by default the category’s own picture is used.</Note>
      </div>
      <TextField label="Title" hint="Leave empty to use the category’s name." value={p.title ?? ''} max={limit('category_card', 'title')} error={errors.title} onChange={(title) => patch(node, onChange, { title: title === '' ? null : title }, 'title')} />
      <TextField label="Button text" value={p.button_label} max={limit('category_card', 'button_label')} error={errors.button_label} onChange={(button_label) => patch(node, onChange, { button_label }, 'button_label')} />
      <ChoiceField label="Text placement" value={p.layout} error={errors.layout} options={[{ value: 'overlay', label: 'On the picture' }, { value: 'below', label: 'Below the picture' }]} onChange={(layout) => patch(node, onChange, { layout })} />
      <Note>If the category is hidden from your online store, the card disappears by itself.</Note>
      <Bangla {...props} fields={[{ name: 'title', label: 'Title', base: p.title ?? '' }, { name: 'button_label', label: 'Button text', base: p.button_label }]} />
    </div>
  )
}

export function ProductSpotlightForm(props: B6FormProps<ProductSpotlightElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <SingleProductPicker value={p.product_id} error={errors.product_id} onChange={(product_id) => patch(node, onChange, { product_id })} />
      <ChoiceField label="Picture placement" value={p.layout} error={errors.layout} options={[{ value: 'image-left', label: 'Picture on the left' }, { value: 'image-right', label: 'Picture on the right' }]} onChange={(layout) => patch(node, onChange, { layout })} />
      <ToggleField label="Show the description" checked={p.show_description} onChange={(show_description) => patch(node, onChange, { show_description })} />
      <TextField label="Badge" hint="Optional, e.g. “New” or “Staff pick”." value={p.badge} max={limit('product_spotlight', 'badge')} error={errors.badge} onChange={(badge) => patch(node, onChange, { badge }, 'badge')} />
      <Note>Shoppers choose options and the quantity and add it to the cart right here. Price, pictures and stock come from the product.</Note>
      <Bangla {...props} fields={[{ name: 'badge', label: 'Badge', base: p.badge }]} />
    </div>
  )
}

export function ShopTheLookForm(props: B6FormProps<ShopTheLookElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const hotspotErrors = Object.fromEntries(Object.entries(errors).filter(([k]) => k === 'hotspots' || k.startsWith('hotspots.')))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Photo</span>
        <ImageChooser
          title="Choose the photo"
          value={p.media_id}
          error={errors.media_id}
          onChange={(media_id, ref) => {
            setImageUrl(ref?.url ?? null)
            patch(node, onChange, { media_id }, undefined, ref ? { [ref.id]: ref } : undefined)
          }}
        />
      </div>
      <TextField label="Description (alt text)" hint="Describes the photo for screen readers." value={p.alt} max={limit('shop_the_look', 'alt')} error={errors.alt} onChange={(alt) => patch(node, onChange, { alt }, 'alt')} />
      <TextField label="Title" hint="Optional, e.g. “Get the look”." value={p.title} max={limit('shop_the_look', 'title')} error={errors.title} onChange={(title) => patch(node, onChange, { title }, 'title')} />
      <HotspotEditor
        mediaId={p.media_id}
        imageUrl={imageUrl}
        hotspots={p.hotspots}
        errors={hotspotErrors}
        onChange={(hotspots, change) => setList(node, onChange, 'hotspots', hotspots, change)}
      />
      <Note>Products that stop being sold online lose their hotspot by themselves.</Note>
      <Bangla {...props} fields={[{ name: 'alt', label: 'Description (alt text)', base: p.alt }, { name: 'title', label: 'Title', base: p.title }]} />
    </div>
  )
}

export function TrustBadgesForm(props: B6FormProps<TrustBadgesElement>) {
  const { node, onChange, errors, icons = ICON_NAMES } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <ItemList<TrustBadgeItem>
        label="Badges"
        noun="badge"
        items={p.items}
        min={B6_LIMITS.trustBadges.min}
        max={B6_LIMITS.trustBadges.max}
        errors={errors}
        create={(id) => ({ id, icon: 'badge-check', title: 'New badge', text: '' })}
        summary={(item) => item.title}
        lead={(item) => <IconLead name={item.icon} />}
        onChange={(items, change) => setList(node, onChange, 'items', items, change)}
      >
        {(item, i, update) => {
          const e = itemErrors(errors, 'items', i)
          return (
            <>
              <TextField label="Title" value={item.title} max={limit('trust_badges', 'items.*.title')} error={e.title} onChange={(title) => update({ title }, 'title')} />
              <TextField label="Text" hint="Optional." value={item.text} max={limit('trust_badges', 'items.*.text')} error={e.text} onChange={(text) => update({ text }, 'text')} />
              <IconPicker value={item.icon} icons={icons} error={e.icon} onChange={(icon) => update({ icon })} />
              <ItemBangla {...props} list="items" itemId={item.id} fields={[{ name: 'title', label: 'Title', base: item.title }, { name: 'text', label: 'Text', base: item.text }]} />
            </>
          )
        }}
      </ItemList>
      <ChoiceField label="Layout" value={p.style} error={errors.style} options={[{ value: 'row', label: 'In one row' }, { value: 'grid', label: 'Grid' }]} onChange={(style) => patch(node, onChange, { style })} />
    </div>
  )
}

export function RecentlyViewedForm(props: B6FormProps<RecentlyViewedElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <TextField label="Title" value={p.title} max={limit('recently_viewed', 'title')} error={errors.title} onChange={(title) => patch(node, onChange, { title }, 'title')} />
      <PixelField label="At most this many products" value={p.limit} min={B6_LIMITS.recentlyViewed.min} max={B6_LIMITS.recentlyViewed.max} hint={`${B6_LIMITS.recentlyViewed.min}–${B6_LIMITS.recentlyViewed.max}. Shows up to 9 recently viewed products (the shopper’s browser remembers 9).`} error={errors.limit} onChange={(limit) => patch(node, onChange, { limit }, 'limit')} />
      <Note>Each shopper sees the products they looked at in this browser. It stays hidden for new visitors; here you see sample products.</Note>
      <Bangla {...props} fields={[{ name: 'title', label: 'Title', base: p.title }]} />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Motion
 * -------------------------------------------------------------------------------------------- */

export function MarqueeForm(props: B6FormProps<MarqueeElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  return (
    <div className="flex flex-col gap-4">
      <ItemList<MarqueeItem>
        label="Texts"
        noun="text"
        items={p.items}
        min={B6_LIMITS.marqueeItems.min}
        max={B6_LIMITS.marqueeItems.max}
        errors={errors}
        create={(id) => ({ id, text: 'New text' })}
        summary={(item) => item.text}
        onChange={(items, change) => setList(node, onChange, 'items', items, change)}
      >
        {(item, i, update) => (
          <>
            <TextField label="Text" value={item.text} max={limit('marquee', 'items.*.text')} error={itemErrors(errors, 'items', i).text} onChange={(text) => update({ text }, 'text')} />
            <ItemBangla {...props} list="items" itemId={item.id} fields={[{ name: 'text', label: 'Text', base: item.text }]} />
          </>
        )}
      </ItemList>
      <ChoiceField label="Speed" value={p.speed} error={errors.speed} options={SPEED_OPTIONS} onChange={(speed) => patch(node, onChange, { speed })} />
      <ChoiceField label="Direction" value={p.direction} error={errors.direction} options={[{ value: 'left', label: 'To the left' }, { value: 'right', label: 'To the right' }]} onChange={(direction) => patch(node, onChange, { direction })} />
      <ChoiceField
        label="Between the texts"
        value={p.separator}
        error={errors.separator}
        options={[{ value: 'dot', label: 'Dot •' }, { value: 'star', label: 'Star ★' }, { value: 'leaf', label: 'Leaf' }, { value: 'none', label: 'Nothing' }]}
        onChange={(separator) => patch(node, onChange, { separator })}
      />
      <Note>It pauses when shoppers point at it or tab to it, has a pause button, and stands still for shoppers who turned off animations.</Note>
    </div>
  )
}

/** The B6 form for a node, or null for other types. */
export function B6Form(props: B6FormProps<Element>) {
  const pass = <N,>() => props as unknown as B6FormProps<N>
  switch (props.node.type) {
    case 'accordion':
      return <AccordionForm {...pass<AccordionElement>()} />
    case 'tabs':
      return <TabsForm {...pass<TabsElement>()} />
    case 'icon_box':
      return <IconBoxForm {...pass<IconBoxElement>()} />
    case 'icon_list':
      return <IconListForm {...pass<IconListElement>()} />
    case 'quote':
      return <QuoteForm {...pass<QuoteElement>()} />
    case 'notice':
      return <NoticeForm {...pass<NoticeElement>()} />
    case 'counter':
      return <CounterForm {...pass<CounterElement>()} />
    case 'steps':
      return <StepsForm {...pass<StepsElement>()} />
    case 'chart':
      return <ChartForm {...pass<ChartElementNode>()} />
    case 'gallery':
      return <GalleryForm {...pass<GalleryElement>()} />
    case 'image_carousel':
      return <ImageCarouselForm {...pass<ImageCarouselElement>()} />
    case 'logo_carousel':
      return <LogoCarouselForm {...pass<LogoCarouselElement>()} />
    case 'map':
      return <MapForm {...pass<MapElement>()} />
    case 'category_card':
      return <CategoryCardForm {...pass<CategoryCardElement>()} />
    case 'product_spotlight':
      return <ProductSpotlightForm {...pass<ProductSpotlightElement>()} />
    case 'shop_the_look':
      return <ShopTheLookForm {...pass<ShopTheLookElement>()} />
    case 'trust_badges':
      return <TrustBadgesForm {...pass<TrustBadgesElement>()} />
    case 'recently_viewed':
      return <RecentlyViewedForm {...pass<RecentlyViewedElement>()} />
    case 'marquee':
      return <MarqueeForm {...pass<MarqueeElement>()} />
    default:
      return null
  }
}

