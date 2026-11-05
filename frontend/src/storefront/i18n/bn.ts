import type { Translations } from './types'
import type { en } from './en'
import { account } from './bn/account'
import { blog } from './bn/blog'
import { cart } from './bn/cart'
import { catalog } from './bn/catalog'
import { checkout } from './bn/checkout'
import { common } from './bn/common'
import { content } from './bn/content'
import { orders } from './bn/orders'
import { promo } from './bn/promo'
import { reviews } from './bn/reviews'
import { shell } from './bn/shell'
import { wishlist } from './bn/wishlist'

/** The Bangla storefront dictionary: every English key (type-checked per namespace and here). */
export const bn: Translations<typeof en> = {
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
}
