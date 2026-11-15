/*
 * Content tab forms of the B17 elements: ornament (a picker of the built-in drawings with
 * previews), payment badges ("How you can pay"), delivery promise, Bangla date. Trust badges are
 * the B6 form (extended with links in ./b6-forms.tsx). The data notes ask POST /builder/resolve,
 * like the canvas.
 */

import { useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckIcon, InfoIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useThemeQuery } from '@/features/storefront/api'
import { cn } from '@/lib/utils'
import { ORNAMENTS, isOrnamentName } from '@/storefront/builder/elements/ornament-names'
import { OrnamentArt } from '@/storefront/builder/elements/ornaments'
import type { BanglaDateElement, DeliveryPromiseElement, Element, OrnamentElement, PaymentBadgesElement, PaymentWallet } from '@/storefront/builder/types'
import { B17_ENUMS, B17_LIMITS, B17_TEXT_LIMITS } from '@/storefront/builder/validate'
import { resolvePreview } from '../api'
import {
  ALIGN_OPTIONS,
  BANGLA_DATE_STYLES,
  DELIVERY_LAYOUTS,
  FIXED_COLOR_ORNAMENTS,
  ORNAMENT_FLIPS,
  ORNAMENT_SIZES,
  PAYMENT_STYLES,
  WALLET_NAMES,
  enumList,
  readDeliveryData,
  readPaymentData,
  toggleWallet,
  toggleZone,
  withOrnamentName,
} from './b17-model'
import { FieldError, ThemeColorField } from './fields'
import { Bangla, Note, NumberField } from './form-kit'
import { limitIn, patch, type ElementFormProps } from './form-model'
import { ChoiceField, ManageLink, PixelField, TextField, ToggleField } from './pickers'

export type B17FormProps<N> = ElementFormProps<N> & {
  /** GET /elements `enums` (ornament names, repeatable drawings …). */
  enums?: Record<string, unknown>
}

const limit = (type: string, field: string) => limitIn(B17_TEXT_LIMITS as Record<string, Record<string, number>>, type, field)

/** What the store shows for a data element now (null while loading, offline or not allowed). */
function useElementData(node: Element, key: unknown) {
  const query = useQuery({
    queryKey: ['store-builder', 'element-data', JSON.stringify({ id: node.id, type: node.type, key })] as const,
    queryFn: ({ signal }) =>
      resolvePreview({ elements: [{ id: node.id, type: node.type, props: node.props as Record<string, unknown>, translations: node.translations ?? {} }], media_ids: [] }, signal).then(
        (result) => result.data[node.id] ?? null,
      ),
    staleTime: 30_000,
    retry: false,
  })
  return query.isSuccess ? query.data : undefined
}

