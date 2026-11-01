import { Link } from 'react-router'
import { HeartIcon, ShoppingBagIcon, UserIcon } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useCustomer, useLogoutMutation } from '../account/api'
import { useCartQuery } from '../cart/api'
import { useCartDrawer } from '../cart/cart-drawer-context'
import { displayQuantity } from '../cart/quantity'
import { useNotice } from '../notices'
import { useWishlist } from '../wishlist/api'

const iconButton = 'relative grid size-10 place-items-center rounded-md text-sf-heading transition hover:bg-sf-canvas hover:text-sf-accent'

function CountBadge({ count, testId }: { count: string; testId: string }) {
  if (count === '0') return null
  return (
    <span aria-hidden className="absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-sf-accent px-1 text-[0.7rem] leading-none font-bold text-sf-accent-foreground" data-testid={testId}>
      {count.length > 4 ? '999+' : count}
    </span>
  )
}

const items = (count: string) => `${count} ${count === '1' ? 'item' : 'items'}`

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

  if (!customer) {
    return (
      <Link to="/account/login" className={cn(iconButton, 'lg:flex lg:w-auto lg:gap-2 lg:px-2')} aria-label="Sign in">
        <UserIcon aria-hidden className="size-6" />
        <span aria-hidden className="hidden text-sm font-semibold lg:inline">Sign in</span>
      </Link>
    )
  }

  const signOut = () =>
    logout.mutate(undefined, {
      onSuccess: () => notify('You are signed out.'),
      onError: () => notify('Signing out failed. Please try again.'),
    })

  const first = customer.name.split(/\s+/)[0] ?? customer.name

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className={cn(iconButton, 'lg:flex lg:w-auto lg:gap-2 lg:px-2')} aria-label="My account">
        <UserIcon aria-hidden className="size-6" />
        <span aria-hidden className="hidden max-w-32 truncate text-sm font-semibold lg:inline">{first}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 bg-sf-surface">
        <DropdownMenuLabel className="truncate text-sf-heading">{customer.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account">My account</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account/orders">Orders</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account/reviews">Reviews</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account/profile">Profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account/addresses">Addresses</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/wishlist">Wishlist</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={logout.isPending} onSelect={signOut}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function WishlistLink() {
  const wishlist = useWishlist()
  const count = String(wishlist.count)
  return (
    <Link to="/wishlist" className={iconButton} aria-label={count === '0' ? 'Wishlist' : `Wishlist, ${items(count)}`}>
      <HeartIcon aria-hidden className="size-6" />
      <CountBadge count={count} testId="wishlist-count" />
    </Link>
  )
}

function CartButton() {
  const cart = useCartQuery()
  const drawer = useCartDrawer()
  const count = cart.data ? displayQuantity(cart.data.item_count) : '0'
  return (
    <button type="button" className={iconButton} aria-label={count === '0' ? 'Cart' : `Cart, ${items(count)}`} aria-haspopup="dialog" onClick={() => drawer?.open()}>
      <ShoppingBagIcon aria-hidden className="size-6" />
      <CountBadge count={count} testId="cart-count" />
    </button>
  )
}
