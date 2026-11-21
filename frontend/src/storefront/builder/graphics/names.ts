/*
 * B20 animated graphics: the names of the animated icon set and of the illustrations (contract
 * §1 `animated_icon.name` / `illustration.name`) — the same lists, in the same (group) order, as the
 * backend's registry. The drawings themselves live in lazy chunks (./icons/*, ./illustrations/*);
 * this module stays tiny because validate.ts (in the storefront entry) reads it. Groups and en + bn
 * search keywords for the editor's picker: ./icon-catalog.ts.
 */

export const ANIMATED_ICON_NAMES = [
  // Delivery
  'delivery_truck',
  'delivery_van',
  'rickshaw_van',
  'motorbike_delivery',
  'parcel',
  'parcel_open',
  'location_pin',
  'map',
  // Payment
  'cash_on_delivery',
  'mobile_wallet',
  'card_payment',
  'secure_payment',
  'shield_check',
  // Returns
  'return_box',
  'refund',
  'exchange',
  'warranty',
  'quality_badge',
  'check_circle',
  // Offers
  'sale_tag',
  'percent',
  'coupon',
  'flash',
  'gift',
  'fire',
  // Time
  'clock',
  'calendar',
  'hourglass',
  // Contact
  'phone',
  'chat',
  'whatsapp_bubble',
  'mail',
  'headset',
  // Shopping
  'store',
  'shopping_bag',
  'cart',
  'basket',
  // Praise
  'star',
  'heart',
  'thumbs_up',
  'smile',
  'users',
  'trophy',
  'sparkle',
  'rocket',
  // Nature & handmade
  'leaf',
  'organic',
  'handmade',
] as const

export type AnimatedIconName = (typeof ANIMATED_ICON_NAMES)[number]

export function isAnimatedIconName(value: unknown): value is AnimatedIconName {
  return typeof value === 'string' && (ANIMATED_ICON_NAMES as readonly string[]).includes(value)
}

export const ILLUSTRATION_NAMES = ['delivery_scene', 'shopping_bag_pop', 'sale_tag_swing', 'gift_unwrap', 'phone_order', 'parcel_journey', 'happy_shopper', 'eid_lanterns'] as const

export type IllustrationName = (typeof ILLUSTRATION_NAMES)[number]

export function isIllustrationName(value: unknown): value is IllustrationName {
  return typeof value === 'string' && (ILLUSTRATION_NAMES as readonly string[]).includes(value)
}
