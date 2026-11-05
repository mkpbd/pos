import type { Messages } from '../types'

/** Popup banner and promotion countdowns. */
export const promo = {
  'promo.popup.specialOffer': 'Special offer',
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
