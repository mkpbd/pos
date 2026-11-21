import { circle, rect, type IconDrawing } from './shapes'

/* Payment: cash on delivery, a generic mobile wallet (never a wallet brand's mark), cards, secure pay, protection. */
export const PAYMENT_ICONS = {
  cash_on_delivery: [rect(10, 6, 28, 16, 3), circle(24, 14, 3.5), 'M15 14h1', 'M32 14h1', 'M4 28h6v14H4', 'M10 30h8a4 4 0 0 1 4 4h-8', 'M10 40h14l14-8a3 3 0 0 0-3-5l-9 5'],
  mobile_wallet: [rect(10, 4, 22, 40, 4), 'M18 9h6', circle(21, 23, 6), 'M21 20v6', 'M18 23h6', 'M18 38h6', 'M36 11a6 6 0 0 1 4 4', 'M36 4a13 13 0 0 1 8 8'],
  card_payment: [rect(4, 10, 40, 28, 4), 'M4 18h40', 'M10 30h8', 'M24 30h4'],
  secure_payment: [rect(4, 8, 28, 18, 3), 'M4 14h28', 'M9 21h6', 'M37 24l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9v-6z', 'M34 33l2 2 4-4'],
  shield_check: ['M24 4l16 6v12c0 10-7 18-16 22-9-4-16-12-16-22V10z', 'M17 24l5 5 9-10'],
} satisfies Record<string, IconDrawing>
