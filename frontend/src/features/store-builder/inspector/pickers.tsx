/*
 * Pickers and small fields of the B4 inspector forms: icon grid, promotion / menu / product
 * pickers on the existing admin APIs, a date-time field in the organization's timezone, and
 * plain toggles / choices / text fields with counters.
 */

import { useId, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { CheckIcon, ExternalLinkIcon, ImageIcon, SearchIcon } from 'lucide-react'
import { FormField } from '@/components/common/form-field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useCurrentUserQuery } from '@/features/auth/api'
import { ProductSearchAdder } from '@/features/online-catalog/components/ordered-picker'
import { useProductNames } from '@/features/products/api'
import { usePromotionQuery, usePromotionsQuery, type PromotionRow } from '@/features/promotions/api'
import { fromZonedInput, toZonedInput } from '@/features/promotions/zoned-time'
import { useMenusQuery } from '@/features/storefront/api'
import { cn } from '@/lib/utils'
import { BuilderIcon } from '@/storefront/builder/icons'
import { FieldError } from './fields'
import { counter, iconLabel } from './format-text'

/* ---------------------------------------------------------------------------------------------- */


/** A single-line text with a character counter; `nullable`: an empty field stores null. */
export function TextField({ label, value, onChange, max, error, hint, multiline = false, placeholder }: {
  label: string
  value: string
  onChange: (value: string) => void
  max: number
  error?: string
  hint?: string
  multiline?: boolean
  placeholder?: string
}) {
  const help = hint ? `${hint} ${counter(value, max)}` : counter(value, max)
  return (
    <FormField label={label} error={error} hint={help}>
      {multiline ? (
        <Textarea rows={3} maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </FormField>
  )
}

export function ToggleField({ label, checked, onChange, hint, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; hint?: string; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
        <Label htmlFor={id}>{label}</Label>
      </div>
      {hint && <p className="pl-11 text-sm text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function ChoiceField<V extends string>({ label, value, options, onChange, error, hint }: {
  label: string
  value: V
  options: readonly { value: V; label: string }[]
  onChange: (value: V) => void
  error?: string
  hint?: string
}) {
  return (
    <FormField label={label} error={error} hint={hint}>
      <Select value={value} onValueChange={(v) => onChange(v as V)}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  )
}

/** Whole pixels in a range (a number box; values outside are reported by the validation). */
export function PixelField({ label, value, min, max, onChange, error, hint }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; error?: string; hint?: string }) {
  const [text, setText] = useState(String(value))
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setText(String(value))
  }
  return (
    <FormField label={label} error={error} hint={hint ?? `${min}–${max} px`}>
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value !== '' && Number.isFinite(n)) onChange(Math.round(n))
        }}
      />
    </FormField>
  )
}

/** "Set it on the X page" pointer for data that lives elsewhere. */
export function ManageLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm underline underline-offset-2">
      {children} <ExternalLinkIcon className="size-3.5" aria-hidden />
    </Link>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Icons
 * -------------------------------------------------------------------------------------------- */


/** A searchable grid of the storefront icons with a preview of each. */
export function IconPicker({ value, icons, onChange, error }: { value: string; icons: readonly string[]; onChange: (name: string) => void; error?: string }) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return icons.filter((name) => !q || name.includes(q) || iconLabel(name).toLowerCase().includes(q))
  }, [icons, query])
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium">Icon</legend>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" aria-label="Search icons" placeholder="Search icons" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
      </div>
      <div role="group" aria-label="Icons" className="grid max-h-56 grid-cols-5 gap-1.5 overflow-y-auto p-0.5">
        {shown.map((name) => {
          const active = name === value
          return (
            <button
              key={name}
              type="button"
              title={iconLabel(name)}
              aria-label={iconLabel(name)}
              aria-pressed={active}
              onClick={() => onChange(name)}
              className={cn(
                'relative flex aspect-square items-center justify-center rounded-md border outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
                active && 'border-primary bg-primary/10',
              )}
            >
              <BuilderIcon name={name} size={20} />
              {active && <CheckIcon className="absolute top-0.5 right-0.5 size-3 text-primary" aria-hidden />}
            </button>
          )
        })}
      </div>
      {shown.length === 0 && <p className="text-sm text-muted-foreground">No icon matches “{query}”.</p>}
      <FieldError message={error} />
    </fieldset>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Promotions
 * -------------------------------------------------------------------------------------------- */

const STATE_LABELS: Record<string, string> = { active: 'running', scheduled: 'starts later', expired: 'ended', inactive: 'switched off' }

function promotionLabel(p: PromotionRow): string {
  const value = p.type === 'percent' ? `${Number(p.value ?? 0)} % off` : p.type === 'fixed' ? `${p.value ?? '0'} off` : 'free delivery'
  const state = p.state !== 'active' ? ` · ${STATE_LABELS[p.state] ?? p.state}` : ''
  return `${p.name} (${value}${p.trigger === 'coupon' ? ', coupon' : ''})${state}`
}

/**
 * One promotion from GET /promotions. `kind`: `countdown` lists flash sales (show_countdown),
 * `discount` lists percent / fixed-amount promotions.
 */
