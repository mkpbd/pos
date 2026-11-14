import { useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Link } from 'react-router'
import { CheckIcon, ChevronsLeftRightIcon, ChevronsUpDownIcon, Loader2Icon, MinusIcon, ShoppingCartIcon, XIcon, ZapIcon } from 'lucide-react'
import { sumDecimals } from '@/lib/money'
import { cn } from '@/lib/utils'
import { CardCartAction } from '../../cart/add-to-cart'
import { currentPrice, startVariant, useAddSeveral } from '../../cart/add-several'
import { AddSeveralStatus } from '../../cart/add-several-status'
import { CardPrice } from '../../catalog/card-parts'
import { useCardPricing } from '../../catalog/card-pricing'
import { Price } from '../../catalog/price'
import { ProductCard } from '../../catalog/product-card'
import { ProductImage } from '../../catalog/product-image'
import { MenuLink } from '../../components/menu-link'
import { useLocale } from '../../i18n/locale'
import { usePriceFormat } from '../../money'
import { Countdown } from '../../promotions/countdown-timer'
import { useDeadline } from '../../promotions/countdown'
import type { ProductCard as Card, ProductDetail } from '../../types'
import { DraftPlaceholder, PreviewMark } from '../preview-mark'
import { MARK_LABELS, type MarkState } from '../render-context'
import type { BundleData, ComparisonCellKind, FlashSaleBarData } from '../types'
import { B8A_ENUMS, B8A_LIMITS, B8A_TEXT_LIMITS, boundedInt, isMoneyString, isUuid, listItems, oneOf, safeUrl } from '../validate'
import { BuilderImg } from './b8a-img'
import { stateMap, useB8aData, useMedia } from './b8a-shared'
import { isBundleData, isComparisonTableData, isFlashSaleBarData } from './guards'
import { isObject, PRIMARY_BUTTON, SECONDARY_BUTTON, str, type El } from './shared'

/*
 * B8a selling blocks (contract §1): pricing table, before / after slider, comparison table, flash
 * sale bar and bundle. Prices of products always come from the server's data; plan prices are the
 * owner's own NUMERIC strings, formatted with the store's money formatter. Nothing is computed for
 * the cart here: the bundle's total is informational and the cart reprices every line.
 */

/** A `{label, url}` button with a safe url, else null. */
function buttonOf(value: unknown, max: number): { label: string; url: string } | null {
  if (!isObject(value)) return null
  const label = str(value.label).slice(0, max).trim()
  const url = safeUrl(value.url)
  return label && url ? { label, url } : null
}

/* -------------------------------------------------------------------------------------------- */

const PLAN_GRID: Record<number, string> = {
  1: 'mx-auto max-w-md',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-2 lg:grid-cols-4',
}

/**
 * Plans side by side (stacked on phones, the highlighted plan first). Each feature shows an icon
 * and says "Included" / "Not included" to screen readers — never colour alone.
 */
export function PricingTableElement({ element }: { element: El<'pricing_table'> }) {
  const { t } = useLocale()
  const format = usePriceFormat()
  const L = B8A_TEXT_LIMITS.pricing_table
  const plans = listItems(element.props?.plans, B8A_LIMITS.plans.max)
    .map((plan) => ({
      id: plan.id as string,
      name: str(plan.name).slice(0, L['plans.*.name']).trim(),
      price: isMoneyString(plan.price) ? format.price(plan.price) : str(plan.price_text).slice(0, L['plans.*.price_text']).trim(),
      period: str(plan.period).slice(0, L['plans.*.period']).trim(),
      description: str(plan.description).slice(0, L['plans.*.description']).trim(),
      features: listItems(plan.features, B8A_LIMITS.planFeatures.max)
        .map((feature) => ({ id: feature.id as string, text: str(feature.text).slice(0, L['plans.*.features.*.text']).trim(), included: feature.included !== false }))
        .filter((feature) => feature.text !== ''),
      button: buttonOf(plan.button, L['plans.*.button.label']),
      highlighted: plan.highlighted === true,
      badge: str(plan.badge).slice(0, L['plans.*.badge']).trim(),
    }))
    .filter((plan) => plan.name !== '')
  if (plans.length === 0) return <DraftPlaceholder element={element} />

  return (
    <ul data-b={element.id} aria-label={t('content.builder.pricing.label')} className={cn('b-pricing grid items-stretch gap-6', PLAN_GRID[plans.length])} data-testid="builder-pricing">
      {plans.map((plan) => (
        <li key={plan.id} className={cn('flex', plan.highlighted && 'order-first md:order-0')}>
          <PlanCard plan={plan} />
        </li>
      ))}
    </ul>
  )
}

