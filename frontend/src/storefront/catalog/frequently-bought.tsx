import { useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useQueries } from '@tanstack/react-query'
import { Loader2Icon, ShoppingCartIcon } from 'lucide-react'
import { sumDecimals } from '@/lib/money'
import { cn } from '@/lib/utils'
import { primaryButtonClass } from '../account/form-controls'
import { currentPrice, startVariant, useAddSeveral } from '../cart/add-several'
import { AddSeveralStatus } from '../cart/add-several-status'
import { useLocale } from '../i18n/locale'
import { usePriceFormat } from '../money'
import type { CatalogImage, ProductCard, ProductDetail, ProductVariant } from '../types'
import { productQueryOptions } from './api'
import { Price } from './price'
import { ProductImage } from './product-image'
import { useNearViewport } from './use-viewport'

/** Other products offered next to this one (the current product + up to three). */
const MAX_OTHERS = 3

type LineStatus = 'ready' | 'out' | 'choose' | 'loading' | 'failed'

type Line = {
  key: string
  name: string
  url: string
  image: CatalogImage | null
  current: boolean
  status: LineStatus
  variantId: string | null
  /** The unit price today (promotion included) and the struck price, when known. */
  price: string | null
  compareAt: string | null
  /** A product with several variants: its variants for the option select (once loaded). */
  variants: ProductVariant[] | null
  variantName: string | null
}

const isSingle = (card: ProductCard) => card.variant_count === 1 && Boolean(card.default_variant_id)

function variantLine(base: Omit<Line, 'status' | 'variantId' | 'price' | 'compareAt' | 'variantName'>, variant: ProductVariant | null): Line {
  if (!variant) return { ...base, status: base.current ? 'choose' : 'failed', variantId: null, price: null, compareAt: null, variantName: null }
  return {
    ...base,
    status: variant.in_stock ? 'ready' : 'out',
    variantId: variant.id,
    price: currentPrice(variant),
    compareAt: variant.promo_price ? variant.price : variant.on_sale ? variant.compare_at_price : null,
    variantName: variant.name,
  }
}

/**
 * P1b "Frequently bought together" on the product page: this product (in the variant chosen above)
 * and up to three others — hand-picked by the owner, else bought together by other shoppers — each
 * with a checkbox (ticked when available), the exact sum of the ticked items' prices today
 * (informational: the cart reprices every line) and "Add selected to cart", which adds one of each
 * in turn (the B8a bundle's logic) and announces the outcome, naming what could not be added. Products
 * with several variants get an option select once their details are near the screen.
 */
