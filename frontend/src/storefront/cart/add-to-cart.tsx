import { useState } from 'react'
import { Link } from 'react-router'
import { Loader2Icon, ShoppingCartIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { primaryButtonClass } from '../account/form-controls'
import type { ProductCard, ProductDetail, ProductVariant } from '../types'
import { useAddToCartMutation } from './api'
import { useCartDrawer } from './cart-drawer-context'
import { cartErrorMessage, maxQuantityHint } from './quantity'
import { QuantityStepper } from './quantity-stepper'

/**
 * Quantity + "Add to cart" on the product page and in quick view. Disabled until a variant is
 * chosen and while it is out of stock; a stock error narrows the stepper to what is left.
 * Success opens the mini-cart. Remount per variant (key) so the limit does not carry over.
 */
export function AddToCartForm({ product, variant, onAdded }: { product: ProductDetail; variant: ProductVariant | null; onAdded?: () => void }) {
  const add = useAddToCartMutation()
  const drawer = useCartDrawer()
  const [quantity, setQuantity] = useState('1')
  const [max, setMax] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const allowDecimal = product.allow_decimal ?? false
  const unavailable = !variant || !variant.in_stock
  const reason = !variant ? 'Choose the options above to add this product to your cart.' : !variant.in_stock ? 'This option is out of stock.' : null

  const submit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!variant || unavailable || add.isPending) return
    const button = event.nativeEvent.submitter instanceof HTMLElement ? event.nativeEvent.submitter : null
    setError(null)
    add.mutate(
      { variant_id: variant.id, quantity },
      {
        onSuccess: () => {
          setMax(null)
          onAdded?.()
          drawer?.open(button)
        },
        onError: (e) => {
          setError(cartErrorMessage(e))
          const hint = maxQuantityHint(e)
          if (hint && hint !== '0') setMax(hint)
        },
      },
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" aria-label="Add to cart" data-testid="add-to-cart">
      <div className="flex flex-wrap items-center gap-3">
        <QuantityStepper value={quantity} onChange={setQuantity} allowDecimal={allowDecimal} max={max} disabled={unavailable || add.isPending} label={`Quantity of ${product.name}`} />
        {/* Not disabled while adding: a disabled button would lose focus, which returns to it from the mini-cart. */}
        <button type="submit" className={cn(primaryButtonClass, 'min-w-44 flex-1 sm:flex-none')} disabled={unavailable} aria-disabled={add.isPending || undefined}>
          {add.isPending ? <Loader2Icon aria-hidden className="size-4 animate-spin" /> : <ShoppingCartIcon aria-hidden className="size-4" />}
          {add.isPending ? 'Adding…' : 'Add to cart'}
        </button>
      </div>
      {reason && <p className="text-sm">{reason}</p>}
      {error && (
        <p role="alert" className="text-sm font-medium text-sf-sale">
          {error}
        </p>
      )}
    </form>
  )
}

/**
 * The card's buy action: "Add to cart" (one unit) for a product with exactly one variant,
 * else a "Choose options" link to the product page.
 */
export function CardCartAction({ product }: { product: ProductCard }) {
  const add = useAddToCartMutation()
  const drawer = useCartDrawer()
  const [error, setError] = useState<string | null>(null)
  const className = 'inline-flex w-full items-center justify-center gap-2 rounded-sf-button border border-sf-accent px-4 py-2 text-sm font-bold text-sf-accent transition hover:bg-sf-accent hover:text-sf-accent-foreground disabled:cursor-not-allowed disabled:border-sf-border disabled:text-sf-text disabled:hover:bg-transparent'

  if (product.variant_count !== 1 || !product.default_variant_id) {
    return (
      <Link to={product.url} className={className} aria-label={`Choose options: ${product.name}`}>
        Choose options
      </Link>
    )
  }

  const variantId = product.default_variant_id
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className={className}
        disabled={!product.in_stock}
        aria-disabled={add.isPending || undefined}
        aria-label={product.in_stock ? `Add ${product.name} to the cart` : `${product.name} is out of stock`}
        onClick={(event) => {
          if (add.isPending) return
          const button = event.currentTarget
          setError(null)
          add.mutate({ variant_id: variantId, quantity: '1' }, { onSuccess: () => drawer?.open(button), onError: (e) => setError(cartErrorMessage(e)) })
        }}
      >
        {add.isPending ? <Loader2Icon aria-hidden className="size-4 animate-spin" /> : <ShoppingCartIcon aria-hidden className="size-4" />}
        {product.in_stock ? (add.isPending ? 'Adding…' : 'Add to cart') : 'Out of stock'}
      </button>
      {error && (
        <p role="alert" className="text-xs text-sf-sale">
          {error}
        </p>
      )}
    </div>
  )
}
