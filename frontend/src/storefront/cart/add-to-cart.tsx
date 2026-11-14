import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Loader2Icon, ShoppingCartIcon, SlidersHorizontalIcon, ZapIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { primaryButtonClass } from '../account/form-controls'
import { useLocale } from '../i18n/locale'
import type { ProductCard, ProductDetail, ProductVariant } from '../types'
import { NotifyMeForm } from '../catalog/notify-me'
import { useAddToCartMutation } from './api'
import { prefetchCheckout, useBuyBox, type BuyBox } from './buy-box'
import { useCartDrawer } from './cart-drawer-context'
import { cartErrorMessage } from './quantity'
import { QuantityStepper } from './quantity-stepper'

/** P1b "Buy now": the theme's primary pair (its own AA foreground), set apart from the accent "Add to cart". */
export const buyNowButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-sf-button border-2 border-sf-primary bg-sf-primary px-6 py-3 text-sm font-bold text-sf-primary-foreground transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-accent disabled:cursor-not-allowed disabled:opacity-60'

/**
 * Quantity + "Add to cart" in quick view and the builder's product spotlight, with its own buy
 * state. Disabled until a variant is chosen and while it is out of stock; a stock error narrows the
 * stepper to what is left. Success opens the mini-cart.
 */
export function AddToCartForm({ product, variant, onAdded }: { product: ProductDetail; variant: ProductVariant | null; onAdded?: () => void }) {
  const box = useBuyBox(product, variant, { onAdded })
  return <BuyForm product={product} variant={variant} box={box} />
}

/**
 * The buy form over a shared buy state (the product page shares it with its quick-buy bar). With
 * `buyNow` (P1b, the product page) a "Buy now" button adds the line and goes straight to the
 * checkout; it is disabled like "Add to cart" and gone for a sold-out variant, where a live product
 * offers the back-in-stock e-mail (P1a) instead. `extra` (P2b "Order on WhatsApp") takes its own row
 * under the buttons and goes with them.
 */
export function BuyForm({
  product,
  variant,
  box,
  buyNow = false,
  extra,
}: {
  product: ProductDetail
  variant: ProductVariant | null
  box: BuyBox
  buyNow?: boolean
  extra?: ReactNode
}) {
  const { t } = useLocale()

  // P1a: a sold-out variant of a live product offers a back-in-stock e-mail instead (previews keep the disabled button).
  if (variant && !variant.in_stock && !product.preview_state) return <NotifyMeForm product={product} variant={variant} />

  const submit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    box.addToCart('form', event.nativeEvent.submitter instanceof HTMLElement ? event.nativeEvent.submitter : null)
  }
  const error = box.errorFor('form')
  const adding = box.pending('cart', 'form')
  const buying = box.pending('buy', 'form')

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" aria-label={t('cart.add.formLabel')} data-testid="add-to-cart">
      <div className="flex flex-wrap items-center gap-3">
        <QuantityStepper value={box.quantity} onChange={box.setQuantity} allowDecimal={box.allowDecimal} max={box.max} disabled={box.unavailable || box.busy} label={t('cart.add.quantityOf', { name: product.name })} />
        {/* Not disabled while adding: a disabled button would lose focus, which returns to it from the mini-cart. */}
        <button
          type="submit"
          className={cn(primaryButtonClass, buyNow ? 'min-w-0 flex-1 basis-32 px-4 sm:px-6' : 'min-w-44 flex-1 sm:flex-none')}
          disabled={box.unavailable}
          aria-disabled={box.busy || undefined}
        >
          {adding ? <Loader2Icon aria-hidden className="size-4 animate-spin" /> : <ShoppingCartIcon aria-hidden className="size-4" />}
          {adding ? t('cart.add.adding') : t('cart.add.button')}
        </button>
        {buyNow && !box.soldOut && (
          <button
            type="button"
            className={cn(buyNowButtonClass, 'min-w-0 flex-1 basis-full px-4 sm:basis-40 sm:px-6')}
            disabled={box.unavailable}
            aria-disabled={box.busy || undefined}
            onClick={(event) => box.buyNow('form', event.currentTarget)}
            onPointerEnter={prefetchCheckout}
            onFocus={prefetchCheckout}
            data-testid="buy-now"
          >
            {buying ? <Loader2Icon aria-hidden className="size-4 animate-spin" /> : <ZapIcon aria-hidden className="size-4" />}
            {buying ? t('cart.add.buying') : t('cart.add.buyNow')}
          </button>
        )}
        {extra}
      </div>
      {box.reason && <p className="text-sm">{box.reason}</p>}
      {error && (
        <p role="alert" className="text-sm font-medium text-sf-sale">
          {error}
        </p>
      )}
    </form>
  )
}

