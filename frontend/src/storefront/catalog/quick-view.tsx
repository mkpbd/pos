import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRightIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { AddToCartForm } from '../cart/add-to-cart'
import type { ProductDetail } from '../types'
import { WishlistButton } from '../wishlist/wishlist-button'
import { isNotFound, useProductQuery } from './api'
import { ProductGallery } from './product-gallery'
import { ProductSummary } from './product-summary'
import { QuickViewContext } from './quick-view-context'
import { imageIndexOf, useVariantSelection } from './use-variant-selection'
import { initialVariant } from './variant-selection'

/**
 * One quick view dialog for every product card on the page. Focus moves into the dialog,
 * stays there, and returns to the button that opened it when it closes.
 */
export function QuickViewProvider({ children }: { children: ReactNode }) {
  const [slug, setSlug] = useState<string | null>(null)
  // Radix returns focus to a DialogTrigger; the cards' buttons are not one, so remember the opener.
  const opener = useRef<HTMLElement | null>(null)
  const api = useMemo(
    () => ({
      open: (next: string) => {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setSlug(next)
      },
    }),
    [],
  )

  return (
    <QuickViewContext value={api}>
      {children}
      <Dialog open={slug !== null} onOpenChange={(open) => !open && setSlug(null)}>
        <DialogContent className="max-h-[92dvh] w-full overflow-y-auto bg-sf-surface p-5 sm:max-w-3xl md:p-6" aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (opener.current?.isConnected) opener.current.focus()
            opener.current = null
          }}
        >
          {slug && <QuickViewBody slug={slug} onNavigate={() => setSlug(null)} />}
        </DialogContent>
      </Dialog>
    </QuickViewContext>
  )
}

function QuickViewBody({ slug, onNavigate }: { slug: string; onNavigate: () => void }) {
  const product = useProductQuery(slug)

  if (product.data) return <QuickViewProduct key={product.data.id} product={product.data} onNavigate={onNavigate} />

  return (
    <div className="grid min-h-60 place-items-center text-center" role="status">
      <DialogTitle className="sr-only">Quick view</DialogTitle>
      {product.error ? (
        <p>{isNotFound(product.error) ? 'This product is no longer available.' : 'The product could not be loaded. Please try again.'}</p>
      ) : (
        <>
          <span className="size-8 animate-spin rounded-full border-4 border-sf-border border-t-sf-accent" aria-hidden />
          <span className="sr-only">Loading the product</span>
        </>
      )}
    </div>
  )
}

function QuickViewProduct({ product, onNavigate }: { product: ProductDetail; onNavigate: () => void }) {
  const [imageIndex, setImageIndex] = useState(() => Math.max(0, imageIndexOf(product, initialVariant(product)?.image_id)))
  const { selection, variant, choose } = useVariantSelection(product, null, (next) => {
    const i = imageIndexOf(product, next?.image_id)
    if (i >= 0) setImageIndex(i)
  })
  const href = variant && product.variants.length > 1 ? `${product.url}?variant=${encodeURIComponent(variant.id)}` : product.url

  return (
    <div className="grid gap-6 md:grid-cols-2" data-testid="quick-view">
      <ProductGallery images={product.images} name={product.name} index={imageIndex} onIndexChange={setImageIndex} zoom={false} />
      <div className="flex flex-col gap-4">
        <DialogTitle className="pr-8 font-heading text-2xl leading-tight font-extrabold text-sf-heading">{product.name}</DialogTitle>
        <ProductSummary product={product} variant={variant} selection={selection} onChoose={choose} />
        <AddToCartForm key={variant?.id ?? 'none'} product={product} variant={variant} onAdded={onNavigate} />
        <WishlistButton product={product} name={product.name} appearance="text" />
        <Link
          to={href}
          onClick={onNavigate}
          className="mt-auto inline-flex items-center gap-2 self-start text-sm font-bold text-sf-accent underline-offset-4 hover:underline"
        >
          View full details
          <ArrowRightIcon aria-hidden className="size-4" />
        </Link>
      </div>
    </div>
  )
}