type Plan = {
  id: string
  name: string
  price: string
  period: string
  description: string
  features: { id: string; text: string; included: boolean }[]
  button: { label: string; url: string } | null
  highlighted: boolean
  badge: string
}

function PlanCard({ plan }: { plan: Plan }) {
  const { t } = useLocale()
  const nameId = useId()
  return (
    <article
      aria-labelledby={nameId}
      data-highlighted={plan.highlighted || undefined}
      data-testid="pricing-plan"
      className={cn('flex w-full flex-col gap-4 rounded-sf-card border bg-sf-surface p-6', plan.highlighted && 'border-2 border-sf-accent shadow-lg')}
    >
      {plan.badge && <p className="self-start rounded-full bg-sf-accent px-3 py-1 text-xs font-bold tracking-wide text-sf-accent-foreground uppercase">{plan.badge}</p>}
      <h3 id={nameId} className="font-heading text-xl font-extrabold text-sf-heading">
        {plan.name}
      </h3>
      {(plan.price || plan.period) && (
        <p className="flex flex-wrap items-baseline gap-x-1.5" data-testid="pricing-price">
          {plan.price && <span className="font-heading text-4xl font-extrabold text-sf-heading">{plan.price}</span>}
          {plan.period && <span className="text-sm font-medium">{plan.period}</span>}
        </p>
      )}
      {plan.description && <p className="text-sm">{plan.description}</p>}
      {plan.features.length > 0 && (
        <ul className="flex flex-col gap-2.5 text-sm">
          {plan.features.map((feature) => (
            <li key={feature.id} className="flex items-start gap-2" data-included={feature.included}>
              {feature.included ? (
                <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-sf-heading" strokeWidth={3} />
              ) : (
                <XIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-sf-text" strokeWidth={2.5} />
              )}
              <span>
                <span className="sr-only">{feature.included ? t('content.builder.pricing.included') : t('content.builder.pricing.excluded')}: </span>
                {feature.text}
              </span>
            </li>
          ))}
        </ul>
      )}
      {plan.button && (
        <MenuLink url={plan.button.url} className={cn(plan.highlighted ? PRIMARY_BUTTON : SECONDARY_BUTTON, 'mt-auto w-full')}>
          {plan.button.label}
        </MenuLink>
      )}
    </article>
  )
}

/* -------------------------------------------------------------------------------------------- */

const BA_ASPECTS = { '1:1': '1 / 1', '4:3': '4 / 3', '3:2': '3 / 2', '16:9': '16 / 9' } as const

/** Two photos of the same scene, one over the other, with a handle to reveal more of either. */
export function BeforeAfterElement({ element }: { element: El<'before_after'> }) {
  const start = boundedInt(element.props?.start, B8A_LIMITS.beforeAfterStart.min, B8A_LIMITS.beforeAfterStart.max, 50)
  // Remounts when the owner moves the start position (the canvas), so the handle follows it.
  return <BeforeAfterBody key={start} element={element} start={start} />
}

