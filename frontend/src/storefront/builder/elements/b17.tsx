import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { BanknoteIcon, CalendarDaysIcon, CircleCheckIcon, ClockIcon, CreditCardIcon, GiftIcon, LandmarkIcon, SmartphoneIcon, TruckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStorefront } from '../../api'
import { useLocale } from '../../i18n/locale'
import { formatShortPrice } from '../../money'
import { DraftPlaceholder, PreviewMark } from '../preview-mark'
import type { RenderElement } from '../types'
import { B17_ENUMS, B17_LIMITS, B17_TEXT_LIMITS, boundedInt, oneOf } from '../validate'
import { deliverySummary, isFree, paymentBadges, type DeliveryLine, type DeliverySummary, type PaymentBadge } from './b17-lines'
import { isB17Type, type B17Type } from './b17-types'
import { useB8aData } from './b8a-shared'
import { formatBengali, formatGregorian, formatHijri, formatSeason, formatWeekday, isoDate, toBengali, toHijri, zonedDate, type CalendarLanguage } from './bangla-calendar'
import { isBanglaDateData, isDeliveryPromiseData, isPaymentBadgesData } from './guards'
import { isOrnamentName, REPEATABLE_ORNAMENTS } from './ornament-names'
import { OrnamentArt } from './ornaments'
import { JUSTIFY, str, type El } from './shared'

/*
 * Renderers of the B17 elements (contract §1): a decorative ornament, the ways to pay, the
 * delivery promise and today's date in the Bangla calendar. Each draws its root with
 * `data-b={id}`. Payment badges and the delivery promise come from `data[id]` (dropped for
 * visitors when empty, marked in drafts); the Bangla date is computed in the browser in the store's
 * time zone, so a cached page never shows yesterday.
 */

const TEXT_ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const

const FLIPS = { none: undefined, horizontal: 'scaleX(-1)', vertical: 'scaleY(-1)', both: 'scale(-1, -1)' } as const

/** A decorative drawing (always hidden from assistive technology). */
export function OrnamentElement({ element }: { element: El<'ornament'> }) {
  const p = element.props ?? {}
  if (!isOrnamentName(p.name)) return <DraftPlaceholder element={element} />
  const size = boundedInt(p.size, B17_LIMITS.ornamentSize.min, B17_LIMITS.ornamentSize.max, 96)
  const align = oneOf(p.align, B17_ENUMS.align) ?? 'center'
  const flip = oneOf(p.flip, B17_ENUMS.ornamentFlip) ?? 'none'
  const opacity = boundedInt(p.opacity, B17_LIMITS.ornamentOpacity.min, B17_LIMITS.ornamentOpacity.max, 100) / 100
  const repeat = p.repeat === true && REPEATABLE_ORNAMENTS.includes(p.name)
  const style: CSSProperties = { opacity: opacity < 1 ? opacity : undefined, transform: FLIPS[flip] }

  return (
    <div data-b={element.id} aria-hidden className={cn('b-ornament pointer-events-none flex w-full', JUSTIFY[align])} data-testid="builder-ornament" data-name={p.name}>
      <OrnamentArt name={p.name} color={str(p.color) || null} secondary={typeof p.secondary_color === 'string' ? p.secondary_color : null} size={size} repeat={repeat} style={style} />
    </div>
  )
}

/* -------------------------------------------------------------------------------------------- */

function PaymentIcon({ badge }: { badge: PaymentBadge }) {
  const Icon = badge.kind === 'wallet' ? SmartphoneIcon : badge.code === 'cod' ? BanknoteIcon : badge.code === 'bank_transfer' ? LandmarkIcon : CreditCardIcon
  return <Icon aria-hidden className="size-4 shrink-0" />
}

