import { circle, rect, type IconDrawing } from './shapes'

/* Offers: sale tags, percentages, coupons, flash deals, gifts, hot items. */
export const OFFER_ICONS = {
  sale_tag: ['M6 8a2 2 0 0 1 2-2h14l20 20-16 16L6 22z', circle(14, 14, 3), 'M20 30l10-10'],
  percent: ['M12 36L36 12', circle(14, 14, 5), circle(34, 34, 5)],
  coupon: [
    'M4 14a2 2 0 0 1 2-2h36a2 2 0 0 1 2 2v6a4 4 0 0 0 0 8v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a4 4 0 0 0 0-8z',
    'M30 14v3',
    'M30 22v4',
    'M30 31v3',
    'M12 29l8-10',
    circle(12.5, 20, 1.5),
    circle(19.5, 28, 1.5),
  ],
  flash: ['M27 4L10 27h12l-3 17 19-24H26z'],
  gift: [rect(6, 14, 36, 8, 2), rect(9, 22, 30, 20, 2), 'M24 14v28', 'M24 14c-2-5-10-8-11-3s7 3 11 3c4 0 12 2 11-3s-9-2-11 3'],
  fire: ['M24 44c-8 0-14-6-14-14 0-7 5-11 7-17 3 3 4 6 4 9 3-3 5-8 4-14 7 4 13 12 13 22 0 8-6 14-14 14z', 'M24 44c-3 0-6-2-6-6 0-3 2-5 4-8 1 2 3 3 4 4 2 1 4 3 4 5 0 3-3 5-6 5z'],
} satisfies Record<string, IconDrawing>
