import { useState } from 'react'
import { Link } from 'react-router'
import { HeartIcon, Loader2Icon, ShoppingCartIcon } from 'lucide-react'
import { primaryButtonClass, Spinner } from '../account/form-controls'
import { useAddToCartMutation } from '../cart/api'
import { useCartDrawer } from '../cart/cart-drawer-context'
import { cartErrorMessage } from '../cart/quantity'
import { useAllProductsBySlugsQuery } from '../catalog/api'
import { ProductCard } from '../catalog/product-card'
import type { ProductCard as Card } from '../types'
import { useDocumentTitle } from '../use-document-title'
import { useWishlist } from './api'

type Tile = { product: Card; itemId?: string }

/**
 * Saved products: from the account when signed in, from this browser for guests (fetched
 * fresh by slug, so names and prices are always current). Single-variant products move to the
 * cart in one click; others link to their page to choose options.
 */
export function WishlistPage() {
  useDocumentTitle('Wishlist')
  const wishlist = useWishlist()
  const guestProducts = useAllProductsBySlugsQuery(wishlist.signedIn ? [] : wishlist.local.map((entry) => entry.slug))

  let tiles: Tile[] | undefined
  let error: unknown = null
  let retry: () => void = () => {}
  if (!wishlist.ready) tiles = undefined
  else if (wishlist.signedIn) {
    tiles = wishlist.server.data?.items.map((item) => ({ product: item.product, itemId: item.id }))
    error = wishlist.server.error
    retry = () => void wishlist.server.refetch()
  } else {
    // Only products still on the local list (a removal shows at once, before any refetch).
    const saved = new Set(wishlist.local.map((entry) => entry.product_id))
    tiles = guestProducts.data?.filter((product) => saved.has(product.id)).map((product) => ({ product }))
    error = guestProducts.error
    retry = () => void guestProducts.refetch()
  }

  return (
    <section className="mx-auto max-w-sf px-4 py-8 lg:py-12" data-testid="wishlist-page">
      <h1 className="text-3xl font-extrabold lg:text-4xl">Wishlist</h1>
      {wishlist.ready && !wishlist.signedIn && wishlist.local.length > 0 && (
        <p className="mt-2 text-sm">
          Your wishlist is saved in this browser.{' '}
          <Link to="/account/login?next=%2Fwishlist" className="font-semibold text-sf-accent underline-offset-4 hover:underline">Sign in</Link> to keep it in your account.
        </p>
      )}

      {error && !tiles ? (
        <div className="mt-6 rounded-sf-card bg-sf-surface p-8 text-center">
          <p role="alert">Your wishlist could not be loaded. Please try again.</p>
          <button type="button" className={`${primaryButtonClass} mt-4`} onClick={retry}>Try again</button>
        </div>
      ) : !tiles ? (
        <Spinner label="Loading your wishlist" />
      ) : tiles.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-sf-card bg-sf-surface p-10 text-center">
          <HeartIcon aria-hidden className="size-14 text-sf-border" />
          <p className="text-lg font-semibold text-sf-heading">Your wishlist is empty.</p>
          <p className="text-sm">Tap the heart on a product to save it for later.</p>
          <Link to="/shop" className={primaryButtonClass}>Start shopping</Link>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-3 lg:grid-cols-4" aria-label="Saved products">
          {tiles.map((tile) => (
            <li key={tile.itemId ?? tile.product.id}>
              <ProductCard product={tile.product} actions={<WishlistActions tile={tile} />} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function WishlistActions({ tile }: { tile: Tile }) {
  const { product, itemId } = tile
  const wishlist = useWishlist()
  const add = useAddToCartMutation()
  const drawer = useCartDrawer()
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const busy = add.isPending || removing
  const single = product.variant_count === 1 && product.default_variant_id

  const remove = async () => {
    setRemoving(true)
    try {
      await wishlist.removeItem({ itemId, productId: product.id })
    } catch {
      setError('The wishlist could not be updated. Please try again.')
    } finally {
      setRemoving(false)
    }
  }

  const moveToCart = () => {
    if (!product.default_variant_id) return
    setError(null)
    add.mutate(
      { variant_id: product.default_variant_id, quantity: '1' },
      {
        onSuccess: () => {
          drawer?.open()
          void remove()
        },
        onError: (e) => setError(cartErrorMessage(e)),
      },
    )
  }

  const buttonClass = 'inline-flex w-full items-center justify-center gap-2 rounded-sf-button px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <div className="flex flex-col gap-2">
      {single ? (
        <button type="button" className={`${buttonClass} bg-sf-accent text-sf-accent-foreground hover:brightness-110`} disabled={busy || !product.in_stock} onClick={moveToCart} aria-label={`Move ${product.name} to the cart`}>
          {add.isPending ? <Loader2Icon aria-hidden className="size-4 animate-spin" /> : <ShoppingCartIcon aria-hidden className="size-4" />}
          {product.in_stock ? 'Move to cart' : 'Out of stock'}
        </button>
      ) : (
        <Link to={product.url} className={`${buttonClass} border border-sf-accent text-sf-accent hover:bg-sf-accent hover:text-sf-accent-foreground`} aria-label={`Choose options: ${product.name}`}>
          Choose options
        </Link>
      )}
      <button type="button" className="text-sm font-semibold text-sf-text underline-offset-4 hover:text-sf-sale hover:underline disabled:opacity-60" disabled={busy} onClick={() => void remove()} aria-label={`Remove ${product.name}`}>
        Remove
      </button>
      {error && <p role="alert" className="text-xs text-sf-sale">{error}</p>}
    </div>
  )
}