/** "How you can pay": the store's checkout methods and the mobile wallets it takes, as plain text badges (no brand logos). */
export function PaymentBadgesElement({ element }: { element: El<'payment_badges'> }) {
  const { t, locale } = useLocale()
  const { data, state, draft } = useB8aData(element.id, isPaymentBadgesData)
  const titleId = useId()
  const p = element.props ?? {}
  const badges = paymentBadges(p, data, locale === 'bn' ? 'bn' : 'en')
  if (state && !draft) return null
  if (badges.length === 0) return <DraftPlaceholder element={element} state={state ?? 'empty'} />
  const title = str(p.title).slice(0, B17_TEXT_LIMITS.payment_badges.title).trim()
  const note = str(p.note).slice(0, B17_TEXT_LIMITS.payment_badges.note).trim()
  const align = oneOf(p.align, B17_ENUMS.align) ?? 'left'
  const list = oneOf(p.style, B17_ENUMS.paymentStyle) === 'list'

  return (
    <PreviewMark state={state}>
      <section
        data-b={element.id}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : t('content.builder.pay.label')}
        className={cn('b-payment-badges flex flex-col gap-3', TEXT_ALIGN[align])}
        data-style={list ? 'list' : 'chips'}
        data-testid="builder-payment-badges"
      >
        {title && (
          <h2 id={titleId} className="font-heading text-xl font-extrabold text-sf-heading">
            {title}
          </h2>
        )}
        <ul className={cn(list ? 'flex flex-col gap-2' : cn('flex flex-wrap gap-2', JUSTIFY[align]))}>
          {badges.map((badge) => (
            <li
              key={`${badge.kind}-${badge.code}`}
              data-kind={badge.kind}
              data-code={badge.code}
              className={cn(
                'inline-flex items-center gap-2 text-sm font-semibold text-sf-heading',
                list ? (align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : '') : 'rounded-full border bg-sf-surface px-3 py-1.5',
              )}
            >
              <PaymentIcon badge={badge} />
              <span>{badge.name}</span>
              {badge.kind === 'wallet' &&
                (list ? <span className="font-normal text-sf-text">· {t('content.builder.pay.wallet')}</span> : <span className="sr-only"> ({t('content.builder.pay.wallet')})</span>)}
            </li>
          ))}
        </ul>
        {note && <p className="text-sm whitespace-pre-line">{note}</p>}
      </section>
    </PreviewMark>
  )
}

/* -------------------------------------------------------------------------------------------- */

function useDeliveryText() {
  const { t } = useLocale()
  const { currency } = useStorefront().store
  const amount = (value: string) => formatShortPrice(value, currency)
  return {
    days: (line: DeliveryLine) => (line.min === line.max ? t('content.builder.delivery.days', { count: line.min }) : t('content.builder.delivery.dayRange', { min: line.min, max: line.max })),
    price: (line: DeliveryLine): string | null =>
      line.fee !== null ? (isFree(line.fee) ? t('content.builder.delivery.free') : amount(line.fee)) : line.from !== null ? t('content.builder.delivery.from', { amount: amount(line.from) }) : null,
    freeOver: (value: string) => t('content.builder.delivery.freeOver', { amount: amount(value) }),
    zoneFreeOver: (value: string) => t('content.builder.delivery.zoneFreeOver', { amount: amount(value) }),
    cod: t('content.builder.delivery.cod'),
    codEverywhere: t('content.builder.delivery.codEverywhere'),
  }
}

/** The store-wide promises under the zones: cash on delivery everywhere, free delivery over an amount. */
function Promises({ summary, className }: { summary: DeliverySummary; className?: string }) {
  const text = useDeliveryText()
  if (!summary.codEverywhere && !summary.freeOver) return null
  return (
    <ul className={cn('flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-sf-heading', className)} data-testid="delivery-promises">
      {summary.codEverywhere && (
        <li className="inline-flex items-center gap-2">
          <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-sf-accent" />
          {text.codEverywhere}
        </li>
      )}
      {summary.freeOver && (
        <li className="inline-flex items-center gap-2">
          <GiftIcon aria-hidden className="size-4 shrink-0 text-sf-accent" />
          {text.freeOver(summary.freeOver)}
        </li>
      )}
    </ul>
  )
}

/** One zone in a sentence: "Inside Dhaka · 1–2 days · ৳60 · Cash on delivery". */
function lineParts(line: DeliveryLine, text: ReturnType<typeof useDeliveryText>): string[] {
  const price = text.price(line)
  return [text.days(line), ...(price ? [price] : []), ...(line.cod ? [text.cod] : []), ...(line.freeOver ? [text.zoneFreeOver(line.freeOver)] : [])]
}

