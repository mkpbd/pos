import { account } from './en/account'
import { blog } from './en/blog'
import { cart } from './en/cart'
import { catalog } from './en/catalog'
import { checkout } from './en/checkout'
import { common } from './en/common'
import { content } from './en/content'
import { orders } from './en/orders'
import { promo } from './en/promo'
import { reviews } from './en/reviews'
import { shell } from './en/shell'
import { theme } from './en/theme'
import { wishlist } from './en/wishlist'

/**
 * The English storefront dictionary (ADR-011): one namespace file per area under ./en, keys
 * prefixed with the namespace ("cart.title"). English ships in the entry bundle; Bangla (./bn.ts)
 * is fetched when the store is shown in Bangla.
 */
export const en = {
  ...common,
  ...shell,
  ...content,
  ...blog,
  ...promo,
  ...catalog,
  ...reviews,
  ...wishlist,
  ...cart,
  ...checkout,
  ...account,
  ...orders,
  ...theme,
}

export type MessageKey = keyof typeof en
