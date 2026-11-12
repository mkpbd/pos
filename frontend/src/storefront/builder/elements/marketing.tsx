import { useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { CopyIcon } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { useNewsletterMutation } from '../../api'
import { CardPrice } from '../../catalog/card-parts'
import { useCardPricing } from '../../catalog/card-pricing'
import { ProductImage } from '../../catalog/product-image'
import { MenuLink } from '../../components/menu-link'
import { storeFormError } from '../../form-errors'
import { useLocale } from '../../i18n/locale'
import { usePriceFormat } from '../../money'
import { useNotice } from '../../notices'
import { Countdown } from '../../promotions/countdown-timer'
import { useDeadline } from '../../promotions/countdown'
import { usePage } from '../render-context'
import { DraftPlaceholder, PreviewMark } from '../preview-mark'
import type { CountdownData, DiscountData, PromoCardData } from '../types'
import { isCountdownData, isDiscountData, isPromoCardData } from './guards'
import { B4_ENUMS, B4_LIMITS, oneOf, safeLink, safeUrl } from '../validate'
import { ALIGN_ITEMS, isObject, JUSTIFY, PRIMARY_BUTTON, SECONDARY_BUTTON, str, trimDecimalString, type El } from './shared'
import { WithData } from './with-data'

/* -------------------------------------------------------------------------------------------- */

/**
 * A countdown to a date or a countdown promotion's end (the hot deals countdown component). When
 * the time is up it shows `expired_text`, or nothing.
 */
export function CountdownElement({ element }: { element: El<'countdown'> }) {
  const p = element.props ?? {}
  // A countdown to a date needs no lookup: drawn from its own props until the payload's data arrives.
  const fallback: CountdownData | null = p.source === 'date' && typeof p.ends_at === 'string' && p.ends_at ? { ends_at: p.ends_at, promotion: null } : null
  const keepsText = str(p.expired_text) !== ''
  return (
    <WithData element={element} is={isCountdownData} fallback={fallback} shownWhen={(state) => state === 'expired' && keepsText}>
      {(data) => <CountdownBody element={element} data={data} />}
    </WithData>
  )
}

function CountdownBody({ element, data }: { element: El<'countdown'>; data: CountdownData }) {
  const { draft } = usePage()
  const p = element.props ?? {}
  const { expired } = useDeadline(data.ends_at)
  const style = oneOf(p.style, B4_ENUMS.countdownStyle) ?? 'boxes'
  const title = str(p.title) || data.title || data.promotion?.name || ''
  const expiredText = str(p.expired_text)

  if (!data.ends_at) return <DraftPlaceholder element={element} />
  if (expired) {
    if (expiredText) {
      return (
        <div data-b={element.id} className="b-countdown flex flex-col items-center gap-2 text-center" data-testid="builder-countdown" data-expired="true">
          {title && <p className="font-heading text-2xl font-extrabold text-sf-heading">{title}</p>}
          <p className="text-lg font-semibold">{expiredText}</p>
        </div>
      )
    }
    return draft ? (
      <PreviewMark state="expired">
        <div data-b={element.id} className="b-countdown min-h-16 p-3 text-center font-semibold">{title}</div>
      </PreviewMark>
    ) : null
  }

  return (
    <div
      data-b={element.id}
      className={cn('b-countdown flex gap-3', style === 'boxes' ? 'flex-col items-center text-center' : 'flex-wrap items-center justify-center')}
      data-testid="builder-countdown"
    >
      {title && <p className={cn('font-heading font-extrabold text-sf-heading', style === 'boxes' ? 'text-2xl' : 'text-lg')}>{title}</p>}
      <Countdown endsAt={data.ends_at} variant={style === 'boxes' ? 'large' : 'inline'} className={style === 'boxes' ? 'items-center sm:items-center' : undefined} />
    </div>
  )
}

/* -------------------------------------------------------------------------------------------- */

/** A live promotion: what it takes off, its conditions, its end, the coupon code to copy and a button. */
export function DiscountElement({ element }: { element: El<'discount'> }) {
  return <WithData element={element} is={isDiscountData}>{(data) => <DiscountBody element={element} data={data} />}</WithData>
}

function DiscountBody({ element, data }: { element: El<'discount'>; data: DiscountData }) {
  const { t, digits } = useLocale()
  const format = usePriceFormat()
  const p = element.props ?? {}
  const title = str(p.title) || data.name
  const text = str(p.text)
  const buttonLabel = str(p.button_label)
  const url = safeLink(p.link)
  const off =
    data.kind === 'percent'
      ? t('content.builder.discount.percentOff', { value: digits(trimDecimalString(data.value)) })
      : t('content.builder.discount.amountOff', { amount: format.price(data.value) })

  return (
    <div data-b={element.id} className="b-discount flex flex-col items-center gap-3 rounded-sf-card border-2 border-dashed border-sf-sale/60 bg-sf-surface p-6 text-center" data-testid="builder-discount">
      <p className="font-heading text-4xl font-extrabold text-sf-sale">{off}</p>
      {title && <h3 className="text-xl font-bold">{title}</h3>}
      {text && <p className="max-w-xl">{text}</p>}
      {data.min_subtotal && <p className="text-sm">{t('content.builder.discount.minimum', { amount: format.price(data.min_subtotal) })}</p>}
      {data.ends_at && <Countdown endsAt={data.ends_at} />}
      {data.coupon_code && <CouponCode code={data.coupon_code} />}
      {buttonLabel && url && (
        <MenuLink url={url} className={PRIMARY_BUTTON}>
          {buttonLabel}
        </MenuLink>
      )}
    </div>
  )
}

/**
 * The coupon code with a copy button. Copies with the Clipboard API and confirms with a notice; if
 * that is not possible (no permission, an old browser) the code is selected for Ctrl+C instead.
 */
export function CouponCode({ code }: { code: string }) {
  const { t } = useLocale()
  const notify = useNotice()
  const codeRef = useRef<HTMLElement>(null)

  const selectCode = () => {
    const node = codeRef.current
    const selection = typeof window !== 'undefined' ? window.getSelection() : null
    if (!node || !selection) return
    const range = document.createRange()
    range.selectNodeContents(node)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')
      await navigator.clipboard.writeText(code)
      notify(t('content.builder.discount.copied', { code }))
    } catch {
      selectCode()
      notify(t('content.builder.discount.copyManual', { code }))
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2" data-testid="coupon">
      <span className="text-sm font-semibold">{t('content.builder.discount.code')}</span>
      <code ref={codeRef} className="rounded-md border-2 border-sf-border bg-sf-canvas px-3 py-1.5 font-mono text-base font-bold tracking-widest text-sf-heading select-all" data-testid="coupon-code">
        {code}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={t('content.builder.discount.copyLabel', { code })}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-sf-button border-2 border-sf-accent px-3 text-sm font-semibold text-sf-accent transition hover:bg-sf-accent hover:text-sf-accent-foreground"
      >
        <CopyIcon aria-hidden className="size-4" />
        {t('content.builder.discount.copy')}
      </button>
    </div>
  )
}

/* -------------------------------------------------------------------------------------------- */

function ctaButton(value: unknown): { label: string; url: string } | null {
  if (!isObject(value)) return null
  const label = str(value.label).trim()
  const url = safeLink(value.link)
  return label && url ? { label, url } : null
}

/** A heading, a line of text and one or two buttons. */
export function CtaElement({ element }: { element: El<'cta'> }) {
  const p = element.props ?? {}
  const align = oneOf(p.align, B4_ENUMS.ctaAlign) ?? 'center'
  const title = str(p.title).slice(0, B4_LIMITS.ctaTitle)
  const text = str(p.text).slice(0, B4_LIMITS.ctaText)
  const primary = ctaButton(p.primary)
  const secondary = ctaButton(p.secondary)
  if (!title && !text && !primary) return <DraftPlaceholder element={element} />

  return (
    <div data-b={element.id} className={cn('b-cta flex flex-col gap-4', ALIGN_ITEMS[align])} data-testid="builder-cta">
      {title && <h2 className="sf-heading-case text-3xl font-extrabold lg:text-4xl">{title}</h2>}
      {text && <p className="max-w-2xl text-lg whitespace-pre-line">{text}</p>}
      {(primary || secondary) && (
        <div className={cn('mt-2 flex flex-wrap gap-3', JUSTIFY[align])}>
          {primary && (
            <MenuLink url={primary.url} className={PRIMARY_BUTTON}>
              {primary.label}
            </MenuLink>
          )}
          {secondary && (
            <MenuLink url={secondary.url} className={SECONDARY_BUTTON}>
              {secondary.label}
            </MenuLink>
          )}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------------------------- */

/** One product, large: image with a badge, title, text, price and a button to its page. */
export function PromoCardElement({ element }: { element: El<'promo_card'> }) {
  return <WithData element={element} is={isPromoCardData}>{(product) => <PromoCardBody element={element} product={product} />}</WithData>
}

function PromoCardBody({ element, product }: { element: El<'promo_card'>; product: PromoCardData }) {
  const pricing = useCardPricing(product)
  const p = element.props ?? {}
  const badge = str(p.badge).slice(0, B4_LIMITS.promoBadge)
  const title = (typeof p.title === 'string' && p.title.trim()) || product.name
  const text = str(p.text) || product.short_description || ''
  const buttonLabel = str(p.button_label)
  const url = safeUrl(product.url) ?? '/shop'
  const headingId = useId()

  return (
    <article data-b={element.id} aria-labelledby={headingId} className="b-promo-card grid overflow-hidden rounded-sf-card border bg-sf-surface sm:grid-cols-2" data-testid="builder-promo-card">
      <Link to={url} tabIndex={-1} aria-hidden className="relative block">
        <ProductImage image={product.image} alt="" fit="cover" className="aspect-square w-full" />
        {badge && <span className="absolute top-3 left-3 rounded-full bg-sf-sale px-3 py-1 text-xs font-bold tracking-wide text-white uppercase" data-testid="promo-badge">{badge}</span>}
      </Link>
      <div className="flex flex-col justify-center gap-3 p-6 lg:p-10">
        {/* The badge is drawn over the image (hidden with it); readers get it here. */}
        {badge && <p className="sr-only">{badge}</p>}
        <h3 id={headingId} className="text-2xl font-extrabold lg:text-3xl">
          <Link to={url} className="hover:text-sf-accent">{title}</Link>
        </h3>
        {text && <p className="whitespace-pre-line">{text}</p>}
        <CardPrice product={product} pricing={pricing} className="text-lg" />
        {buttonLabel && (
          <Link to={url} className={cn(PRIMARY_BUTTON, 'self-start')}>
            {buttonLabel}
          </Link>
        )}
      </div>
    </article>
  )
}

/* -------------------------------------------------------------------------------------------- */

/** E-mail sign-up through the store's newsletter endpoint (double opt-in), stacked or in one row. */
export function NewsletterFormElement({ element }: { element: El<'newsletter_form'> }) {
  const id = useId()
  const { t } = useLocale()
  const subscribe = useNewsletterMutation()
  const [email, setEmail] = useState('')
  const p = element.props ?? {}
  const layout = oneOf(p.layout, B4_ENUMS.blockLayout) ?? 'inline'
  const title = str(p.title)
  const text = str(p.text)
  const buttonLabel = str(p.button_label) || t('theme.footer.subscribe')

  return (
    <div data-b={element.id} className="b-newsletter flex flex-col gap-3" data-testid="builder-newsletter">
      {title && <h2 id={`${id}-title`} className="text-2xl font-extrabold">{title}</h2>}
      {text && <p>{text}</p>}
      {subscribe.isSuccess ? (
        <p role="status" className="font-semibold">{subscribe.data.message}</p>
      ) : (
        <form
          className={cn('flex gap-2', layout === 'inline' ? 'flex-col sm:flex-row' : 'flex-col')}
          noValidate
          aria-label={title || t('content.section.newsletter')}
          onSubmit={(e) => {
            e.preventDefault()
            if (email.trim()) subscribe.mutate(email.trim())
          }}
        >
          <label htmlFor={`${id}-email`} className="sr-only">{t('content.section.emailLabel')}</label>
          <input
            id={`${id}-email`}
            type="email"
            required
            autoComplete="email"
            placeholder={t('content.section.emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={subscribe.isError ? true : undefined}
            aria-describedby={subscribe.isError ? `${id}-error` : undefined}
            className="h-11 min-w-0 flex-1 rounded-sf-button border border-sf-border bg-sf-surface px-4 text-sm text-sf-heading placeholder:text-sf-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent"
          />
          <button type="submit" disabled={subscribe.isPending} className={cn(PRIMARY_BUTTON, 'min-h-11 py-0 disabled:opacity-70')}>
            {subscribe.isPending ? t('content.section.sending') : buttonLabel}
          </button>
        </form>
      )}
      {subscribe.isError && (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium">
          {subscribe.error instanceof ApiError && subscribe.error.code === 'VALIDATION_FAILED' ? t('content.section.emailInvalid') : storeFormError(subscribe.error, t)}
        </p>
      )}
    </div>
  )
}