function ZoneCard({ line }: { line: DeliveryLine }) {
  const text = useDeliveryText()
  const price = text.price(line)
  return (
    <li className="flex flex-col gap-2 rounded-sf-card border bg-sf-surface p-4 text-sf-text" data-zone={line.id}>
      <div className="flex flex-col">
        <span className="font-bold text-sf-heading">{line.name}</span>
        {line.method && <span className="text-sm">{line.method}</span>}
      </div>
      <span className="inline-flex items-center gap-2 text-sm">
        <ClockIcon aria-hidden className="size-4 shrink-0 text-sf-accent" />
        {text.days(line)}
      </span>
      {price && (
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-sf-heading">
          <TruckIcon aria-hidden className="size-4 shrink-0 text-sf-accent" />
          {price}
        </span>
      )}
      {(line.cod || line.freeOver) && (
        <span className="text-sm">{[...(line.cod ? [text.cod] : []), ...(line.freeOver ? [text.zoneFreeOver(line.freeOver)] : [])].join(' · ')}</span>
      )}
    </li>
  )
}

/** Delivery times and charges per zone (from the store's shipping settings), with cash on delivery and free delivery. */
export function DeliveryPromiseElement({ element }: { element: El<'delivery_promise'> }) {
  const { t } = useLocale()
  const text = useDeliveryText()
  const { data, state, draft } = useB8aData(element.id, isDeliveryPromiseData)
  const titleId = useId()
  const p = element.props ?? {}
  const summary = data ? deliverySummary(p, data) : null
  if (state && !draft) return null
  if (!summary) return <DraftPlaceholder element={element} state={state ?? 'empty'} />
  const title = str(p.title).slice(0, B17_TEXT_LIMITS.delivery_promise.title).trim()
  const layout = oneOf(p.layout, B17_ENUMS.deliveryLayout) ?? 'cards'

  return (
    <PreviewMark state={state}>
      <section
        data-b={element.id}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : t('content.builder.delivery.label')}
        className="b-delivery-promise flex flex-col gap-4"
        data-layout={layout}
        data-testid="builder-delivery-promise"
      >
        {title && (
          <h2 id={titleId} className={cn('font-heading font-extrabold text-sf-heading', layout === 'bar' ? 'sr-only' : 'text-xl')}>
            {title}
          </h2>
        )}
        {layout === 'cards' && (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {summary.lines.map((line) => (
                <ZoneCard key={line.id} line={line} />
              ))}
            </ul>
            <Promises summary={summary} />
          </>
        )}
        {layout === 'list' && (
          <>
            <ul className="flex flex-col divide-y rounded-sf-card border bg-sf-surface text-sf-text">
              {summary.lines.map((line) => (
                <li key={line.id} data-zone={line.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
                  <span className="font-bold text-sf-heading">
                    {line.name}
                    {line.method && <span className="ml-2 text-sm font-normal text-sf-text">{line.method}</span>}
                  </span>
                  <span className="text-sm">{lineParts(line, text).join(' · ')}</span>
                </li>
              ))}
            </ul>
            <Promises summary={summary} />
          </>
        )}
        {layout === 'bar' && (
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded-sf-card bg-sf-surface px-4 py-3 text-center text-sm text-sf-text">
            <TruckIcon aria-hidden className="size-5 shrink-0 text-sf-accent" />
            <ul className="contents">
              {summary.lines.map((line) => (
                <li key={line.id} data-zone={line.id}>
                  <span className="font-bold text-sf-heading">{line.name}</span> · {lineParts(line, text).join(' · ')}
                </li>
              ))}
            </ul>
            <Promises summary={summary} className="justify-center" />
          </div>
        )}
      </section>
    </PreviewMark>
  )
}

/* -------------------------------------------------------------------------------------------- */

/** Now, refreshed every minute (so the date turns at midnight on an open page). */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const date = new Date()
      setNow((previous) => (previous.getTime() === date.getTime() ? previous : date))
      timer = setTimeout(tick, 60_000 - (date.getTime() % 60_000) + 50)
    }
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50)
    return () => clearTimeout(timer)
  }, [])
  return now
}

const ALIGN_FLEX = { left: 'items-start text-left', center: 'items-center text-center', right: 'items-end text-right' } as const

/**
 * Today in the Bangladesh revised Bengali calendar ("১ বৈশাখ ১৪৩৪, বুধবার"), optionally with the
 * Gregorian and the (expected) Hijri date. Bangla script and Bengali digits on the Bangla
 * storefront; the usual English spelling on the English one.
 */