const CARD_ACTION_CLASS = {
  outline:
    'inline-flex w-full items-center justify-center gap-2 rounded-sf-button border border-sf-accent px-2 py-2 text-sm leading-tight font-bold text-sf-accent sm:px-4 transition hover:bg-sf-accent hover:text-sf-accent-foreground disabled:cursor-not-allowed disabled:border-sf-border disabled:text-sf-text disabled:hover:bg-transparent',
  solid:
    'inline-flex w-full items-center justify-center gap-2 rounded-sf-button border border-sf-accent bg-sf-accent px-2 py-2.5 text-xs leading-tight font-bold tracking-wide text-sf-accent-foreground uppercase sm:px-4 sm:tracking-wider transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:border-sf-border disabled:bg-sf-canvas disabled:text-sf-text disabled:hover:brightness-100',
  /** Icon only (arched card): a round surface button; its name comes from aria-label. */
  round:
    'grid size-10 place-items-center rounded-full bg-sf-surface text-sf-heading shadow-md transition hover:bg-sf-primary hover:text-sf-primary-foreground focus-visible:bg-sf-primary focus-visible:text-sf-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sf-surface disabled:cursor-not-allowed disabled:text-sf-text disabled:hover:bg-sf-surface [@media(hover:hover)]:size-11',
} as const

/**
 * The card's buy action: "Add to cart" (one unit) for a product with exactly one variant,
 * else a "Choose options" link to the product page. `solid` is the filled button of the commerce card,
 * `round` the icon-only button of the arched card (`className` positions it).
 */
export function CardCartAction({ product, appearance = 'outline', className: rootClassName }: { product: ProductCard; appearance?: keyof typeof CARD_ACTION_CLASS; className?: string }) {
  const add = useAddToCartMutation()
  const drawer = useCartDrawer()
  const { t } = useLocale()
  const [error, setError] = useState<string | null>(null)
  const className = CARD_ACTION_CLASS[appearance]
  const round = appearance === 'round'

  if (product.variant_count !== 1 || !product.default_variant_id) {
    return (
      <Link to={product.url} className={cn(className, rootClassName)} aria-label={t('cart.card.chooseOptionsLabel', { name: product.name })}>
        {round ? <SlidersHorizontalIcon aria-hidden className="size-5" /> : t('cart.card.chooseOptions')}
      </Link>
    )
  }

  const variantId = product.default_variant_id
  const icon = add.isPending ? <Loader2Icon aria-hidden className={cn(round ? 'size-5' : 'size-4', 'animate-spin')} /> : <ShoppingCartIcon aria-hidden className={round ? 'size-5' : 'size-4'} />
  return (
    // The round button's error floats under it, so the arched card's layout stays put.
    <div className={round ? cn('relative', rootClassName) : 'flex flex-col gap-1'}>
      <button
        type="button"
        className={className}
        disabled={!product.in_stock}
        aria-disabled={add.isPending || undefined}
        aria-label={product.in_stock ? t('cart.card.addLabel', { name: product.name }) : t('cart.card.outOfStockLabel', { name: product.name })}
        onClick={(event) => {
          if (add.isPending) return
          const button = event.currentTarget
          setError(null)
          add.mutate({ variant_id: variantId, quantity: '1' }, { onSuccess: () => drawer?.open(button), onError: (e) => setError(cartErrorMessage(e, t)) })
        }}
      >
        {icon}
        {!round && (product.in_stock ? (add.isPending ? t('cart.add.adding') : t('cart.add.button')) : t('cart.card.outOfStock'))}
      </button>
      {error && (
        <p
          role="alert"
          className={round ? 'absolute top-full left-1/2 z-10 mt-2 w-44 -translate-x-1/2 rounded-md bg-sf-surface px-2 py-1 text-center text-xs font-medium text-sf-sale shadow-md' : 'text-xs text-sf-sale'}
        >
          {error}
        </p>
      )}
    </div>
  )
}
