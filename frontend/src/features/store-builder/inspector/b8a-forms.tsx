/*
 * Content tab forms of the B8a selling blocks (contract §1): pricing table (plans with their
 * features), before / after, comparison table (columns + the rows grid), flash sale bar and bundle.
 * Lists use ItemList (add / remove / duplicate / reorder); every item has its own Bangla fields
 * (`<list>.<item_id>.<field>`, nested `plans.<plan_id>.features.<feature_id>.text`).
 * The trust & people forms live in ./b8a-people-forms.tsx.
 */

import { useId, useState } from 'react'
import { CheckIcon, ImageIcon, XIcon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ProductSearchAdder } from '@/features/online-catalog/components/ordered-picker'
import { useProductNames } from '@/features/products/api'
import type {
  BeforeAfterElement,
  BeforeAfterImage,
  BundleElement,
  BundleItem,
  ComparisonColumn,
  ComparisonTableElement,
  Element,
  FlashSaleBarElement,
  PricingFeature,
  PricingPlan,
  PricingTableElement,
} from '@/storefront/builder/types'
import { B8A_LIMITS, B8A_TEXT_LIMITS } from '@/storefront/builder/validate'
import { moveItemTranslations, type ItemListChange } from './b6-model'
import { cellTranslationsForColumns, parseMoney, rowsForColumns } from './b8a-model'
import { B8aPeopleForm } from './b8a-people-forms'
import { ComparisonGrid } from './comparison-grid'
import { DataStateHint } from './data-hint'
import { FieldError, ImageChooser, LinkField } from './fields'
import { Bangla, ItemBangla, Note, NumberField } from './form-kit'
import { itemErrors, limitIn, patch, setList, type ElementFormProps } from './form-model'
import { ItemList } from './item-list'
import { ChoiceField, PromotionPicker, SingleProductPicker, TextField, ToggleField } from './pickers'

export type B8aFormProps<N> = ElementFormProps<N>

const TEXT = B8A_TEXT_LIMITS as Record<string, Record<string, number>>
const limit = (type: string, field: string) => limitIn(TEXT, type, field)

/* ----------------------------------------------------------------------------------------------
 * Small fields
 * -------------------------------------------------------------------------------------------- */

/**
 * A price typed the way shop owners write it (1250, ১,২৫০, ৳ 99.50). Stored as a NUMERIC string
 * when it is one; otherwise the field keeps the text and says what is wrong.
 */
export function MoneyField({ label, value, onChange, error, hint }: { label: string; value: string | null; onChange: (value: string) => void; error?: string; hint?: string }) {
  const [text, setText] = useState(value ?? '')
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    if (value !== null && parseMoney(text) !== value) setText(value)
  }
  const local = text.trim() === '' ? 'Enter a price, e.g. 1250.' : parseMoney(text) === null ? 'Use a price such as 1250 or 99.50 (no minus, at most 2 decimals).' : undefined
  return (
    <FormField label={label} error={local ?? error} hint={hint}>
      <Input
        inputMode="decimal"
        value={text}
        placeholder="1250"
        onChange={(e) => {
          setText(e.target.value)
          const money = parseMoney(e.target.value)
          if (money !== null) onChange(money)
        }}
      />
    </FormField>
  )
}

/** An optional button (`null | {label, url}`): a switch, then its text and where it leads. */
function ButtonFields({ value, onChange, errors, labelMax, hint, defaultLabel }: {
  value: { label: string; url: string } | null
  onChange: (value: { label: string; url: string } | null, typing?: string) => void
  errors: Record<string, string | undefined>
  labelMax: number
  hint?: string
  defaultLabel: string
}) {
  return (
    <div className="flex flex-col gap-3">
      <ToggleField label="Show a button" hint={hint} checked={value !== null} onChange={(on) => onChange(on ? { label: defaultLabel, url: '/shop' } : null)} />
      {value !== null && (
        <>
          <TextField label="Button text" value={value.label} max={labelMax} error={errors.label} onChange={(label) => onChange({ ...value, label }, 'label')} />
          <LinkField label="Button leads to" required value={value.url} error={errors.url} onChange={(url) => onChange({ ...value, url: url ?? '' }, 'url')} />
        </>
      )}
    </div>
  )
}

