import { circle, rect, type IconDrawing } from './shapes'

/* Time: opening hours, dates, limited-time offers. */
export const TIME_ICONS = {
  clock: [circle(24, 24, 18), 'M24 13v11l7 5'],
  calendar: [rect(6, 10, 36, 32, 3), 'M6 19h36', 'M15 6v8', 'M33 6v8', 'M18 30l4 4 8-8'],
  hourglass: ['M12 4h24', 'M12 44h24', 'M15 4c0 10 9 13 9 20s-9 10-9 20', 'M33 4c0 10-9 13-9 20s9 10 9 20', 'M19 40h10', 'M24 28v6'],
} satisfies Record<string, IconDrawing>
