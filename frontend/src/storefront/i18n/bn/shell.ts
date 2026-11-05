import type { Translations } from '../types'
import type { shell as en } from '../en/shell'

export const shell: Translations<typeof en> = {
  'shell.preview.ribbon': 'প্রিভিউ — এই স্টোরটি এখনো ক্রেতাদের জন্য চালু হয়নি।',

  'shell.search.form': 'পণ্য',
  'shell.search.label': 'পণ্য খুঁজুন',
  'shell.search.placeholder': 'পণ্য খুঁজুন…',
  'shell.search.submit': 'খুঁজুন',
  'shell.search.suggestions': 'পরামর্শ',
  'shell.search.products': 'পণ্য',
  'shell.search.categories': 'ক্যাটাগরি',
  'shell.search.searchFor': '“{term}” খুঁজুন',
  'shell.search.noMatches': 'মিলে যাওয়া কোনো পণ্য পাওয়া যায়নি।',
  'shell.search.searching': 'খোঁজা হচ্ছে…',
  'shell.search.noSuggestions': 'কোনো পরামর্শ নেই',
  'shell.search.available': { one: '{count}টি পরামর্শ পাওয়া গেছে', other: '{count}টি পরামর্শ পাওয়া গেছে' },

  'shell.nav.main': 'প্রধান মেনু',

  'shell.footer.paymentMethods': 'পেমেন্ট পদ্ধতি',
  'shell.footer.contactUs': 'যোগাযোগ করুন',
  'shell.footer.social': 'সোশ্যাল মিডিয়া',
  'shell.footer.newTab': '(নতুন ট্যাবে খুলবে)',
  'shell.footer.copyright': '© {year} {store}',

  'shell.contact.form': 'যোগাযোগ ফর্ম',
  'shell.contact.name': 'আপনার নাম',
  'shell.contact.email': 'ই-মেইল',
  'shell.contact.phone': 'ফোন (ঐচ্ছিক)',
  'shell.contact.subject': 'বিষয় (ঐচ্ছিক)',
  'shell.contact.message': 'বার্তা',
  'shell.contact.website': 'ওয়েবসাইট',
  'shell.contact.nameRequired': 'অনুগ্রহ করে আপনার নাম লিখুন।',
  'shell.contact.emailInvalid': 'অনুগ্রহ করে একটি সঠিক ই-মেইল ঠিকানা লিখুন।',
  'shell.contact.messageTooShort': 'অনুগ্রহ করে অন্তত {min}টি অক্ষর লিখুন।',
  'shell.contact.sending': 'পাঠানো হচ্ছে…',
  'shell.contact.send': 'বার্তা পাঠান',
  'shell.contact.sendAnother': 'আরেকটি বার্তা পাঠান',
}
