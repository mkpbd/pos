import { circle, type IconDrawing } from './shapes'

/* Nature & handmade: fresh, organic, crafted by hand (a spool of thread and a needle). */
export const NATURE_ICONS = {
  leaf: ['M8 40C8 20 20 8 40 8c0 20-12 32-32 32z', 'M8 40L28 20'],
  organic: [circle(24, 24, 18), 'M24 36V22', 'M24 27c-6 0-9-4-9-9 6 0 9 4 9 9z', 'M24 22c0-5 3-8 8-8 0 5-3 8-8 8z'],
  handmade: ['M8 8h20', 'M8 40h20', 'M11 8v32', 'M25 8v32', 'M11 15l14 4', 'M11 23l14 4', 'M11 31l14 4', 'M25 36c5 5 11 3 12-3', 'M36 40l7-34', 'M41 9.5l1-3'],
} satisfies Record<string, IconDrawing>