/** An optional product (null = none): the chosen product with "Remove", or a search to choose one. */
export function OptionalProductPicker({ value, onChange, label, hint, error }: { value: string | null; onChange: (id: string | null) => void; label: string; hint?: string; error?: string }) {
  const names = useProductNames(value ? [value] : [])
  const found = value ? names.get(value) : undefined
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      {value && (
        <div className="flex items-center gap-3 rounded-md border p-2" data-testid="chosen-product">
          <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
            {found?.image_url ? <img src={found.image_url} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4 text-muted-foreground" aria-hidden />}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">{found?.name ?? 'Loading…'}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            <XIcon data-icon="inline-start" /> Remove
          </Button>
        </div>
      )}
      <ProductSearchAdder label={value ? 'Change product' : 'Choose product'} exclude={value ? [value] : []} onPick={(item) => onChange(item.id)} />
      <FieldError message={error} />
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Pricing table
 * -------------------------------------------------------------------------------------------- */

const PRICE_MODES = [
  { value: 'amount', label: 'A price' },
  { value: 'text', label: 'A word instead (Free, Ask us)' },
] as const

function FeatureLead({ included }: { included: boolean }) {
  return included ? (
    <CheckIcon role="img" className="size-4 shrink-0 text-emerald-600" aria-label="Included" />
  ) : (
    <XIcon role="img" className="size-4 shrink-0 text-muted-foreground" aria-label="Not included" />
  )
}

export function PricingTableForm(props: B8aFormProps<PricingTableElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  const L = (field: string) => limit('pricing_table', `plans.*.${field}`)

  /** A plan's features changed: write them and move their Bangla texts (`plans.<id>.features.<fid>.text`). */
  const setFeatures = (planId: string, features: PricingFeature[], change?: ItemListChange) => {
    const plans = p.plans.map((plan) => (plan.id === planId ? { ...plan, features } : plan))
    onChange(
      { ...node, props: { ...p, plans }, translations: moveItemTranslations(node.translations, `plans.${planId}.features`, change) },
      change?.typing ? { coalesceKey: `${node.id}:plans:${planId}:features:${change.typing}` } : undefined,
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ItemList<PricingPlan>
        label="Plans"
        noun="plan"
        items={p.plans}
        min={B8A_LIMITS.plans.min}
        max={B8A_LIMITS.plans.max}
        errors={errors}
        errorPrefix="plans"
        create={(id) => ({ id, name: 'New plan', price: '0', price_text: '', period: '/month', description: '', features: [{ id: 'i_first1', text: 'What’s included', included: true }], button: null, highlighted: false, badge: '' })}
        summary={(plan) => [plan.name, plan.price !== null ? plan.price : plan.price_text].filter(Boolean).join(' · ') + (plan.highlighted ? ' ★' : '')}
        onChange={(plans, change) => setList(node, onChange, 'plans', plans, change)}
      >
        {(plan, i, update) => {
          const e = itemErrors(errors, 'plans', i)
          const mode = plan.price === null ? 'text' : 'amount'
          return (
            <>
              <TextField label="Plan name" value={plan.name} max={L('name')} error={e.name} onChange={(name) => update({ name }, 'name')} />
              <ChoiceField
                label="Show"
                value={mode}
                options={PRICE_MODES}
                onChange={(next) => update(next === 'text' ? { price: null, price_text: plan.price_text || 'Free' } : { price: '0' })}
              />
              {plan.price !== null ? (
                <MoneyField label="Price" hint="In your store’s currency; shoppers see it formatted, e.g. ৳1,250." value={plan.price} error={e.price} onChange={(price) => update({ price }, 'price')} />
              ) : (
                <TextField label="Instead of a price" placeholder="Free" value={plan.price_text} max={L('price_text')} error={e.price_text} onChange={(price_text) => update({ price_text }, 'price_text')} />
              )}
              <TextField label="Period" hint="Optional, e.g. “/month” or “one time”." value={plan.period} max={L('period')} error={e.period} onChange={(period) => update({ period }, 'period')} />
              <TextField label="Description" multiline hint="Optional: who the plan is for." value={plan.description} max={L('description')} error={e.description} onChange={(description) => update({ description }, 'description')} />
              <ItemList<PricingFeature>
                label="Features"
                noun="feature"
                items={plan.features}
                min={B8A_LIMITS.planFeatures.min}
                max={B8A_LIMITS.planFeatures.max}
                errors={e}
                errorPrefix="features"
                create={(id) => ({ id, text: 'New feature', included: true })}
                summary={(feature) => feature.text}
                lead={(feature) => <FeatureLead included={feature.included} />}
                onChange={(features, change) => setFeatures(plan.id, features, change)}
              >
                {(feature, f, updateFeature) => {
                  const fe = itemErrors(e, 'features', f)
                  return (
                    <>
                      <TextField label="Feature" value={feature.text} max={L('features.*.text')} error={fe.text} onChange={(text) => updateFeature({ text }, 'text')} />
                      <ToggleField
                        label={feature.included ? 'Included' : 'Not included'}
                        hint="Shoppers see a tick or a cross with the words “Included” / “Not included”."
                        checked={feature.included}
                        onChange={(included) => updateFeature({ included })}
                      />
                      <ItemBangla {...props} list={`plans.${plan.id}.features`} itemId={feature.id} fields={[{ name: 'text', label: 'Feature', base: feature.text }]} />
                    </>
                  )
                }}
              </ItemList>
              <ButtonFields
                value={plan.button}
                defaultLabel="Choose"
                labelMax={L('button.label')}
                errors={{ label: e['button.label'], url: e['button.url'] ?? e.button }}
                onChange={(button, typing) => update({ button }, typing ? `button.${typing}` : undefined)}
              />
              <ToggleField label="Highlight this plan" hint="Stands out on computers and comes first on phones." checked={plan.highlighted} onChange={(highlighted) => update({ highlighted })} />
              <TextField label="Badge" hint="Optional, e.g. “Most popular”." value={plan.badge} max={L('badge')} error={e.badge} onChange={(badge) => update({ badge }, 'badge')} />
              <ItemBangla
                {...props}
                list="plans"
                itemId={plan.id}
                fields={[
                  { name: 'name', label: 'Plan name', base: plan.name },
                  ...(plan.price === null ? [{ name: 'price_text', label: 'Instead of a price', base: plan.price_text }] : []),
                  { name: 'period', label: 'Period', base: plan.period },
                  { name: 'description', label: 'Description', base: plan.description, kind: 'textarea' as const },
                  ...(plan.button ? [{ name: 'button.label', label: 'Button text', base: plan.button.label }] : []),
                  { name: 'badge', label: 'Badge', base: plan.badge },
                ]}
              />
            </>
          )
        }}
      </ItemList>
      <Note>Prices are shown in your store’s currency. On phones the plans stack, with the highlighted one first.</Note>
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Before / after
 * -------------------------------------------------------------------------------------------- */

function SideFields({ side, value, label, onChange, errors, alt }: {
  side: 'before' | 'after'
  value: BeforeAfterImage
  label: string
  alt: number
  onChange: (value: BeforeAfterImage, typing?: string, media?: Parameters<Parameters<typeof ImageChooser>[0]['onChange']>[1]) => void
  errors: Record<string, string>
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border p-3" data-testid={`side-${side}`}>
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <ImageChooser title={`Choose the “${label.toLowerCase()}” photo`} value={value.media_id} error={errors[`${side}.media_id`] ?? errors[side]} onChange={(media_id, ref) => onChange({ ...value, media_id }, undefined, ref)} />
      <TextField label="Description (alt text)" hint="What the photo shows, for screen readers." value={value.alt} max={alt} error={errors[`${side}.alt`]} onChange={(text) => onChange({ ...value, alt: text }, 'alt')} />
    </fieldset>
  )
}

export function BeforeAfterForm(props: B8aFormProps<BeforeAfterElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  const id = useId()
  const L = (field: string) => limit('before_after', field)
  const side = (key: 'before' | 'after') => (value: BeforeAfterImage, typing?: string, ref?: { id: string } & Record<string, unknown>) =>
    patch(node, onChange, { [key]: value } as Partial<BeforeAfterElement['props']>, typing ? `${key}.${typing}` : undefined, ref ? { [ref.id]: ref as never } : undefined)
  return (
    <div className="flex flex-col gap-4">
      <SideFields side="before" label="Before" value={p.before} alt={L('before.alt')} errors={errors} onChange={side('before')} />
      <SideFields side="after" label="After" value={p.after} alt={L('after.alt')} errors={errors} onChange={side('after')} />
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Before label" value={p.before_label} max={L('before_label')} error={errors.before_label} onChange={(before_label) => patch(node, onChange, { before_label }, 'before_label')} />
        <TextField label="After label" value={p.after_label} max={L('after_label')} error={errors.after_label} onChange={(after_label) => patch(node, onChange, { after_label }, 'after_label')} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-start`}>Where the handle starts</Label>
        <div className="flex items-center gap-3">
          <input
            id={`${id}-start`}
            type="range"
            min={B8A_LIMITS.beforeAfterStart.min}
            max={B8A_LIMITS.beforeAfterStart.max}
            step={1}
            value={p.start}
            aria-valuetext={`${p.start} %`}
            className="flex-1 accent-primary"
            onChange={(e) => patch(node, onChange, { start: Number(e.target.value) }, 'start')}
          />
          <output htmlFor={`${id}-start`} className="w-12 text-right text-sm tabular-nums">{p.start} %</output>
        </div>
        <p className="text-sm text-muted-foreground">50 % = the middle. Shoppers drag the handle or use the arrow keys.</p>
        <FieldError message={errors.start} />
      </div>
      <ChoiceField
        label="Slide direction"
        value={p.orientation}
        error={errors.orientation}
        options={[{ value: 'horizontal', label: 'Left and right' }, { value: 'vertical', label: 'Up and down' }]}
        onChange={(orientation) => patch(node, onChange, { orientation })}
      />
      <ChoiceField
        label="Shape"
        value={p.aspect}
        error={errors.aspect}
        options={[{ value: '1:1', label: 'Square (1:1)' }, { value: '4:3', label: 'Landscape (4:3)' }, { value: '3:2', label: 'Photo (3:2)' }, { value: '16:9', label: 'Wide (16:9)' }]}
        onChange={(aspect) => patch(node, onChange, { aspect })}
      />
      <Note>Use two photos of the same size taken from the same spot, so the slider lines them up.</Note>
      <Bangla
        {...props}
        fields={[
          { name: 'before.alt', label: 'Before: description', base: p.before.alt },
          { name: 'after.alt', label: 'After: description', base: p.after.alt },
          { name: 'before_label', label: 'Before label', base: p.before_label },
          { name: 'after_label', label: 'After label', base: p.after_label },
        ]}
      />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Comparison table
 * -------------------------------------------------------------------------------------------- */

export function ComparisonTableForm(props: B8aFormProps<ComparisonTableElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  const L = (field: string) => limit('comparison_table', field)
  const rowErrors = Object.fromEntries(Object.entries(errors).filter(([k]) => k === 'rows' || k.startsWith('rows.')))

  const setColumns = (columns: ComparisonColumn[], change?: ItemListChange) => {
    const rows = rowsForColumns(p.rows, columns.map((c) => c.id), change)
    const translations = cellTranslationsForColumns(moveItemTranslations(node.translations, 'columns', change), change)
    onChange({ ...node, props: { ...p, columns, rows }, translations }, change?.typing ? { coalesceKey: `${node.id}:columns:${change.typing}` } : undefined)
  }

  return (
    <div className="flex flex-col gap-4">
      <ItemList<ComparisonColumn>
        label="Columns"
        noun="column"
        items={p.columns}
        min={B8A_LIMITS.comparisonColumns.min}
        max={B8A_LIMITS.comparisonColumns.max}
        errors={errors}
        errorPrefix="columns"
        create={(id) => ({ id, title: 'New column', product_id: null, highlighted: false })}
        summary={(column) => column.title + (column.highlighted ? ' ★' : '')}
        onChange={setColumns}
      >
        {(column, i, update) => {
          const e = itemErrors(errors, 'columns', i)
          return (
            <>
              <TextField label="Column title" hint="A product, plan or shop name." value={column.title} max={L('columns.*.title')} error={e.title} onChange={(title) => update({ title }, 'title')} />
              <OptionalProductPicker
                label="Product (optional)"
                hint="Adds the product’s price and an Add to cart button under the column. If it stops being sold online, the column keeps its title only."
                value={column.product_id}
                error={e.product_id}
                onChange={(product_id) => update({ product_id })}
              />
              <ToggleField label="Highlight this column" checked={column.highlighted} onChange={(highlighted) => update({ highlighted })} />
              <ItemBangla {...props} list="columns" itemId={column.id} fields={[{ name: 'title', label: 'Column title', base: column.title }]} />
            </>
          )
        }}
      </ItemList>
      {!props.setup && <DataStateHint node={node} />}
      <ComparisonGrid
        columns={p.columns}
        rows={p.rows}
        errors={rowErrors}
        limits={B8A_LIMITS.comparisonRows}
        textLimits={{ label: L('rows.*.label'), cell: L('rows.*.cells.*.text') }}
        onChange={(rows, change) => setList(node, onChange, 'rows', rows, change)}
      />
      <ToggleField label="Show prices" hint="Under columns linked to a product." checked={p.show_prices} onChange={(show_prices) => patch(node, onChange, { show_prices })} />
      <ToggleField label="Show Add to cart buttons" hint="Under columns linked to a product." checked={p.show_buttons} onChange={(show_buttons) => patch(node, onChange, { show_buttons })} />
      <Bangla
        {...props}
        fields={p.rows.flatMap((row, r) => [
          { name: `rows.${row.id}.label`, label: `Row ${r + 1}: feature`, base: row.label },
          ...p.columns
            .filter((column) => row.cells[column.id]?.kind === 'text')
            .map((column) => ({ name: `rows.${row.id}.cells.${column.id}.text`, label: `Row ${r + 1}, ${column.title || 'column'}`, base: row.cells[column.id]!.text })),
        ])}
      />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Flash sale bar
 * -------------------------------------------------------------------------------------------- */

export function FlashSaleBarForm(props: B8aFormProps<FlashSaleBarElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  const L = (field: string) => limit('flash_sale_bar', field)
  const [choose, setChoose] = useState(p.promotion_id !== null)
  return (
    <div className="flex flex-col gap-4">
      <ChoiceField
        label="Which sale"
        value={choose ? 'chosen' : 'auto'}
        hint={choose ? undefined : 'The running flash sale (with a countdown) that ends first. When none is running, the bar hides itself.'}
        options={[{ value: 'auto', label: 'The sale that ends soonest' }, { value: 'chosen', label: 'A sale I choose' }]}
        onChange={(mode) => {
          setChoose(mode === 'chosen')
          if (mode === 'auto') patch(node, onChange, { promotion_id: null })
        }}
      />
      {choose && <PromotionPicker kind="countdown" label="Sale" value={p.promotion_id} error={errors.promotion_id} onChange={(promotion_id) => patch(node, onChange, { promotion_id })} />}
      {!props.setup && <DataStateHint node={node} />}
      <TextField label="Title" value={p.title} max={L('title')} error={errors.title} onChange={(title) => patch(node, onChange, { title }, 'title')} />
      <TextField label="Text" multiline hint="Optional, e.g. “Up to 40 % off fresh fruit”." value={p.text} max={L('text')} error={errors.text} onChange={(text) => patch(node, onChange, { text }, 'text')} />
      <ToggleField label="Show the sale’s products" checked={p.show_products} onChange={(show_products) => patch(node, onChange, { show_products })} />
      {p.show_products && (
        <NumberField
          label="At most this many products"
          value={p.product_limit}
          min={B8A_LIMITS.flashSaleProducts.min}
          max={B8A_LIMITS.flashSaleProducts.max}
          hint={`${B8A_LIMITS.flashSaleProducts.min}–${B8A_LIMITS.flashSaleProducts.max}.`}
          error={errors.product_limit}
          onChange={(product_limit) => patch(node, onChange, { product_limit }, 'product_limit')}
        />
      )}
      <ChoiceField label="Look" value={p.style} error={errors.style} options={[{ value: 'bar', label: 'A slim bar' }, { value: 'card', label: 'A card' }]} onChange={(style) => patch(node, onChange, { style })} />
      <ButtonFields
        value={p.button}
        defaultLabel="Shop the sale"
        labelMax={L('button.label')}
        errors={{ label: errors['button.label'], url: errors['button.url'] ?? errors.button }}
        onChange={(button, typing) => patch(node, onChange, { button }, typing ? `button.${typing}` : undefined)}
      />
      <Note>The countdown and the sale’s products come from Promotions. A “claimed” bar shows only when the promotion has a usage limit; nothing is made up.</Note>
      <Bangla
        {...props}
        fields={[
          { name: 'title', label: 'Title', base: p.title },
          { name: 'text', label: 'Text', base: p.text, kind: 'textarea' },
          ...(p.button ? [{ name: 'button.label', label: 'Button text', base: p.button.label }] : []),
        ]}
      />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Bundle
 * -------------------------------------------------------------------------------------------- */

export function BundleForm(props: B8aFormProps<BundleElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  const L = (field: string) => limit('bundle', field)
  const names = useProductNames(p.items.map((i) => i.product_id).filter(Boolean))
  return (
    <div className="flex flex-col gap-4">
      <ItemList<BundleItem>
        label="Products"
        noun="product"
        items={p.items}
        min={B8A_LIMITS.bundleItems.min}
        max={B8A_LIMITS.bundleItems.max}
        errors={errors}
        create={(id) => ({ id, product_id: '' })}
        summary={(item, i) => (item.product_id ? (names.get(item.product_id)?.name ?? 'Loading…') : `Product ${i + 1}: not chosen yet`)}
        lead={(item) => {
          const image = item.product_id ? names.get(item.product_id)?.image_url : null
          return (
            <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
              {image ? <img src={image} alt="" className="size-full object-cover" /> : null}
            </span>
          )
        }}
        onChange={(items, change) => setList(node, onChange, 'items', items, change)}
      >
        {(item, i, update) => (
          <SingleProductPicker value={item.product_id || null} error={itemErrors(errors, 'items', i).product_id} onChange={(product_id) => update({ product_id })} />
        )}
      </ItemList>
      {!props.setup && <DataStateHint node={node} />}
      <TextField label="Title" value={p.title} max={L('title')} error={errors.title} onChange={(title) => patch(node, onChange, { title }, 'title')} />
      <TextField label="Text" multiline hint="Optional, e.g. “Everything you need for a cosy evening”." value={p.text} max={L('text')} error={errors.text} onChange={(text) => patch(node, onChange, { text }, 'text')} />
      <TextField label="Button text" value={p.button_label} max={L('button_label')} error={errors.button_label} onChange={(button_label) => patch(node, onChange, { button_label }, 'button_label')} />
      <Note>
        Shoppers pick options, untick what they don’t want and add the rest to the cart in one click. The “Total today” adds up the current prices; there is no extra bundle discount. Products that stop being sold online drop out; with fewer than 2 left the block hides itself.
      </Note>
      <Bangla
        {...props}
        fields={[
          { name: 'title', label: 'Title', base: p.title },
          { name: 'text', label: 'Text', base: p.text, kind: 'textarea' },
          { name: 'button_label', label: 'Button text', base: p.button_label },
        ]}
      />
    </div>
  )
}

/** The B8a form for a node, or null for other types. */
export function B8aForm(props: B8aFormProps<Element>) {
  const pass = <N,>() => props as unknown as B8aFormProps<N>
  switch (props.node.type) {
    case 'pricing_table':
      return <PricingTableForm {...pass<PricingTableElement>()} />
    case 'before_after':
      return <BeforeAfterForm {...pass<BeforeAfterElement>()} />
    case 'comparison_table':
      return <ComparisonTableForm {...pass<ComparisonTableElement>()} />
    case 'flash_sale_bar':
      return <FlashSaleBarForm {...pass<FlashSaleBarElement>()} />
    case 'bundle':
      return <BundleForm {...pass<BundleElement>()} />
    default:
      return <B8aPeopleForm {...props} />
  }
}