function BeforeAfterBody({ element, start }: { element: El<'before_after'>; start: number }) {
  const { t, formatNumber } = useLocale()
  const p = element.props ?? {}
  const L = B8A_TEXT_LIMITS.before_after
  const beforeSide: Record<string, unknown> = isObject(p.before) ? p.before : {}
  const afterSide: Record<string, unknown> = isObject(p.after) ? p.after : {}
  const before = useMedia(beforeSide.media_id)
  const after = useMedia(afterSide.media_id)
  const vertical = oneOf(p.orientation, B8A_ENUMS.beforeAfterOrientation) === 'vertical'
  const aspect = BA_ASPECTS[oneOf(p.aspect, B8A_ENUMS.beforeAfterAspect) ?? '4:3']
  const beforeLabel = str(p.before_label).slice(0, L.before_label).trim()
  const afterLabel = str(p.after_label).slice(0, L.after_label).trim()
  const [position, setPosition] = useState(start)
  const frameRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  if (!before || !after) return <DraftPlaceholder element={element} />

  const beforeAlt = str(beforeSide.alt).slice(0, L['before.alt']).trim()
  const afterAlt = str(afterSide.alt).slice(0, L['after.alt']).trim()
  const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)))

  const follow = (event: ReactPointerEvent) => {
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return
    setPosition(clamp(vertical ? ((event.clientY - rect.top) / rect.height) * 100 : ((event.clientX - rect.left) / rect.width) * 100))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // No text selection or focus move from the mouse press: the focus goes to the handle.
    if (event.pointerType === 'mouse') event.preventDefault()
    dragging.current = true
    event.currentTarget.setPointerCapture?.(event.pointerId)
    follow(event)
    handleRef.current?.focus({ preventScroll: true })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const steps: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }
    let next: number | null = null
    if (event.key in steps) next = position + steps[event.key]!
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = 100
    if (next === null) return
    event.preventDefault()
    setPosition(clamp(next))
  }

  const name = t('content.builder.beforeAfter.slider', { before: beforeLabel || beforeAlt || '1', after: afterLabel || afterAlt || '2' })
  const valueText = t('content.builder.beforeAfter.value', { value: formatNumber(position), before: beforeLabel })
  const sizes = '(max-width: 1023px) 100vw, 60vw'
  const chip = 'pointer-events-none absolute rounded-full bg-neutral-900/80 px-3 py-1 text-xs font-bold tracking-wide text-white uppercase'

  return (
    <div data-b={element.id} className="b-before-after" data-orientation={vertical ? 'vertical' : 'horizontal'} data-testid="builder-before-after">
      <div
        ref={frameRef}
        className="relative overflow-hidden rounded-sf-card bg-sf-surface select-none"
        style={{ aspectRatio: aspect, touchAction: vertical ? 'pan-x' : 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={(event) => dragging.current && follow(event)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        data-testid="before-after-frame"
      >
        <BuilderImg media={after} alt={afterAlt} sizes={sizes} className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0" style={{ clipPath: vertical ? `inset(0 0 ${100 - position}% 0)` : `inset(0 ${100 - position}% 0 0)` }} data-testid="before-layer">
          <BuilderImg media={before} alt={beforeAlt} sizes={sizes} className="absolute inset-0 size-full object-cover" />
        </div>
        {beforeLabel && (
          <span aria-hidden className={cn(chip, 'top-3 left-3')}>
            {beforeLabel}
          </span>
        )}
        {afterLabel && (
          <span aria-hidden className={cn(chip, vertical ? 'bottom-3 left-3' : 'top-3 right-3')}>
            {afterLabel}
          </span>
        )}
        <span aria-hidden className={cn('pointer-events-none absolute bg-white shadow', vertical ? 'inset-x-0 h-0.5 -translate-y-1/2' : 'inset-y-0 w-0.5 -translate-x-1/2')} style={vertical ? { top: `${position}%` } : { left: `${position}%` }} />
        <div
          ref={handleRef}
          role="slider"
          tabIndex={0}
          aria-label={name}
          aria-orientation={vertical ? 'vertical' : 'horizontal'}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={position}
          aria-valuetext={valueText}
          onKeyDown={onKeyDown}
          className="absolute grid size-11 -translate-x-1/2 -translate-y-1/2 cursor-grab place-items-center rounded-full border-2 border-neutral-900 bg-white text-neutral-900 shadow-lg focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-sf-accent active:cursor-grabbing"
          style={vertical ? { top: `${position}%`, left: '50%' } : { left: `${position}%`, top: '50%' }}
          data-testid="before-after-handle"
        >
          {vertical ? <ChevronsUpDownIcon aria-hidden className="size-5" /> : <ChevronsLeftRightIcon aria-hidden className="size-5" />}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------------------------- */

type Cell = { kind: ComparisonCellKind; text: string }

function cellOf(value: unknown, max: number): Cell {
  if (!isObject(value)) return { kind: 'no', text: '' }
  return { kind: oneOf(value.kind, B8A_ENUMS.comparisonCell) ?? 'no', text: str(value.text).slice(0, max).trim() }
}

/**
 * A real table: features in rows (row headers), options in columns (column headers). Product
 * columns show the product's price and buy button while it is on sale. Wide tables scroll inside
 * their own focusable region with the feature column kept in view.
 */
export function ComparisonTableElement({ element }: { element: El<'comparison_table'> }) {
  const { t } = useLocale()
  const { data, state, draft } = useB8aData(element.id, isComparisonTableData)
  const p = element.props ?? {}
  const L = B8A_TEXT_LIMITS.comparison_table
  const products: Record<string, Card> = data && isObject(data.products) ? (data.products as Record<string, Card>) : {}
  const columnStates = stateMap(data?.columns)
  const columns = listItems(p.columns, B8A_LIMITS.comparisonColumns.max).map((column) => {
    const productId = isUuid(column.product_id) ? column.product_id : null
    return {
      id: column.id as string,
      title: str(column.title).slice(0, L['columns.*.title']).trim(),
      product: productId && Object.hasOwn(products, productId) ? products[productId]! : null,
      state: draft ? (columnStates[column.id as string] ?? null) : null,
      highlighted: column.highlighted === true,
    }
  })
  const rows = listItems(p.rows, B8A_LIMITS.comparisonRows.max)
    .map((row) => {
      const cells = isObject(row.cells) ? row.cells : {}
      return { id: row.id as string, label: str(row.label).slice(0, L['rows.*.label']).trim(), cells: columns.map((column) => cellOf(cells[column.id], L['rows.*.cells.*.text'])) }
    })
    .filter((row) => row.label !== '')
  if (state && !draft) return null
  if (columns.length < B8A_LIMITS.comparisonColumns.min || rows.length === 0) return <DraftPlaceholder element={element} />
  const showPrices = p.show_prices !== false
  const showButtons = p.show_buttons !== false
  const label = t('content.builder.comparison.label')
  const sticky = 'sticky left-0 z-10 bg-sf-surface'

  return (
    <PreviewMark state={state}>
      <div data-b={element.id} className="b-comparison" data-testid="builder-comparison">
        {/* A focusable region, so keyboard users can scroll a table wider than the screen. */}
        <div role="region" aria-label={label} tabIndex={0} className="overflow-x-auto rounded-sf-card border bg-sf-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{label}</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className={cn(sticky, 'min-w-28 p-3 text-left align-bottom')}>
                  <span className="sr-only">{t('content.builder.comparison.feature')}</span>
                </th>
                {columns.map((column) => (
                  <th key={column.id} scope="col" className={cn('min-w-32 p-3 text-center align-bottom', column.highlighted && 'bg-sf-canvas')} data-highlighted={column.highlighted || undefined} data-column-state={column.state ?? undefined}>
                    <ColumnHead title={column.title} product={column.product} state={column.state} showPrice={showPrices} showButton={showButtons} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b last:border-b-0">
                  <th scope="row" className={cn(sticky, 'p-3 text-left font-semibold text-sf-heading')}>
                    {row.label}
                  </th>
                  {row.cells.map((cell, i) => (
                    <td key={columns[i]!.id} className={cn('p-3 text-center', columns[i]!.highlighted && 'bg-sf-canvas')}>
                      <CellContent cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PreviewMark>
  )
}

function ColumnHead({ title, product, state, showPrice, showButton }: { title: string; product: Card | null; state: MarkState | null; showPrice: boolean; showButton: boolean }) {
  const { t } = useLocale()
  return (
    <div className="flex flex-col items-center gap-2 font-normal">
      {product && <ProductImage image={product.image} alt="" className="size-16 rounded-md" />}
      <span className="font-heading text-base font-bold text-sf-heading">
        {product ? (
          <Link to={safeUrl(product.url) ?? '/shop'} className="hover:underline">
            {title}
          </Link>
        ) : (
          title
        )}
      </span>
      {state && <span className="rounded bg-neutral-900 px-2 py-0.5 text-xs font-semibold text-white">{t(MARK_LABELS[state])}</span>}
      {product && showPrice && <ProductPrice product={product} />}
      {product && showButton && (
        <div className="w-full max-w-40">
          <CardCartAction product={product} />
        </div>
      )}
    </div>
  )
}

function ProductPrice({ product }: { product: Card }) {
  const pricing = useCardPricing(product)
  return <CardPrice product={product} pricing={pricing} />
}

function CellContent({ cell }: { cell: Cell }) {
  const { t } = useLocale()
  if (cell.kind === 'text') return <span>{cell.text}</span>
  const yes = cell.kind === 'yes'
  return (
    <span className="inline-flex items-center justify-center gap-1.5" data-cell={cell.kind}>
      {yes ? <CheckIcon aria-hidden className="size-5 text-sf-heading" strokeWidth={3} /> : <MinusIcon aria-hidden className="size-5 text-sf-text" strokeWidth={2.5} />}
      <span className={cell.text ? undefined : 'sr-only'}>
        {cell.text ? (
          <>
            <span className="sr-only">{yes ? t('content.builder.comparison.yes') : t('content.builder.comparison.no')}: </span>
            {cell.text}
          </>
        ) : yes ? (
          t('content.builder.comparison.yes')
        ) : (
          t('content.builder.comparison.no')
        )}
      </span>
    </span>
  )
}

/* -------------------------------------------------------------------------------------------- */

/**
 * A running countdown promotion: its name (or the owner's title), the time left, how much of a
 * limited promotion is claimed (only when it really has a usage limit) and some of its products.
 */
export function FlashSaleBarElement({ element }: { element: El<'flash_sale_bar'> }) {
  const { data, state: dataState, draft } = useB8aData(element.id, isFlashSaleBarData)
  if (!data) return <DraftPlaceholder element={element} />
  const promotionState = data.promotion.state
  const state = dataState ?? (promotionState && promotionState in MARK_LABELS ? (promotionState as MarkState) : null)
  if (state && !draft) return null
  return (
    <PreviewMark state={state}>
      <FlashSaleBody element={element} data={data} draft={draft} marked={state !== null} />
    </PreviewMark>
  )
}

function FlashSaleBody({ element, data, draft, marked }: { element: El<'flash_sale_bar'>; data: FlashSaleBarData; draft: boolean; marked: boolean }) {
  const { t } = useLocale()
  const p = element.props ?? {}
  const L = B8A_TEXT_LIMITS.flash_sale_bar
  const { expired } = useDeadline(data.promotion.ends_at)
  const titleId = useId()
  const claimedId = useId()
  const title = str(p.title).slice(0, L.title).trim() || data.promotion.name
  const text = str(p.text).slice(0, L.text).trim()
  const card = oneOf(p.style, B8A_ENUMS.flashSaleStyle) === 'card'
  const limit = boundedInt(p.product_limit, B8A_LIMITS.flashSaleProducts.min, B8A_LIMITS.flashSaleProducts.max, 4)
  const products = p.show_products !== false && Array.isArray(data.products) ? data.products.filter((product) => isObject(product) && typeof product.id === 'string').slice(0, limit) : []
  const button = buttonOf(p.button, L['button.label'])
  const claimed =
    isObject(data.claimed) && Number.isInteger(data.claimed.limit) && data.claimed.limit > 0 && Number.isInteger(data.claimed.used) && data.claimed.used >= 0
      ? { used: Math.min(data.claimed.used, data.claimed.limit), limit: data.claimed.limit }
      : null

  if (expired && !draft) return null
  const content = (
    <section
      data-b={element.id}
      aria-labelledby={titleId}
      className={cn('b-flash-sale flex flex-col gap-5 rounded-sf-card border-2 border-sf-sale bg-sf-surface p-5', card && 'items-center p-8 text-center')}
      data-style={card ? 'card' : 'bar'}
      data-testid="builder-flash-sale"
    >
      <div className={cn('flex flex-wrap items-center gap-x-6 gap-y-3', card ? 'flex-col' : 'justify-between')}>
        <div className={cn('flex min-w-0 flex-col gap-1', card && 'items-center')}>
          <h2 id={titleId} className="flex items-center gap-2 font-heading text-2xl font-extrabold text-sf-heading">
            <ZapIcon aria-hidden className="size-6 shrink-0 fill-current text-sf-sale" />
            {title}
          </h2>
          {text && <p className="max-w-xl">{text}</p>}
        </div>
        <Countdown endsAt={data.promotion.ends_at} variant={card ? 'large' : 'inline'} className={card ? 'items-center sm:items-center' : 'text-base'} />
        {claimed && (
          <div className="flex w-full max-w-64 flex-col gap-1.5" data-testid="flash-claimed">
            <p id={claimedId} className="text-sm font-semibold text-sf-heading">
              {t('content.builder.flash.claimed', claimed)}
            </p>
            <div
              role="progressbar"
              aria-label={t('content.builder.flash.claimedLabel')}
              aria-describedby={claimedId}
              aria-valuemin={0}
              aria-valuemax={claimed.limit}
              aria-valuenow={claimed.used}
              aria-valuetext={t('content.builder.flash.claimed', claimed)}
              className="h-2.5 overflow-hidden rounded-full bg-sf-border"
            >
              <div className="h-full rounded-full bg-sf-sale" style={{ width: `${(claimed.used / claimed.limit) * 100}%` }} />
            </div>
          </div>
        )}
        {button && (
          <MenuLink url={button.url} className={PRIMARY_BUTTON}>
            {button.label}
          </MenuLink>
        )}
      </div>
      {products.length > 0 && (
        <ul aria-label={t('content.builder.flash.products')} className="grid w-full grid-cols-2 gap-4 text-left md:grid-cols-4">
          {products.map((product) => (
            <li key={product.id}>
              <ProductCard product={product} countdown={false} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
  // A countdown that ran out while a draft was open: marked like the server's `expired`.
  return expired && !marked ? <PreviewMark state="expired">{content}</PreviewMark> : content
}

/* -------------------------------------------------------------------------------------------- */

/**
 * Products bought together: each with its option and a checkbox (on by default), the total of the
 * chosen items' current prices, and one button that adds them to the cart one after another. The
 * outcome is announced politely; a partial failure names what was not added and why.
 */
export function BundleElement({ element }: { element: El<'bundle'> }) {
  const { data, state, draft } = useB8aData(element.id, isBundleData)
  if (!data) return <DraftPlaceholder element={element} />
  if (state && !draft) return null
  return (
    <PreviewMark state={state}>
      <BundleBody element={element} data={data} draft={draft} />
    </PreviewMark>
  )
}

function BundleBody({ element, data, draft }: { element: El<'bundle'>; data: BundleData; draft: boolean }) {
  const { t } = useLocale()
  const format = usePriceFormat()
  const { busy, result, addAll } = useAddSeveral()
  const p = element.props ?? {}
  const L = B8A_TEXT_LIMITS.bundle
  const products: Record<string, ProductDetail> = isObject(data.products) ? (data.products as Record<string, ProductDetail>) : {}
  const itemStates = stateMap(data.items)
  const items = listItems(p.items, B8A_LIMITS.bundleItems.max).flatMap((item) => {
    const productId = item.product_id
    const product = isUuid(productId) && Object.hasOwn(products, productId) ? products[productId]! : null
    const state = itemStates[item.id as string] ?? null
    if (!product || !Array.isArray(product.variants) || (state && !draft)) return []
    return [{ id: item.id as string, product, state }]
  })
  const [excluded, setExcluded] = useState<Record<string, boolean>>({})
  const [chosenVariants, setChosenVariants] = useState<Record<string, string>>({})
  const titleId = useId()
  const base = useId()

  if (items.length < B8A_LIMITS.bundleItems.min) return <DraftPlaceholder element={element} state="unavailable" />

  const variantOf = (item: (typeof items)[number]) => item.product.variants.find((variant) => variant.id === chosenVariants[item.id]) ?? startVariant(item.product)
  const chosen = items.flatMap((item) => {
    const variant = variantOf(item)
    return !excluded[item.id] && !item.state && variant?.in_stock ? [{ item, variant }] : []
  })
  const total = sumDecimals(chosen.map(({ variant }) => currentPrice(variant)))
  const title = str(p.title).slice(0, L.title).trim()
  const text = str(p.text).slice(0, L.text).trim()
  const label = str(p.button_label).slice(0, L.button_label).trim() || t('content.builder.bundle.button')
  const addChosen = (button: HTMLElement) => addAll(chosen.map(({ item, variant }) => ({ name: item.product.name, variantId: variant.id })), button)

  return (
    <section data-b={element.id} aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : label} className="b-bundle flex flex-col gap-5" data-testid="builder-bundle">
      {(title || text) && (
        <div className="flex flex-col gap-1">
          {title && (
            <h2 id={titleId} className="font-heading text-2xl font-extrabold text-sf-heading">
              {title}
            </h2>
          )}
          {text && <p>{text}</p>}
        </div>
      )}
      <ul className="flex flex-col gap-3 md:flex-row md:items-stretch">
        {items.map((item, index) => {
          const variant = variantOf(item)
          const url = safeUrl(item.product.url) ?? '/shop'
          const selectId = `${base}-${item.id}`
          const card = (
            <div className="flex h-full flex-col gap-3 rounded-sf-card border bg-sf-surface p-4" data-testid="bundle-item">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={!excluded[item.id] && !item.state}
                  disabled={Boolean(item.state) || !variant?.in_stock}
                  onChange={(event) => setExcluded((current) => ({ ...current, [item.id]: !event.target.checked }))}
                  aria-label={t('content.builder.bundle.include', { name: item.product.name })}
                  className="mt-1 size-5 shrink-0 accent-sf-accent"
                />
                <ProductImage image={item.product.images[0] ?? null} alt="" className="size-16 shrink-0 rounded-md border" />
                <div className="flex min-w-0 flex-col gap-1">
                  <Link to={url} className="line-clamp-2 text-sm font-bold text-sf-heading hover:underline">
                    {item.product.name}
                  </Link>
                  {variant && <Price price={currentPrice(variant)} compareAt={variant.promo_price ? variant.price : variant.compare_at_price} size="sm" />}
                  {variant && !variant.in_stock && <p className="text-xs font-semibold">{t('content.builder.bundle.outOfStock')}</p>}
                </div>
              </div>
              {item.product.variants.length > 1 && (
                <div className="mt-auto">
                  <label htmlFor={selectId} className="sr-only">
                    {t('content.builder.bundle.option', { name: item.product.name })}
                  </label>
                  <select
                    id={selectId}
                    value={variant?.id ?? ''}
                    onChange={(event) => setChosenVariants((current) => ({ ...current, [item.id]: event.target.value }))}
                    className="h-10 w-full rounded-md border bg-sf-surface px-2 text-sm text-sf-heading"
                  >
                    {item.product.variants.map((option) => (
                      <option key={option.id} value={option.id} disabled={!option.in_stock}>
                        {option.in_stock ? option.name : `${option.name} — ${t('content.builder.bundle.outOfStock')}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )
          return (
            <li key={item.id} className="flex flex-col items-center gap-3 md:flex-1 md:flex-row md:items-stretch">
              {index > 0 && (
                <span className="grid size-8 shrink-0 place-items-center self-center rounded-full bg-sf-canvas font-heading text-xl font-extrabold text-sf-heading">
                  <span aria-hidden>+</span>
                  <span className="sr-only">{t('content.builder.bundle.plus')}</span>
                </span>
              )}
              <div className="w-full min-w-0 flex-1">{item.state ? <PreviewMark state={item.state}>{card}</PreviewMark> : card}</div>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-col gap-3 rounded-sf-card bg-sf-canvas p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-baseline gap-2">
            <span className="font-semibold">{t('content.builder.bundle.total')}</span>
            <span className="font-heading text-2xl font-extrabold text-sf-heading" data-testid="bundle-total">
              {format.price(total)}
            </span>
          </p>
          <p className="text-xs">{t('content.builder.bundle.totalNote')}</p>
        </div>
        {/* Not disabled while adding (a disabled button would lose focus). */}
        <button type="button" className={PRIMARY_BUTTON} aria-disabled={busy || undefined} onClick={(event) => void addChosen(event.currentTarget)} data-testid="bundle-add">
          {busy ? <Loader2Icon aria-hidden className="size-4 animate-spin" /> : <ShoppingCartIcon aria-hidden className="size-4" />}
          {busy ? t('content.builder.bundle.adding') : label}
        </button>
      </div>
      <AddSeveralStatus
        result={result}
        testId="bundle-status"
        messages={{
          chooseOne: t('content.builder.bundle.chooseOne'),
          added: (count) => t('content.builder.bundle.added', { count }),
          partial: (added, count) => t('content.builder.bundle.partial', { added, count }),
          none: t('content.builder.bundle.none'),
        }}
      />
    </section>
  )
}
