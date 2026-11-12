import type { Messages } from '../types'

/** Popup banner and promotion countdowns. */
export const promo = {
  'promo.popup.specialOffer': 'Special offer',
  /** B8b builder popups: the name of a bar without its own, the close button, the draft preview note. */
  'promo.popup.bar': 'Store notice',
  'promo.popup.close': 'Close',
  'promo.popup.preview': 'Draft popup preview — shown at once, whatever its trigger, schedule and rules.',
  'promo.countdown.endsIn': 'Ends in',
  'promo.countdown.ends': 'Ends {date}',
  'promo.countdown.day': 'Day',
  'promo.countdown.days': 'Days',
  'promo.countdown.hours': 'Hours',
  'promo.countdown.mins': 'Mins',
  'promo.countdown.secs': 'Secs',
  /** After the day count in the compact clock ("2d 05:04:03"). */
  'promo.countdown.daySuffix': 'd',
} as const satisfies Messages
