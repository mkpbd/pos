import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { compareDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import { usePriceFormat } from '../money'
import type { ListingFacets } from '../types'
import { hasActiveFilters, isPriceInput, toggleAttribute, toggleValue, type ListingScope, type ListingState } from './listing-params'

type Props = {
  scope: ListingScope
  state: ListingState
  facets: ListingFacets
  /** Applies a filter change (the page resets to 1). */
  onChange: (patch: Partial<ListingState>) => void
  onClear: () => void
  /** Link to a category page carrying the current filters. */
  categoryHref: (slug: string) => string
}

function Group({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()

  return (
    <section className="border-b py-4 last:border-b-0" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-base">
        <button type="button" className="flex w-full items-center justify-between gap-2 font-bold" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          {title}
          <ChevronDownIcon aria-hidden className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </button>
      </h3>
      <div id={id} hidden={!open} className="pt-3">
        {children}
      </div>
    </section>
  )
}

function CheckRow({ label, count, checked, onToggle }: { label: string; count: number; checked: boolean; onToggle: () => void }) {
  const id = useId()
  const { t, formatNumber } = useLocale()
  const disabled = count === 0 && !checked

  return (
    <li className={cn('flex items-center gap-2.5 py-1 text-sm', disabled && 'opacity-50')}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} className="size-4 shrink-0 accent-sf-accent" />
      <label htmlFor={id} className="flex flex-1 cursor-pointer justify-between gap-2">
        <span className={cn(checked && 'font-semibold text-sf-heading')}>{label}</span>
        <span className="tabular-nums" aria-label={t('catalog.filter.productCount', { count })}>({formatNumber(count)})</span>
      </label>
    </li>
  )
}

function PriceFilter({ state, facets, onChange }: Pick<Props, 'state' | 'facets' | 'onChange'>) {
  const id = useId()
  const format = usePriceFormat()
  const { t } = useLocale()
  const [min, setMin] = useState(state.priceMin ?? '')
  const [max, setMax] = useState(state.priceMax ?? '')
  const [error, setError] = useState<string | null>(null)

  const apply = (event: FormEvent) => {
    event.preventDefault()
    const lo = min.trim()
    const hi = max.trim()
    if ((lo && !isPriceInput(lo)) || (hi && !isPriceInput(hi))) return setError(t('catalog.filter.priceFormat'))
    if (lo && hi && compareDecimal(lo, hi) > 0) return setError(t('catalog.filter.priceOrder'))
    setError(null)
    onChange({ priceMin: lo || null, priceMax: hi || null })
  }

  const range = facets.price
  return (
    <form onSubmit={apply} noValidate className="flex flex-col gap-2" aria-label={t('catalog.filter.priceRange')}>
      {range?.min && range.max && (
        <p className="text-xs">
          {t('catalog.filter.priceFromTo', { min: format.price(range.min), max: format.price(range.max) })}
        </p>
      )}
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-min`} className="sr-only">{t('catalog.filter.minPrice')}</label>
        <input
          id={`${id}-min`}
          inputMode="decimal"
          placeholder={t('catalog.filter.min')}
          value={min}
          onChange={(e) => setMin(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-10 w-full min-w-0 rounded-lg border bg-sf-surface px-3 text-sm text-sf-heading focus-visible:outline-2 focus-visible:outline-sf-accent"
        />
        <span aria-hidden>–</span>
        <label htmlFor={`${id}-max`} className="sr-only">{t('catalog.filter.maxPrice')}</label>
        <input
          id={`${id}-max`}
          inputMode="decimal"
          placeholder={t('catalog.filter.max')}
          value={max}
          onChange={(e) => setMax(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-10 w-full min-w-0 rounded-lg border bg-sf-surface px-3 text-sm text-sf-heading focus-visible:outline-2 focus-visible:outline-sf-accent"
        />
      </div>
      {error && <p id={`${id}-error`} role="alert" className="text-xs font-medium text-sf-sale">{error}</p>}
      <button type="submit" className="h-9 self-start rounded-sf-button bg-sf-accent px-5 text-sm font-semibold text-sf-accent-foreground transition hover:brightness-110">
        {t('catalog.filter.applyPrice')}
      </button>
    </form>
  )
}

/**
 * The listing filters (desktop sidebar and mobile drawer). Counts come from the API's
 * disjunctive facets; every change goes to the URL.
 */
export function FilterPanel({ scope, state, facets, onChange, onClear, categoryHref }: Props) {
  const categoryAsParam = scope.kind === 'brand' || scope.kind === 'search' || scope.kind === 'shop'
  const { t, formatNumber } = useLocale()

  return (
    <div className="flex flex-col" data-testid="filter-panel">
      {hasActiveFilters(state) && (
        <button type="button" onClick={onClear} className="mb-2 self-start text-sm font-semibold text-sf-link underline-offset-4 hover:underline">
          {t('catalog.filter.clearAll')}
        </button>
      )}

      {(facets.categories.length > 0 || state.category) && (
        <Group title={t('catalog.filter.categories')}>
          <ul className="flex flex-col gap-1 text-sm">
            {state.category && categoryAsParam && (
              <li>
                <button type="button" className="py-1 font-semibold text-sf-link hover:underline" onClick={() => onChange({ category: null })}>
                  {t('catalog.filter.allCategories')}
                </button>
              </li>
            )}
            {facets.categories.map((c) => (
              <li key={c.slug}>
                {scope.kind === 'search' || scope.kind === 'brand' ? (
                  <button type="button" className="flex w-full justify-between gap-2 py-1 text-left hover:text-sf-accent" onClick={() => onChange({ category: c.slug })}>
                    <span>{c.name}</span>
                    <span className="tabular-nums">({formatNumber(c.count)})</span>
                  </button>
                ) : (
                  <Link to={categoryHref(c.slug)} className="flex justify-between gap-2 py-1 hover:text-sf-accent">
                    <span>{c.name}</span>
                    <span className="tabular-nums">({formatNumber(c.count)})</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Group>
      )}

      {scope.kind !== 'brand' && facets.brands.length > 0 && (
        <Group title={t('catalog.filter.brands')}>
          <ul>
            {facets.brands.map((b) => (
              <CheckRow
                key={b.slug}
                label={b.name}
                count={b.count}
                checked={state.brands.includes(b.slug)}
                onToggle={() => onChange({ brands: toggleValue(state.brands, b.slug) })}
              />
            ))}
          </ul>
        </Group>
      )}

      {(facets.price?.min || state.priceMin || state.priceMax) && (
        <Group title={t('catalog.filter.price')}>
          {/* Keyed by the URL values: back button and "clear all" reset the inputs. */}
          <PriceFilter key={`${state.priceMin}|${state.priceMax}`} state={state} facets={facets} onChange={onChange} />
        </Group>
      )}

      {facets.attributes.map((attribute) => (
        <Group key={attribute.slug} title={attribute.name}>
          {attribute.display === 'swatch' ? (
            <ul className="flex flex-wrap gap-2" aria-label={attribute.name}>
              {attribute.values.map((v) => {
                const checked = (state.attrs[attribute.slug] ?? []).includes(v.value)
                return (
                  <li key={v.value}>
                    <button
                      type="button"
                      aria-pressed={checked}
                      disabled={v.count === 0 && !checked}
                      title={t('catalog.filter.valueCount', { value: v.value, count: v.count })}
                      onClick={() => onChange({ attrs: toggleAttribute(state.attrs, attribute.slug, v.value) })}
                      className={cn('relative grid size-9 place-items-center rounded-full border-2 p-0.5 transition disabled:opacity-35', checked ? 'border-sf-accent' : 'border-sf-border hover:border-sf-heading')}
                    >
                      <span className="block size-full rounded-full border border-black/10" style={{ backgroundColor: v.swatch_hex ?? undefined }} aria-hidden />
                      {checked && <CheckIcon aria-hidden className="absolute size-4 text-white mix-blend-difference" />}
                      <span className="sr-only">{t('catalog.filter.valueProducts', { value: v.value, products: t('catalog.filter.productCount', { count: v.count }) })}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <ul>
              {attribute.values.map((v) => (
                <CheckRow
                  key={v.value}
                  label={v.value}
                  count={v.count}
                  checked={(state.attrs[attribute.slug] ?? []).includes(v.value)}
                  onToggle={() => onChange({ attrs: toggleAttribute(state.attrs, attribute.slug, v.value) })}
                />
              ))}
            </ul>
          )}
        </Group>
      ))}

      <Group title={t('catalog.filter.availability')}>
        <ul>
          <CheckRow label={t('catalog.stock.in')} count={facets.in_stock.count} checked={state.inStock} onToggle={() => onChange({ inStock: !state.inStock })} />
          <CheckRow label={t('catalog.filter.onSale')} count={facets.on_sale.count} checked={state.onSale} onToggle={() => onChange({ onSale: !state.onSale })} />
        </ul>
      </Group>
    </div>
  )
}
