import type { Translations } from '../types'
import type { promo as en } from '../en/promo'

export const promo: Translations<typeof en> = {
  'promo.popup.specialOffer': 'বিশেষ অফার',
  'promo.countdown.endsIn': 'শেষ হতে বাকি',
  'promo.countdown.ends': 'শেষ হবে {date}',
  'promo.countdown.day': 'দিন',
  'promo.countdown.days': 'দিন',
  'promo.countdown.hours': 'ঘণ্টা',
  'promo.countdown.mins': 'মিনিট',
  'promo.countdown.secs': 'সেকেন্ড',
  'promo.countdown.daySuffix': ' দিন',
}
