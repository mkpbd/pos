import type { Translations } from '../types'
import type { demos as en } from '../en/demos'

export const demos: Translations<typeof en> = {
  'demos.title': 'অনলাইন স্টোর ডেমো',
  'demos.intro': 'তৈরি ডেমো স্টোর, প্রতিটি নিজস্ব থিমে: একটি খুলে ক্যাটালগ দেখুন, কার্ট ব্যবহার করুন এবং একটি পরীক্ষামূলক অর্ডার দিন।',
  'demos.adminHint': 'কোনো ডেমো পরিচালনা করতে সেটআপ গাইডে দেওয়া মালিকের অ্যাকাউন্ট দিয়ে অ্যাডমিনে সাইন ইন করুন। লগইনের তথ্য এখানে দেখানো হয় না।',
  'demos.list': 'ডেমো স্টোর',
  'demos.loading': 'ডেমো স্টোরগুলো লোড হচ্ছে',
  'demos.errorTitle': 'ডেমো স্টোরগুলো লোড করা যায়নি',
  'demos.errorText': 'আপনার ইন্টারনেট সংযোগ যাচাই করে আবার চেষ্টা করুন।',
  'demos.disabled': 'এই সার্ভারে ডেমো গ্যালারি চালু করা নেই।',
  'demos.empty': 'এখনো কোনো ডেমো স্টোর সেট আপ করা হয়নি। চালান: {command}।',

  'demos.preset': 'থিম: {preset}',
  'demos.preset.default': 'ডিফল্ট',
  'demos.preset.vegan': 'ভিগান',
  'demos.preset.handmade': 'হ্যান্ডমেড',
  'demos.preset.classic': 'ক্লাসিক',

  'demos.colors': 'থিমের রং',
  'demos.color.primary': 'প্রধান রং {value}',
  'demos.color.accent': 'অ্যাকসেন্ট রং {value}',
  'demos.color.canvas': 'পটভূমির রং {value}',
  'demos.categories': 'ক্যাটাগরি',
  'demos.products': { one: '{count}টি পণ্য', other: '{count}টি পণ্য' },

  'demos.openStore': 'স্টোর খুলুন',
  'demos.openStoreLabel': 'স্টোর খুলুন: {store}',
  'demos.openAdmin': 'অ্যাডমিন খুলুন',
  'demos.openAdminLabel': 'অ্যাডমিন খুলুন: {store}',
}
