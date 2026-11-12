import { Link } from 'react-router'
import { HeartIcon, ShoppingBagIcon, UserIcon } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import { useCustomer, useLogoutMutation } from '../account/api'
import { useCartQuery } from '../cart/api'
import { useCartDrawer } from '../cart/cart-drawer-context'
import { displayQuantity } from '../cart/quantity'
import { usePriceFormat } from '../money'
import { useNotice } from '../notices'
import { useWishlist } from '../wishlist/api'

const iconButton = 'relative grid size-10 place-items-center rounded-md text-sf-heading transition hover:bg-sf-canvas hover:text-sf-accent'

function CountBadge({ count, testId }: { count: string; testId: string }) {
  const { digits } = useLocale()
  if (count === '0') return null
  return (
    <span aria-hidden className="absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-sf-accent px-1 text-[0.7rem] leading-none font-bold text-sf-accent-foreground" data-testid={testId}>
      {digits(count.length > 4 ? '999+' : count)}
    </span>
  )
}


/**
 * Account, wishlist and cart in the header row, on every screen size. `cartTotal` (the commerce
 * header) shows the cart's total next to its icon.
 */
export function HeaderActions({ cartTotal = false, className }: { cartTotal?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center gap-0.5 sm:gap-1', className)}>
      <AccountMenu />
      <WishlistLink />
      {cartTotal ? <CartTotalButton /> : <CartButton />}
    </div>
  )
}

/** How a header action shows its text: from `lg` (the theme headers), always, or never (the builder's `show_label`). */
export type ActionLabel = 'responsive' | 'always' | 'never'

const LABEL_CLASS: Record<ActionLabel, string> = { responsive: 'hidden lg:inline', always: 'inline', never: 'hidden' }
const LABEL_BUTTON: Record<ActionLabel, string> = { responsive: 'lg:flex lg:w-auto lg:gap-2 lg:px-2', always: 'flex w-auto gap-2 px-2', never: '' }

export function AccountMenu({ label = 'responsive' }: { label?: ActionLabel }) {
  const customer = useCustomer()
  const logout = useLogoutMutation()
  const notify = useNotice()
  const { t } = useLocale()

  if (!customer) {
    return (
      <Link to="/account/login" className={cn(iconButton, LABEL_BUTTON[label])} aria-label={t('common.account.signIn')}>
        <UserIcon aria-hidden className="size-6" />
        <span aria-hidden className={cn('text-sm font-semibold', LABEL_CLASS[label])}>{t('common.account.signIn')}</span>
      </Link>
    )
  }

  const signOut = () =>
    logout.mutate(undefined, {
      onSuccess: () => notify(t('common.account.signedOut')),
      onError: () => notify(t('common.account.signOutFailed')),
    })

  const first = customer.name.split(/\s+/)[0] ?? customer.name

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className={cn(iconButton, LABEL_BUTTON[label])} aria-label={t('common.account.myAccount')}>
        <UserIcon aria-hidden className="size-6" />
        <span aria-hidden className={cn('max-w-32 truncate text-sm font-semibold', LABEL_CLASS[label])}>{first}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 bg-sf-surface">
        <DropdownMenuLabel className="truncate text-sf-heading">{customer.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account">{t('common.account.myAccount')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account/orders">{t('common.account.orders')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account/returns">{t('common.account.returns')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account/reviews">{t('common.account.reviews')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account/profile">{t('common.account.profile')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account/addresses">{t('common.account.addresses')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/wishlist">{t('common.account.wishlist')}</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={logout.isPending} onSelect={signOut}>
          {t('common.account.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function WishlistLink({ label = 'never' }: { label?: ActionLabel }) {
  const wishlist = useWishlist()
  const { t } = useLocale()
  const count = String(wishlist.count)
  return (
    <Link to="/wishlist" className={cn(iconButton, LABEL_BUTTON[label])} aria-label={count === '0' ? t('common.wishlist') : t('common.wishlistWithCount', { items: t('common.items', { count: Number(count) }) })}>
      {label === 'never' ? (
        <>
          <HeartIcon aria-hidden className="size-6" />
          <CountBadge count={count} testId="wishlist-count" />
        </>
      ) : (
        <>
          <span className="relative grid size-8 place-items-center">
            <HeartIcon aria-hidden className="size-6" />
            <CountBadge count={count} testId="wishlist-count" />
          </span>
          <span aria-hidden className={cn('text-sm font-semibold', LABEL_CLASS[label])}>{t('common.wishlist')}</span>
        </>
      )}
    </Link>
  )
}

export function CartButton({ showCount = true }: { showCount?: boolean }) {
  const cart = useCartQuery()
  const drawer = useCartDrawer()
  const { t } = useLocale()
  const count = cart.data ? displayQuantity(cart.data.item_count) : '0'
  return (
    <button type="button" className={iconButton} aria-label={count === '0' ? t('common.cart') : t('common.cartWithCount', { items: t('common.items', { count: Number(count) }) })} aria-haspopup="dialog" onClick={() => drawer?.open()}>
      <ShoppingBagIcon aria-hidden className="size-6" />
      {showCount && <CountBadge count={count} testId="cart-count" />}
    </button>
  )
}

/** The cart with its item count and total ("Cart, 2 items, ৳900.00"), for the commerce header. */
export function CartTotalButton({ showCount = true }: { showCount?: boolean }) {
  const cart = useCartQuery()
  const drawer = useCartDrawer()
  const format = usePriceFormat()
  const { t } = useLocale()
  const count = cart.data ? displayQuantity(cart.data.item_count) : '0'
  const total = format.price(cart.data?.total ?? '0.00')
  return (
    <button
      type="button"
      className="group/cart flex h-11 items-center gap-3 rounded-md pr-2 pl-1 text-sf-heading transition hover:bg-sf-canvas"
      aria-label={t('theme.header.cartWithTotal', { items: t('common.items', { count: Number(count) }), total })}
      aria-haspopup="dialog"
      onClick={() => drawer?.open()}
      data-testid="cart-total-button"
    >
      <span className="relative grid size-10 place-items-center group-hover/cart:text-sf-accent">
        <ShoppingBagIcon aria-hidden className="size-6" />
        {showCount && <CountBadge count={count} testId="cart-count" />}
      </span>
      <span aria-hidden className="flex flex-col items-start leading-tight">
        <span className="text-[0.7rem] font-medium tracking-wide text-sf-text uppercase">{t('common.cart')}</span>
        <span className="text-sm font-bold tabular-nums" data-testid="cart-total">{total}</span>
      </span>
    </button>
  )
}
