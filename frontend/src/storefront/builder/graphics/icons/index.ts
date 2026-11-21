import type { AnimatedIconName } from '../names'
import { CONTACT_ICONS } from './contact'
import { DELIVERY_ICONS } from './delivery'
import { NATURE_ICONS } from './nature'
import { OFFER_ICONS } from './offers'
import { PAYMENT_ICONS } from './payment'
import { PRAISE_ICONS } from './praise'
import { RETURNS_ICONS } from './returns'
import { SHOPPING_ICONS } from './shopping'
import type { IconDrawing } from './shapes'
import { TIME_ICONS } from './time'

/*
 * The B20 animated icon set: original line drawings (48 × 48, 2-unit round strokes), one entry per
 * ANIMATED_ICON_NAMES. Only the lazy animated-icon chunk imports this module, so the drawings
 * never enter the storefront entry. `satisfies` keeps the set and the name list in step.
 */
export const ANIMATED_ICONS = {
  ...DELIVERY_ICONS,
  ...PAYMENT_ICONS,
  ...RETURNS_ICONS,
  ...OFFER_ICONS,
  ...TIME_ICONS,
  ...CONTACT_ICONS,
  ...SHOPPING_ICONS,
  ...PRAISE_ICONS,
  ...NATURE_ICONS,
} satisfies Record<AnimatedIconName, IconDrawing>

export type { IconDrawing }
