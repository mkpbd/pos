import { circle, rect, star, type IconDrawing } from './shapes'

/* Praise & celebration: ratings, love, approval, happy customers, winners, launches. */
export const PRAISE_ICONS = {
  star: [star(24, 25, 19, 8)],
  heart: ['M24 41S6 30 6 17a9 9 0 0 1 18-3 9 9 0 0 1 18 3c0 13-18 24-18 24z'],
  thumbs_up: [rect(6, 22, 8, 20, 2), 'M14 22l7-14a4 4 0 0 1 5 4l-2 8h12a4 4 0 0 1 4 5l-3 13a4 4 0 0 1-4 4H14'],
  smile: [circle(24, 24, 18), 'M16 28a10 10 0 0 0 16 0', 'M18 19v2', 'M30 19v2'],
  users: [circle(18, 16, 6), 'M6 40v-2a10 10 0 0 1 10-10h4a10 10 0 0 1 10 10v2', circle(34, 16, 5), 'M33 28h1a8 8 0 0 1 8 8v4'],
  trophy: ['M14 6h20v12a10 10 0 0 1-20 0z', 'M14 10H8v3a6 6 0 0 0 6 6', 'M34 10h6v3a6 6 0 0 1-6 6', 'M24 28v8', rect(16, 36, 16, 6, 1)],
  sparkle: ['M22 6c1 9 5 13 14 14-9 1-13 5-14 14-1-9-5-13-14-14 9-1 13-5 14-14z', 'M38 30c.4 3 1.6 4.6 4 5-2.4.4-3.6 2-4 5-.4-3-1.6-4.6-4-5 2.4-.4 3.6-2 4-5z'],
  rocket: ['M24 4c7 5 10 13 8 24H16C14 17 17 9 24 4z', circle(24, 16, 3), 'M16 26l-6 6v6l8-4', 'M32 26l6 6v6l-8-4', 'M20 34c0 4 2 7 4 10 2-3 4-6 4-10'],
} satisfies Record<string, IconDrawing>
