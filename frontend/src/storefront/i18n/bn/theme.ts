import type { Translations } from '../types'
import type { theme as en } from '../en/theme'

export const theme: Translations<typeof en> = {
  'theme.ticker.label': 'ঘোষণা',
  'theme.ticker.pause': 'ঘোষণা থামান',
  'theme.ticker.play': 'ঘোষণা চালু করুন',

  'theme.topBar.label': 'স্টোরের লিংক',

  'theme.header.searchTitle': 'স্টোরে খুঁজুন',
  'theme.header.cartWithTotal': 'কার্ট, {items}, {total}',

  'theme.footer.about': 'আমাদের সম্পর্কে',
  'theme.footer.follow': 'আমাদের অনুসরণ করুন',
  'theme.footer.popular': 'জনপ্রিয়',
  'theme.footer.new': 'নতুন পণ্য',
  'theme.footer.bestSelling': 'সর্বাধিক বিক্রিত',
  'theme.footer.topRated': 'সেরা রেটিং',
  'theme.footer.latestPosts': 'সাম্প্রতিক লেখা',
  'theme.footer.newsletter': 'নিউজলেটার',
  'theme.footer.newsletterText': 'অফার ও খবর সরাসরি আপনার ইনবক্সে।',
  'theme.footer.subscribe': 'সাবস্ক্রাইব করুন',

  'theme.hero.shopNow': 'এখনই কিনুন',
}