export function PromotionPicker({ kind, value, onChange, error, label }: { kind: 'countdown' | 'discount'; value: string | null; onChange: (id: string) => void; error?: string; label: string }) {
  const list = usePromotionsQuery({ page: 1, per_page: 100 })
  const options = (list.data?.items ?? []).filter((p) => (kind === 'countdown' ? p.show_countdown === true : p.type !== 'free_shipping'))
  const chosen = value ? options.find((p) => p.id === value) : undefined
  const empty = kind === 'countdown' ? 'No flash sales with a countdown yet. Turn on “Show a countdown” on a promotion first.' : 'No percent or amount promotions yet.'
  return (
    <div className="flex flex-col gap-1.5">
      <FormField label={label} error={error}>
        <Select value={value ?? undefined} onValueChange={onChange} disabled={list.isPending || options.length === 0}>
          <SelectTrigger className="w-full" aria-label={label}>
            <SelectValue placeholder={list.isPending ? 'Loading promotions…' : 'Choose a promotion'}>{chosen ? promotionLabel(chosen) : value ? 'A promotion not in this list' : undefined}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {promotionLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      {(list.isError || (!list.isPending && options.length === 0)) && (
        <p className="text-sm text-muted-foreground">{list.isError ? 'Promotions couldn’t be loaded (you may not have access to them).' : empty}</p>
      )}
      <ManageLink to="/promotions">Manage promotions</ManageLink>
    </div>
  )
}

/** The coupon code shoppers would see for a coupon promotion (the first active code). */
export function CouponPreview({ promotionId, show }: { promotionId: string | null; show: boolean }) {
  const detail = usePromotionQuery(promotionId ?? undefined)
  if (!promotionId || !detail.data) return null
  const p = detail.data
  if (p.trigger !== 'coupon') return <p className="text-sm text-muted-foreground">This promotion applies automatically; there is no code to show.</p>
  const first = (p.coupons_preview ?? [])[0]
  const code = typeof first === 'string' ? first : first?.code
  if (!show) return <p className="text-sm text-muted-foreground">The coupon code is hidden; shoppers see only the offer.</p>
  return (
    <p className="text-sm" data-testid="coupon-preview">
      Shoppers see the code <span className="rounded border border-dashed px-1.5 py-0.5 font-mono font-semibold">{code ?? '—'}</span>
      {!code && <span className="text-muted-foreground"> (add a code to the promotion first)</span>}
    </p>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Menus
 * -------------------------------------------------------------------------------------------- */

export function MenuPicker({ value, onChange, error }: { value: string | null; onChange: (id: string) => void; error?: string }) {
  const menus = useMenusQuery()
  const list = menus.data ?? []
  return (
    <div className="flex flex-col gap-1.5">
      <FormField label="Menu" error={error}>
        <Select value={value ?? undefined} onValueChange={onChange} disabled={menus.isPending || list.length === 0}>
          <SelectTrigger className="w-full" aria-label="Menu">
            <SelectValue placeholder={menus.isPending ? 'Loading menus…' : 'Choose a menu'} />
          </SelectTrigger>
          <SelectContent>
            {list.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name} · {m.location_label}
                {m.is_active ? '' : ' (off)'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      {!menus.isPending && list.length === 0 && <p className="text-sm text-muted-foreground">{menus.isError ? 'Your menus couldn’t be loaded.' : 'You have no menus yet. Create one first.'}</p>}
      <ManageLink to="/storefront/menus">Manage menus</ManageLink>
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * One product
 * -------------------------------------------------------------------------------------------- */

export function SingleProductPicker({ value, onChange, error }: { value: string | null; onChange: (id: string) => void; error?: string }) {
  const names = useProductNames(value ? [value] : [])
  const found = value ? names.get(value) : undefined
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Product</span>
      {value && (
        <div className="flex items-center gap-3 rounded-md border p-2" data-testid="chosen-product">
          <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
            {found?.image_url ? <img src={found.image_url} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4 text-muted-foreground" aria-hidden />}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">{found?.name ?? 'Loading…'}</span>
        </div>
      )}
      <ProductSearchAdder label={value ? 'Change product' : 'Choose product'} exclude={value ? [value] : []} onPick={(item) => onChange(item.id)} />
      <FieldError message={error} />
      <p className="text-sm text-muted-foreground">Only products listed in your online store are shown to shoppers.</p>
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------
 * Date and time in the organization's timezone
 * -------------------------------------------------------------------------------------------- */

export function ZonedDateTimeField({ label, value, onChange, error, hint }: { label: string; value: string | null; onChange: (iso: string | null) => void; error?: string; hint?: string }) {
  const me = useCurrentUserQuery()
  const timeZone = me.data?.organization?.timezone
  return (
    <div className="flex flex-col gap-1.5">
      <FormField label={label} error={error} hint={hint}>
        <Input type="datetime-local" value={toZonedInput(value, timeZone)} onChange={(e) => onChange(fromZonedInput(e.target.value, timeZone))} />
      </FormField>
      {timeZone && <p className="text-sm text-muted-foreground">In your store’s time zone ({timeZone}).</p>}
    </div>
  )
}
