import { HeartIcon } from 'lucide-react'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import { useNotice } from '../notices'
import { MAX_WISHLIST_ITEMS, useWishlist, type WishlistProduct } from './api'

/**
 * Heart toggle (aria-pressed) for a product: saved on the account when signed in, in this
 * browser for guests. `appearance="icon"` sits on a card image, `"text"` under "Add to cart".
 */
export function WishlistButton({ product, name, appearance = 'icon', className }: { product: WishlistProduct; name: string; appearance?: 'icon' | 'text'; className?: string }) {
  const wishlist = useWishlist()
  const notify = useNotice()
  const { t } = useLocale()
  const saved = wishlist.isSaved(product.id)

  const onClick = () => {
    wishlist.toggle(product).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'WISHLIST_FULL') {
        const max = Number(error.details.max_items)
        notify(t('wishlist.full', { max: Number.isFinite(max) && max > 0 ? max : MAX_WISHLIST_ITEMS }))
      } else {
        // Other refusals: the server's message (it answers in the request's language when it can).
        notify(error instanceof ApiError && error.status === 422 ? error.message : t('wishlist.updateFailed'))
      }
    })
  }

  const label = saved ? t('wishlist.button.removeLabel', { name }) : t('wishlist.button.addLabel', { name })

  if (appearance === 'text') {
    return (
      <button
        type="button"
        aria-pressed={saved}
        disabled={!wishlist.ready || wishlist.pending}
        onClick={onClick}
        className={cn('inline-flex items-center gap-2 self-start text-sm font-semibold text-sf-heading transition hover:text-sf-accent disabled:opacity-60', className)}
        data-testid="wishlist-toggle"
      >
        <HeartIcon aria-hidden className={cn('size-5', saved && 'fill-sf-sale text-sf-sale')} />
        {saved ? t('wishlist.button.saved') : t('wishlist.button.add')}
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={label}
      title={saved ? t('wishlist.button.removeTitle') : t('wishlist.button.add')}
      disabled={!wishlist.ready || wishlist.pending}
      onClick={onClick}
      className={cn(
        'grid size-10 place-items-center rounded-full bg-sf-surface text-sf-heading shadow-md transition hover:bg-sf-accent hover:text-sf-accent-foreground focus-visible:bg-sf-accent focus-visible:text-sf-accent-foreground disabled:opacity-60',
        className,
      )}
      data-testid="wishlist-toggle"
    >
      <HeartIcon aria-hidden className={cn('size-5', saved && 'fill-sf-sale text-sf-sale')} />
    </button>
  )
}
