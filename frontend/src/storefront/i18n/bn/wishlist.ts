import type { Translations } from '../types'
import type { wishlist as en } from '../en/wishlist'

export const wishlist: Translations<typeof en> = {
  'wishlist.title': 'উইশলিস্ট',
  'wishlist.localNote': 'আপনার উইশলিস্ট এই ব্রাউজারে সংরক্ষিত আছে। আপনার অ্যাকাউন্টে রাখতে {signIn} করুন।',
  'wishlist.signIn': 'সাইন ইন',
  'wishlist.loadFailed': 'আপনার উইশলিস্ট লোড করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।',
  'wishlist.loading': 'আপনার উইশলিস্ট লোড হচ্ছে',
  'wishlist.empty': 'আপনার উইশলিস্ট খালি।',
  'wishlist.emptyHint': 'পরে কেনার জন্য পণ্যের হার্ট চিহ্নে ট্যাপ করে সংরক্ষণ করুন।',
  'wishlist.startShopping': 'কেনাকাটা শুরু করুন',
  'wishlist.savedProducts': 'সংরক্ষিত পণ্য',
  'wishlist.updateFailed': 'উইশলিস্ট আপডেট করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।',
  'wishlist.full': 'আপনার উইশলিস্ট পূর্ণ ({max}টি পণ্য)। আরও যোগ করতে কিছু সরিয়ে দিন।',
  'wishlist.moveToCartLabel': '{name} কার্টে নিন',
  'wishlist.moveToCart': 'কার্টে নিন',
  'wishlist.chooseOptionsLabel': 'অপশন বেছে নিন: {name}',
  'wishlist.chooseOptions': 'অপশন বেছে নিন',
  'wishlist.removeLabel': '{name} সরিয়ে দিন',
  'wishlist.remove': 'সরিয়ে দিন',

  'wishlist.button.addLabel': '{name} উইশলিস্টে যোগ করুন',
  'wishlist.button.removeLabel': '{name} উইশলিস্ট থেকে সরান',
  'wishlist.button.add': 'উইশলিস্টে যোগ করুন',
  'wishlist.button.saved': 'উইশলিস্টে সংরক্ষিত',
  'wishlist.button.removeTitle': 'উইশলিস্ট থেকে সরান',
}