export function BanglaDateElement({ element }: { element: El<'bangla_date'> }) {
  const { t, locale } = useLocale()
  const { data, state, draft } = useB8aData(element.id, isBanglaDateData)
  const now = useNow()
  if (state && !draft) return null
  const p = element.props ?? {}
  const language: CalendarLanguage = locale === 'bn' ? 'bn' : 'en'
  const today = zonedDate(now, data?.timezone || 'Asia/Dhaka')
  const bengali = toBengali(today)
  const prefix = str(p.prefix).slice(0, B17_TEXT_LIMITS.bangla_date.prefix).trim()
  const style = oneOf(p.style, B17_ENUMS.banglaDateStyle) ?? 'plain'
  const align = oneOf(p.align, B17_ENUMS.align) ?? 'left'
  const main = `${formatBengali(bengali, language)}, ${formatWeekday(bengali.weekday, language)}`
  const gregorian = p.show_gregorian === true ? formatGregorian(today, language) : null
  const hijri = p.show_hijri === true ? t('content.builder.banglaDate.expected', { date: formatHijri(toHijri(today), language) }) : null
  const note = t('content.builder.banglaDate.hijriNote')
  const iso = isoDate(today)

  let body: ReactNode
  if (style === 'card') {
    body = (
      <div className={cn('flex flex-col gap-2 rounded-sf-card border bg-sf-surface p-4 text-sf-text', ALIGN_FLEX[align])}>
        <span className="text-xs font-semibold tracking-wide text-sf-text uppercase">
          {prefix || t('content.builder.banglaDate.label')} · {formatSeason(bengali.season, language)}
        </span>
        <time dateTime={iso} className="font-heading text-2xl font-extrabold text-sf-heading" data-testid="bangla-date-main">
          {main}
        </time>
        {(gregorian || hijri) && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-left text-sm">
            {gregorian && (
              <>
                <dt className="font-semibold">{t('content.builder.banglaDate.gregorian')}</dt>
                <dd data-testid="bangla-date-gregorian">{gregorian}</dd>
              </>
            )}
            {hijri && (
              <>
                <dt className="font-semibold">{t('content.builder.banglaDate.hijri')}</dt>
                <dd data-testid="bangla-date-hijri">{hijri}</dd>
              </>
            )}
          </dl>
        )}
        {hijri && <p className="text-xs">{note}</p>}
      </div>
    )
  } else {
    const parts = (
      <>
        {prefix && <span className="font-semibold">{prefix} </span>}
        <time dateTime={iso} data-testid="bangla-date-main">
          {main}
        </time>
        {gregorian && (
          <>
            <span aria-hidden> · </span>
            <span data-testid="bangla-date-gregorian">{gregorian}</span>
          </>
        )}
        {hijri && (
          <>
            <span aria-hidden> · </span>
            <span data-testid="bangla-date-hijri" title={note}>
              {hijri}
            </span>
          </>
        )}
      </>
    )
    body =
      style === 'badge' ? (
        <p className="inline-flex flex-wrap items-center gap-x-1 rounded-full bg-sf-accent px-3 py-1 text-sm font-semibold text-sf-accent-foreground">
          <CalendarDaysIcon aria-hidden className="mr-1 size-4 shrink-0" />
          {parts}
        </p>
      ) : (
        // Plain inherits the surrounding text colour (festival heroes put it in white on a coloured ground).
        <p>{parts}</p>
      )
  }

  return (
    <PreviewMark state={state}>
      <div data-b={element.id} className={cn('b-bangla-date flex flex-col', ALIGN_FLEX[align])} data-style={style} data-testid="builder-bangla-date">
        {body}
      </div>
    </PreviewMark>
  )
}

/* -------------------------------------------------------------------------------------------- */

const RENDERERS: { [T in B17Type]: (props: { element: Extract<RenderElement, { type: T }> }) => ReactNode } = {
  ornament: OrnamentElement,
  payment_badges: PaymentBadgesElement,
  delivery_promise: DeliveryPromiseElement,
  bangla_date: BanglaDateElement,
}

/** One B17 element (the caller has checked its visibility). */
export function B17ElementContent({ element }: { element: RenderElement }) {
  if (!isB17Type(element.type)) return null
  const Render = RENDERERS[element.type] as (props: { element: RenderElement }) => ReactNode
  return <Render element={element} />
}
