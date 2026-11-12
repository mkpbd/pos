import type { B4Element } from '../types'

export type B4Type = B4Element['type']

/** The B4 element types (contract §2). */
export const B4_TYPES = [
  'video',
  'icon',
  'countdown',
  'discount',
  'cta',
  'search_box',
  'promo_card',
  'logo',
  'menu',
  'account_link',
  'wishlist_link',
  'cart_icon',
  'language_switch',
  'announcement',
  'social_icons',
  'payment_icons',
  'contact_block',
  'copyright',
  'newsletter_form',
  'faq_list',
  'contact_form',
  'custom_html',
] as const satisfies readonly B4Type[]

export function isB4Type(type: string): type is B4Type {
  return (B4_TYPES as readonly string[]).includes(type)
}
