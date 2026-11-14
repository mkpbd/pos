import { useRef, useState, type RefObject } from 'react'
import { BellIcon, Loader2Icon, ShoppingCartIcon, ZapIcon } from 'lucide-react'
import { compareDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'
import { primaryButtonClass } from '../account/form-controls'
import { buyNowButtonClass } from '../cart/add-to-cart'
import { prefetchCheckout, type BuyBox } from '../cart/buy-box'
import { QuantityStepper } from '../cart/quantity-stepper'
import { useLocale } from '../i18n/locale'
import { usePriceFormat } from '../money'
import type { CatalogImage, ProductDetail, ProductVariant } from '../types'
import { ProductImage } from './product-image'
import { useStickyTop } from '../builder/section-layer-utils'
import { useBottomBarSpace, useScrolledPast } from './use-viewport'

/**
 * P1b quick buy: once the product's own buy area has scrolled up out of view, a bar fixed to the
 * bottom of the screen (above a B8b bottom bar, clear of the phone's home indicator) repeats the
 * essentials — photo, name, chosen variant, price, quantity, "Add to cart" and "Buy now" — over
 * the same buy state as the form. Options are not chosen here: with a choice missing, its buttons
 * take the shopper to the options; for a sold-out variant, to the back-in-stock form. A region
 * named "Quick buy"; hidden (and inert) while the form is on screen. Mounted the first time it is needed.
 */
export function QuickBuyBar({
  product,
  variant,
  box,
  image,
  watch,
  onChooseOptions,
  onNotify,
}: {
  product: ProductDetail
  variant: ProductVariant | null
  box: BuyBox
  image: CatalogImage | null
  /** The product's own buy area, whose leaving the screen shows the bar. */
  watch: RefObject<HTMLElement | null>
  onChooseOptions: () => void
  onNotify: () => void
}) {
  // Buttons hidden under a sticky store header are out of view too.
  const visible = useScrolledPast(watch, useStickyTop(true))
  const [mounted, setMounted] = useState(false)
  if (visible && !mounted) setMounted(true)
  if (!mounted) return null
  return <Bar product={product} variant={variant} box={box} image={image} visible={visible} onChooseOptions={onChooseOptions} onNotify={onNotify} />
}

function Bar({
  product,
  variant,
  box,
  image,
  visible,
  onChooseOptions,
  onNotify,
}: {
  product: ProductDetail
  variant: ProductVariant | null
  box: BuyBox
  image: CatalogImage | null
  visible: boolean
  onChooseOptions: () => void
  onNotify: () => void
}) {
  const { t } = useLocale()
  const format = usePriceFormat()
  const ref = useRef<HTMLDivElement>(null)
  useBottomBarSpace(ref, visible)
  const notify = box.soldOut && !product.preview_state
  const error = box.errorFor('bar')
  const adding = box.pending('cart', 'bar')
  const buying = box.pending('buy', 'bar')
  const price = variant
    ? format.price(variant.promo_price ?? variant.price)
    : compareDecimal(product.price, product.price_max) !== 0
      ? `${t('catalog.price.from')}${format.price(product.price)}`
      : format.price(product.price)
  const detail = !variant ? t('catalog.quickBuy.chooseOptions') : box.soldOut ? t('catalog.stock.out') : product.options.length > 0 ? variant.name : null

  const act = (intent: 'cart' | 'buy', button: HTMLElement) => {
    if (!variant) return onChooseOptions()
    if (intent === 'buy') box.buyNow('bar', button)
    else box.addToCart('bar', button)
  }

  return (
    <div
      ref={ref}
      role="region"
      aria-label={t('catalog.quickBuy.label')}
      aria-hidden={visible ? undefined : true}
      inert={!visible}
      data-state={visible ? 'open' : 'closed'}
      className="sf-quick-buy fixed inset-x-0 z-40 border-t border-sf-border bg-sf-surface text-sf-text shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.35)]"
      data-testid="quick-buy"
    >
      <div className="sf-quick-buy-inner mx-auto flex max-w-sf flex-wrap items-center gap-x-4 gap-y-2 px-3 pt-2 sm:px-4 md:flex-nowrap md:pt-3">
        {error && (
          <p role="alert" className="basis-full text-sm font-medium text-sf-sale md:order-last md:basis-auto">
            {error}
          </p>
        )}
        <div className="flex min-w-0 basis-full items-center gap-3 md:flex-1 md:basis-auto">
          <ProductImage image={image} alt="" className="size-10 shrink-0 rounded-md border md:size-12" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-sf-heading">{product.name}</p>
            {detail && <p className="truncate text-xs">{detail}</p>}
          </div>
          <p className="shrink-0 font-heading text-base font-extrabold text-sf-heading md:text-lg" data-testid="quick-buy-price">
            {price}
          </p>
        </div>
        {notify ? (
          <button type="button" onClick={onNotify} className={cn(primaryButtonClass, 'w-full px-4 py-2.5 md:w-auto')}>
            <BellIcon aria-hidden className="size-4" />
            {t('catalog.notify.button')}
          </button>
        ) : (
          <div className="flex w-full items-center gap-2 md:w-auto md:shrink-0">
            <QuantityStepper
              value={box.quantity}
              onChange={box.setQuantity}
              allowDecimal={box.allowDecimal}
              max={box.max}
              disabled={box.unavailable || box.busy}
              label={t('cart.add.quantityOf', { name: product.name })}
              size="sm"
            />
            {/* Not disabled while adding: a disabled button would lose focus, which returns to it from the mini-cart. */}
            <button
              type="button"
              className={cn(primaryButtonClass, 'min-h-11 shrink-0 px-3 py-2 sm:px-5')}
              disabled={box.soldOut}
              aria-disabled={box.busy || undefined}
              onClick={(event) => act('cart', event.currentTarget)}
              data-testid="quick-buy-add"
            >
              {adding ? <Loader2Icon aria-hidden className="size-4 animate-spin" /> : <ShoppingCartIcon aria-hidden className="size-4" />}
              {/* Phones show the cart icon only; its name stays for screen readers. */}
              <span className="sr-only sm:not-sr-only">{adding ? t('cart.add.adding') : t('cart.add.button')}</span>
            </button>
            {!box.soldOut && (
              <button
                type="button"
                className={cn(buyNowButtonClass, 'min-h-11 min-w-0 flex-1 px-3 py-2 sm:px-5 md:flex-none')}
                aria-disabled={box.busy || undefined}
                onClick={(event) => act('buy', event.currentTarget)}
                onPointerEnter={prefetchCheckout}
                onFocus={prefetchCheckout}
                data-testid="quick-buy-now"
              >
                {buying ? <Loader2Icon aria-hidden className="size-4 animate-spin" /> : <ZapIcon aria-hidden className="size-4" />}
                {buying ? t('cart.add.buying') : t('cart.add.buyNow')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
