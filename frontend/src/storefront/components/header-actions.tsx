import { Link } from 'react-router'
import { HeartIcon, ShoppingBagIcon, UserIcon } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import { useCustomer, useLogoutMutation } from '../account/api'
import { useCartQuery } from '../cart/api'
import { useCartDrawer } from '../cart/cart-drawer-context'
import { displayQuantity } from '../cart/quantity'
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


/** Account, wishlist and cart in the header row, on every screen size. */
export function HeaderActions() {
  return (
    <div className="flex items-center gap-0.5 sm:gap-1">
      <AccountMenu />
      <WishlistLink />
      <CartButton />
    </div>
  )
}

function AccountMenu() {
  const customer = useCustomer()
  const logout = useLogoutMutation()
  const notify = useNotice()
  const { t } = useLocale()

  if (!customer) {
    return (
      <Link to="/account/login" className={cn(iconButton, 'lg:flex lg:w-auto lg:gap-2 lg:px-2')} aria-label={t('common.account.signIn')}>
        <UserIcon aria-hidden className="size-6" />
        <span aria-hidden className="hidden text-sm font-semibold lg:inline">{t('common.account.signIn')}</span>
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
      <DropdownMenuTrigger className={cn(iconButton, 'lg:flex lg:w-auto lg:gap-2 lg:px-2')} aria-label={t('common.account.myAccount')}>
        <UserIcon aria-hidden className="size-6" />
        <span aria-hidden className="hidden max-w-32 truncate text-sm font-semibold lg:inline">{first}</span>
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

function WishlistLink() {
  const wishlist = useWishlist()
  const { t } = useLocale()
  const count = String(wishlist.count)
  return (
    <Link to="/wishlist" className={iconButton} aria-label={count === '0' ? t('common.wishlist') : t('common.wishlistWithCount', { items: t('common.items', { count: Number(count) }) })}>
      <HeartIcon aria-hidden className="size-6" />
      <CountBadge count={count} testId="wishlist-count" />
    </Link>
  )
}

function CartButton() {
  const cart = useCartQuery()
  const drawer = useCartDrawer()
  const { t } = useLocale()
  const count = cart.data ? displayQuantity(cart.data.item_count) : '0'
  return (
    <button type="button" className={iconButton} aria-label={count === '0' ? t('common.cart') : t('common.cartWithCount', { items: t('common.items', { count: Number(count) }) })} aria-haspopup="dialog" onClick={() => drawer?.open()}>
      <ShoppingBagIcon aria-hidden className="size-6" />
      <CountBadge count={count} testId="cart-count" />
    </button>
  )
}