export function FrequentlyBought({
  product,
  variant,
  cards,
  source,
  onChooseOptions,
}: {
  product: ProductDetail
  variant: ProductVariant | null
  cards: ProductCard[]
  source: 'manual' | 'automatic' | null
  onChooseOptions: () => void
}) {
  const { t, locale } = useLocale()
  const format = usePriceFormat()
  const { busy, result, addAll } = useAddSeveral()
  const rootRef = useRef<HTMLElement>(null)
  const near = useNearViewport(rootRef)
  const titleId = useId()
  const selectBase = useId()
  const [excluded, setExcluded] = useState<Record<string, boolean>>({})
  const [chosen, setChosen] = useState<Record<string, string>>({})

  const others = cards.filter((card) => card.id !== product.id && card.slug !== product.slug).slice(0, MAX_OTHERS)
  const multi = others.filter((card) => !isSingle(card))
  const details = useQueries({ queries: multi.map((card) => ({ ...productQueryOptions(card.slug, false, locale), enabled: near })) })
  if (others.length === 0) return null

  const detailOf = (card: ProductCard) => details[multi.indexOf(card)]

  const lines: Line[] = [
    variantLine({ key: 'current', name: product.name, url: product.url, image: product.images[0] ?? null, current: true, variants: null }, variant),
    ...others.map((card): Line => {
      const base = { key: card.id, name: card.name, url: card.url, image: card.image, current: false }
      if (isSingle(card)) {
        return {
          ...base,
          variants: null,
          status: card.in_stock ? 'ready' : 'out',
          variantId: card.default_variant_id,
          price: card.promotion?.price ?? card.price,
          compareAt: card.promotion ? card.price : card.on_sale ? card.compare_at_price : null,
          variantName: null,
        }
      }
      const query = detailOf(card)
      const detail = query?.data
      if (!detail || !Array.isArray(detail.variants)) {
        return { ...base, variants: null, status: query?.error ? 'failed' : 'loading', variantId: null, price: null, compareAt: null, variantName: null }
      }
      const picked = detail.variants.find((v) => v.id === chosen[card.id]) ?? startVariant(detail)
      return variantLine({ ...base, variants: detail.variants }, picked)
    }),
  ]

  const ticked = lines.filter((line) => line.status === 'ready' && !excluded[line.key])
  const total = sumDecimals(ticked.map((line) => line.price ?? '0'))

  return (
    <section ref={rootRef} aria-labelledby={titleId} className="mt-12" data-testid="frequently-bought" data-source={source ?? undefined}>
      <div className="mb-6">
        <h2 id={titleId} className="text-2xl font-extrabold lg:text-3xl">
          {t('catalog.product.frequentlyBought')}
        </h2>
        {source === 'automatic' && <p className="mt-1 text-sm">{t('catalog.fbt.automatic')}</p>}
      </div>
      <div className="flex flex-col gap-4 rounded-sf-card bg-sf-surface p-4 md:p-6">
        <ul className={cn('grid gap-3 md:grid-cols-2', lines.length >= 4 ? 'lg:grid-cols-4' : lines.length === 3 && 'lg:grid-cols-3')}>
          {lines.map((line) => {
            const checked = line.status === 'ready' && !excluded[line.key]
            const selectId = `${selectBase}-${line.key}`
            return (
              <li key={line.key} className={cn('flex gap-3 rounded-sf-card border p-3 transition-colors', checked ? 'border-sf-accent' : 'border-sf-border')} data-testid="fbt-item">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={line.status !== 'ready'}
                  onChange={(event) => setExcluded((current) => ({ ...current, [line.key]: !event.target.checked }))}
                  aria-label={t('catalog.fbt.include', { name: line.name })}
                  className="mt-1 size-5 shrink-0 accent-sf-accent"
                />
                <ProductImage image={line.image} alt="" className="size-16 shrink-0 rounded-md border" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {line.current && <p className="text-xs font-semibold tracking-wide text-sf-text uppercase">{t('catalog.fbt.thisItem')}</p>}
                  {line.current ? (
                    <p className="line-clamp-2 text-sm font-bold text-sf-heading">{line.name}</p>
                  ) : (
                    <Link to={line.url} className="line-clamp-2 text-sm font-bold text-sf-heading hover:underline">
                      {line.name}
                    </Link>
                  )}
                  {line.current && line.variantName && product.options.length > 0 && <p className="text-xs">{line.variantName}</p>}
                  {line.price && <Price price={line.price} compareAt={line.compareAt} size="sm" />}
                  {line.status === 'out' && <p className="text-xs font-semibold text-sf-sale">{t('catalog.stock.out')}</p>}
                  {line.status === 'loading' && <p className="text-xs">{t('catalog.fbt.loadingOptions')}</p>}
                  {line.status === 'choose' && (
                    <button type="button" onClick={onChooseOptions} className="self-start text-left text-xs font-semibold text-sf-link underline underline-offset-2 hover:no-underline">
                      {t('catalog.fbt.chooseOptions')}
                    </button>
                  )}
                  {line.status === 'failed' && !line.current && (
                    <Link to={line.url} className="self-start text-xs font-semibold text-sf-link underline underline-offset-2 hover:no-underline">
                      {t('cart.card.chooseOptions')}
                    </Link>
                  )}
                  {line.variants && line.variants.length > 1 && (
                    <div className="mt-1">
                      <label htmlFor={selectId} className="sr-only">
                        {t('catalog.fbt.option', { name: line.name })}
                      </label>
                      <select
                        id={selectId}
                        value={line.variantId ?? ''}
                        onChange={(event) => setChosen((current) => ({ ...current, [line.key]: event.target.value }))}
                        className="h-10 w-full rounded-md border border-sf-border bg-sf-surface px-2 text-sm text-sf-heading"
                      >
                        {line.variants.map((option) => (
                          <option key={option.id} value={option.id} disabled={!option.in_stock}>
                            {option.in_stock ? option.name : `${option.name} — ${t('catalog.stock.out')}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        <div className="flex flex-col gap-3 border-t border-sf-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">{t('catalog.fbt.total')}</span>
              <span className="font-heading text-2xl font-extrabold text-sf-heading" data-testid="fbt-total">
                {format.price(total)}
              </span>
              <span className="text-sm">({t('common.items', { count: ticked.length })})</span>
            </p>
            <p className="text-xs">{t('catalog.fbt.totalNote')}</p>
          </div>
          {/* Not disabled while adding (a disabled button would lose focus). */}
          <button
            type="button"
            className={cn(primaryButtonClass, 'w-full sm:w-auto')}
            aria-disabled={busy || undefined}
            onClick={(event) => void addAll(ticked.map((line) => ({ name: line.name, variantId: line.variantId! })), event.currentTarget)}
            data-testid="fbt-add"
          >
            {busy ? <Loader2Icon aria-hidden className="size-4 animate-spin" /> : <ShoppingCartIcon aria-hidden className="size-4" />}
            {busy ? t('catalog.fbt.adding') : t('catalog.fbt.add')}
          </button>
        </div>
        <AddSeveralStatus
          result={result}
          testId="fbt-status"
          messages={{
            chooseOne: t('catalog.fbt.chooseOne'),
            added: (count) => t('catalog.fbt.added', { count }),
            partial: (added, count) => t('catalog.fbt.partial', { added, count }),
            none: t('catalog.fbt.none'),
          }}
        />
      </div>
    </section>
  )
}
