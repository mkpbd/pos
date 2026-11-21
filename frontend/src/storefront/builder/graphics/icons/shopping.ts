import { circle, type IconDrawing } from './shapes'

/* Shopping: the shop, bags, carts and baskets. */
export const SHOPPING_ICONS = {
  store: ['M6 18l3-10h30l3 10', 'M6 18a4.5 4.5 0 0 0 9 0a4.5 4.5 0 0 0 9 0a4.5 4.5 0 0 0 9 0a4.5 4.5 0 0 0 9 0', 'M9 24v18h30V24', 'M20 42V32h8v10'],
  shopping_bag: ['M10 16h28l-2 26H12z', 'M18 20v-6a6 6 0 0 1 12 0v6'],
  cart: ['M4 8h6l5 22h22l5-15H12', circle(18, 38, 3), circle(34, 38, 3)],
  basket: ['M4 20h40', 'M8 20l4 20h24l4-20', 'M14 20l7-12', 'M34 20l-7-12', 'M20 26v8', 'M28 26v8'],
} satisfies Record<string, IconDrawing>