function StatusNote({ tone = 'info', children, testId }: { tone?: 'info' | 'warning'; children: React.ReactNode; testId?: string }) {
  const Icon = tone === 'warning' ? TriangleAlertIcon : InfoIcon
  return (
    <p
      role="status"
      data-testid={testId}
      className={cn(
        'flex gap-1.5 rounded-md border p-3 text-sm',
        tone === 'warning' ? 'border-amber-300/70 bg-amber-50 text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100' : 'bg-muted/40',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Ornament
 * -------------------------------------------------------------------------------------------- */

/** The drawings in groups people recognise; drawings the list doesn't know go to "More". */
const ORNAMENT_GROUPS: { label: string; label_bn: string; names: string[] }[] = [
  { label: 'Eid and Ramadan', label_bn: 'ঈদ ও রমজান', names: ['crescent_star', 'lantern', 'mosque_dome'] },
  { label: 'Bangla festivals and Puja', label_bn: 'বাংলা উৎসব ও পূজা', names: ['alpona_border', 'alpona_round', 'kash_flower', 'dhak', 'diya', 'shapla'] },
  { label: 'National days', label_bn: 'জাতীয় দিবস', names: ['flag_ribbon', 'shaheed_minar'] },
  { label: 'Sales and seasons', label_bn: 'সেল ও মৌসুম', names: ['snowflake', 'gift_box', 'confetti', 'sparkle', 'sale_tag'] },
]

/** `theme:<role>` → the store theme's colour (so previews look like the shop); hex stays. */
function useThemeColor() {
  const theme = useThemeQuery()
  const colors = theme.data?.settings.colors as Record<string, string | null | undefined> | undefined
  return (value: string | null | undefined) => {
    if (!value) return value
    if (!value.startsWith('theme:')) return value
    return colors?.[value.slice(6)] ?? value
  }
}

export function OrnamentPicker({ value, onChange, color, secondary, names, error }: {
  value: string
  onChange: (name: string) => void
  color?: string | null
  secondary?: string | null
  /** The drawings the server accepts (enums.ornament_names); default all. */
  names: readonly string[]
  error?: string
}) {
  const legendId = useId()
  const known = ORNAMENTS.filter((o) => names.includes(o.name))
  const grouped = new Set(ORNAMENT_GROUPS.flatMap((g) => g.names))
  const groups = [...ORNAMENT_GROUPS, { label: 'More', label_bn: 'আরও', names: known.map((o) => o.name).filter((n) => !grouped.has(n)) }]
    .map((g) => ({ ...g, items: known.filter((o) => g.names.includes(o.name)) }))
    .filter((g) => g.items.length > 0)
  return (
    <fieldset className="flex flex-col gap-3" aria-describedby={error ? `${legendId}-error` : undefined}>
      <legend id={legendId} className="mb-1.5 text-sm font-medium">
        Drawing
      </legend>
      {groups.map((group) => (
        <div key={group.label} role="group" aria-label={group.label} className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {group.label} · <span lang="bn">{group.label_bn}</span>
          </p>
          <div className="grid grid-cols-3 gap-1.5 p-0.5">
            {group.items.map((o) => {
              const active = o.name === value
              return (
                <button
                  key={o.name}
                  type="button"
                  aria-pressed={active}
                  title={`${o.label} (${o.label_bn})`}
                  onClick={() => onChange(o.name)}
                  data-testid={`ornament-${o.name}`}
                  className={cn(
                    'relative flex min-h-20 flex-col items-center justify-center gap-1 rounded-md border p-1.5 text-center outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
                    active && 'border-primary bg-primary/10',
                  )}
                >
                  <span className="flex h-9 w-full items-center justify-center overflow-hidden">
                    <OrnamentArt name={o.name} color={color} secondary={secondary} size={32} className="max-w-full" />
                  </span>
                  <span className="text-xs leading-tight">{o.label}</span>
                  <span lang="bn" className="text-[11px] leading-tight text-muted-foreground">
                    {o.label_bn}
                  </span>
                  {active && <CheckIcon className="absolute top-1 right-1 size-3.5 text-primary" aria-hidden />}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <FieldError id={`${legendId}-error`} message={error} />
    </fieldset>
  )
}

export function OrnamentForm(props: B17FormProps<OrnamentElement>) {
  const { node, onChange, errors, enums } = props
  const p = node.props
  const toColor = useThemeColor()
  const names = enumList(enums, 'ornament_names', ORNAMENTS.map((o) => o.name))
  const repeatable = enumList(enums, 'ornament_repeatable', B17_ENUMS.ornamentRepeatable)
  const fixedColors = FIXED_COLOR_ORNAMENTS.includes(p.name)
  const canRepeat = repeatable.includes(p.name)
  const isBorder = canRepeat
  const set = (values: Partial<OrnamentElement['props']>, key?: string) => patch(node, onChange, values, key)
  const name = isOrnamentName(p.name) ? p.name : null

  return (
    <div className="flex flex-col gap-4">
      {name && (
        <div className="flex h-24 items-center justify-center overflow-hidden rounded-md border bg-muted/30 p-2" data-testid="ornament-preview">
          <OrnamentArt
            name={name}
            color={toColor(p.color)}
            secondary={toColor(p.secondary_color)}
            size={Math.min(p.size, 80)}
            repeat={p.repeat}
            style={{ opacity: p.opacity / 100, transform: flipTransform(p.flip) }}
            className="max-w-full"
          />
        </div>
      )}
      <OrnamentPicker
        value={p.name}
        names={names}
        color={toColor(p.color)}
        secondary={toColor(p.secondary_color)}
        error={errors.name}
        onChange={(next) => onChange({ ...node, props: withOrnamentName(p, next, repeatable) })}
      />
      {fixedColors ? (
        <Note>The flag ribbon always uses the national flag’s green and red.</Note>
      ) : (
        <>
          <ThemeColorField label="Colour" value={p.color} error={errors.color} onChange={(color) => set({ color }, 'color')} />
          <ToggleField
            label="Use a second colour"
            hint="Some drawings have two colours. Off: the drawing picks a softer shade itself."
            checked={p.secondary_color !== null}
            onChange={(on) => set({ secondary_color: on ? 'theme:accent' : null })}
          />
          {p.secondary_color !== null && <ThemeColorField label="Second colour" value={p.secondary_color} error={errors.secondary_color} onChange={(secondary_color) => set({ secondary_color }, 'secondary_color')} />}
        </>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">{isBorder ? 'Height' : 'Size'}</legend>
        <div role="group" aria-label="Quick sizes" className="flex flex-wrap gap-1.5">
          {ORNAMENT_SIZES.map((s) => (
            <Button key={s.value} type="button" size="sm" variant={p.size === s.value ? 'default' : 'outline'} aria-pressed={p.size === s.value} onClick={() => set({ size: s.value })}>
              {s.label}
            </Button>
          ))}
        </div>
        <PixelField
          label={isBorder ? 'Height in px' : 'Size in px'}
          value={p.size}
          min={B17_LIMITS.ornamentSize.min}
          max={B17_LIMITS.ornamentSize.max}
          error={errors.size}
          onChange={(size) => set({ size }, 'size')}
        />
      </fieldset>
      {canRepeat && <ToggleField label="Repeat across the width" hint="Makes a border along the whole section." checked={p.repeat} onChange={(repeat) => set({ repeat })} />}
      <FieldError message={canRepeat ? undefined : errors.repeat} />
      {!(canRepeat && p.repeat) && <ChoiceField label="Position" value={p.align} options={ALIGN_OPTIONS} error={errors.align} onChange={(align) => set({ align })} />}
      <ChoiceField label="Turn" value={p.flip} options={ORNAMENT_FLIPS} error={errors.flip} onChange={(flip) => set({ flip })} hint="Mirror a drawing to use it on the other side, e.g. two lanterns facing each other." />
      <NumberField
        label="Strength (%)"
        value={p.opacity}
        min={B17_LIMITS.ornamentOpacity.min}
        max={B17_LIMITS.ornamentOpacity.max}
        hint="100 % is full colour; lower makes a soft background decoration."
        error={errors.opacity}
        onChange={(opacity) => set({ opacity }, 'opacity')}
      />
      <Note>A decoration only: screen readers skip it, so don’t put important words in it.</Note>
    </div>
  )
}

function flipTransform(flip: OrnamentElement['props']['flip']): string | undefined {
  if (flip === 'horizontal') return 'scaleX(-1)'
  if (flip === 'vertical') return 'scaleY(-1)'
  if (flip === 'both') return 'scale(-1, -1)'
  return undefined
}

/* ----------------------------------------------------------------------------------------------
 * Payment badges
 * -------------------------------------------------------------------------------------------- */

export function PaymentBadgesForm(props: B17FormProps<PaymentBadgesElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  const set = (values: Partial<PaymentBadgesElement['props']>, key?: string) => patch(node, onChange, values, key)
  const data = useElementData(node, { show: p.show_store_methods, wallets: p.wallets })
  const resolved = data === undefined ? null : readPaymentData(data)
  const groupId = useId()
  return (
    <div className="flex flex-col gap-4">
      <TextField label="Title" value={p.title} max={limit('payment_badges', 'title')} error={errors.title} onChange={(title) => set({ title }, 'title')} />
      <ToggleField
        label="Show your shop’s payment methods"
        hint="Cash on delivery, bank transfer and online payment, as they are switched on for your checkout."
        checked={p.show_store_methods}
        onChange={(show_store_methods) => set({ show_store_methods })}
      />
      {p.show_store_methods && resolved && resolved.methods.length > 0 && (
        <p className="text-sm text-muted-foreground" data-testid="payment-methods-now">
          Shoppers see now: {resolved.methods.join(', ')}.
        </p>
      )}
      <fieldset className="flex flex-col gap-2" aria-describedby={`${groupId}-hint`}>
        <legend className="mb-1 text-sm font-medium">Mobile wallets you take</legend>
        <p id={`${groupId}-hint`} className="text-sm text-muted-foreground">
          Shown as plain text badges, never brand logos.
        </p>
        {(B17_ENUMS.paymentWallet as readonly PaymentWallet[]).map((wallet) => {
          const id = `${groupId}-${wallet}`
          return (
            <div key={wallet} className="flex items-center gap-2">
              <Checkbox id={id} checked={p.wallets.includes(wallet)} onCheckedChange={(on) => set({ wallets: toggleWallet(p.wallets, wallet, on === true) })} />
              <Label htmlFor={id} className="font-normal">
                {WALLET_NAMES[wallet].en} <span lang="bn" className="text-muted-foreground">({WALLET_NAMES[wallet].bn})</span>
              </Label>
            </div>
          )
        })}
        <FieldError message={errors.wallets} />
      </fieldset>
      <TextField
        label="Note"
        multiline
        hint="Optional, e.g. “Send Money to our shop number and type the transaction ID at checkout.”"
        value={p.note}
        max={limit('payment_badges', 'note')}
        error={errors.note}
        onChange={(note) => set({ note }, 'note')}
      />
      <ChoiceField label="Look" value={p.style} options={PAYMENT_STYLES} error={errors.style} onChange={(style) => set({ style })} />
      <ChoiceField label="Alignment" value={p.align} options={ALIGN_OPTIONS} error={errors.align} onChange={(align) => set({ align })} />
      {resolved?.empty && (
        <StatusNote tone="warning" testId="payment-empty">
          Nothing to show yet: switch on a payment method for your checkout or tick a wallet. Until then this stays hidden on your shop.
        </StatusNote>
      )}
      <ManageLink to="/storefront/payments">Payment methods</ManageLink>
      <Bangla
        {...props}
        fields={[
          { name: 'title', label: 'Title', base: p.title },
          { name: 'note', label: 'Note', base: p.note, kind: 'textarea' },
        ]}
      />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Delivery promise
 * -------------------------------------------------------------------------------------------- */

const ZONE_CHOICE = [
  { value: 'all', label: 'All delivery areas' },
  { value: 'chosen', label: 'Only the areas I choose' },
] as const

export function DeliveryPromiseForm(props: B17FormProps<DeliveryPromiseElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  const set = (values: Partial<DeliveryPromiseElement['props']>, key?: string) => patch(node, onChange, values, key)
  const data = useElementData(node, { zones: p.zones })
  const resolved = data === undefined ? null : readDeliveryData(data)
  const groupId = useId()
  const chosen = p.zones === 'all' ? [] : p.zones
  const zones = resolved?.allZones ?? []
  const missing = resolved?.missing ?? []
  const atMax = chosen.length >= B17_LIMITS.deliveryZones.max
  return (
    <div className="flex flex-col gap-4">
      <TextField label="Title" value={p.title} max={limit('delivery_promise', 'title')} error={errors.title} onChange={(title) => set({ title }, 'title')} />
      <ChoiceField
        label="Delivery areas shown"
        value={p.zones === 'all' ? 'all' : 'chosen'}
        options={ZONE_CHOICE}
        error={p.zones === 'all' ? errors.zones : undefined}
        onChange={(choice) => set({ zones: choice === 'all' ? 'all' : zones.slice(0, 1).map((z) => z.id) })}
      />
      {p.zones !== 'all' && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Areas</legend>
          {resolved === null && <p className="text-sm text-muted-foreground">Loading your delivery areas…</p>}
          {resolved !== null && zones.length === 0 && <p className="text-sm text-muted-foreground">No delivery areas yet. Add them on the Shipping page.</p>}
          {zones.map((zone) => {
            const id = `${groupId}-${zone.id}`
            const on = chosen.includes(zone.id)
            return (
              <div key={zone.id} className="flex items-center gap-2">
                <Checkbox id={id} checked={on} disabled={!on && atMax} onCheckedChange={(next) => set({ zones: toggleZone(p.zones, zone.id, next === true) })} />
                <Label htmlFor={id} className="font-normal">
                  {zone.name}
                </Label>
              </div>
            )
          })}
          {chosen
            .filter((id) => missing.includes(id))
            .map((id) => (
              <div key={id} className="flex items-center gap-2 rounded-md border border-amber-300/70 bg-amber-50 p-2 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" data-testid="zone-missing">
                <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
                <span className="flex-1">This delivery zone is gone.</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => set({ zones: toggleZone(p.zones, id, false) })}>
                  <XIcon data-icon="inline-start" /> Remove
                </Button>
              </div>
            ))}
          {atMax && <p className="text-sm text-muted-foreground">At most {B17_LIMITS.deliveryZones.max} areas; choose “All delivery areas” to show every one.</p>}
          <FieldError message={errors.zones} />
        </fieldset>
      )}
      <ToggleField label="Show the delivery charge" checked={p.show_price} onChange={(show_price) => set({ show_price })} />
      <ToggleField label="Say where cash on delivery is possible" checked={p.show_cod} onChange={(show_cod) => set({ show_cod })} />
      <ToggleField label="Show free delivery over an amount" hint="Only when a delivery method has a free-delivery amount." checked={p.show_free_over} onChange={(show_free_over) => set({ show_free_over })} />
      <ChoiceField label="Look" value={p.layout} options={DELIVERY_LAYOUTS} error={errors.layout} onChange={(layout) => set({ layout })} />
      {resolved?.empty && (
        <StatusNote tone="warning" testId="delivery-empty">
          No delivery areas with a delivery method to show yet. Until there are, this stays hidden on your shop.
        </StatusNote>
      )}
      <Note>Times, charges and areas come from your Shipping settings, so the block stays right when you change them. Bangla pages show Bangla digits.</Note>
      <ManageLink to="/storefront/shipping">Shipping settings</ManageLink>
      <Bangla {...props} fields={[{ name: 'title', label: 'Title', base: p.title }]} />
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Bangla date
 * -------------------------------------------------------------------------------------------- */

export function BanglaDateForm(props: B17FormProps<BanglaDateElement>) {
  const { node, onChange, errors } = props
  const p = node.props
  const set = (values: Partial<BanglaDateElement['props']>, key?: string) => patch(node, onChange, values, key)
  return (
    <div className="flex flex-col gap-4">
      <Note>
        Today’s date in the Bangla calendar used in Bangladesh, e.g. <span lang="bn">১ বৈশাখ ১৪৩৩, মঙ্গলবার</span>, in your shop’s time zone. It changes by itself every day.
      </Note>
      <TextField label="Words before the date" hint="Optional, e.g. “আজ”." value={p.prefix} max={limit('bangla_date', 'prefix')} error={errors.prefix} onChange={(prefix) => set({ prefix }, 'prefix')} />
      <ToggleField label="Also show the English date" checked={p.show_gregorian} onChange={(show_gregorian) => set({ show_gregorian })} />
      <ToggleField
        label="Also show the Hijri date"
        hint="Calculated, so it is marked “expected”: it may differ by a day from the moon sighting."
        checked={p.show_hijri}
        onChange={(show_hijri) => set({ show_hijri })}
      />
      <ChoiceField label="Look" value={p.style} options={BANGLA_DATE_STYLES} error={errors.style} onChange={(style) => set({ style })} />
      <ChoiceField label="Alignment" value={p.align} options={ALIGN_OPTIONS} error={errors.align} onChange={(align) => set({ align })} />
      <Bangla {...props} fields={[{ name: 'prefix', label: 'Words before the date', base: p.prefix }]} />
    </div>
  )
}

/* ---------------------------------------------------------------------------------------------- */

/** The B17 form for a node, or null for other types. */
export function B17Form(props: B17FormProps<Element>) {
  const pass = <N,>() => props as unknown as B17FormProps<N>
  switch (props.node.type as string) {
    case 'ornament':
      return <OrnamentForm {...pass<OrnamentElement>()} />
    case 'payment_badges':
      return <PaymentBadgesForm {...pass<PaymentBadgesElement>()} />
    case 'delivery_promise':
      return <DeliveryPromiseForm {...pass<DeliveryPromiseElement>()} />
    case 'bangla_date':
      return <BanglaDateForm {...pass<BanglaDateElement>()} />
    default:
      return null
  }
}
