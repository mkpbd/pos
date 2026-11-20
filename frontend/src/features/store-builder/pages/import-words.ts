import { formatNumber, type ScreenLang } from './messages'

/*
 * B16 §4: the words of the "Import a page…" dialog of the Pages list, in English and Bangla
 * (the start screen's language). Kept apart from messages.ts so the dialog is one self-contained
 * part. Keys ending in `.one` / `.other` are a count's two forms; `{name}` placeholders are filled
 * and numbers written in the language's digits.
 */

const en = {
  open: 'Import a page…',
  title: 'Import a page',
  intro: 'Bring in a page copy (.json) made with “Download a copy” in the page builder — from this shop or another one. It comes in as a draft; nothing is published.',
  fileLabel: 'Page copy file (.json)',
  fileHelp: 'Up to 30 MB. Pictures come into your media library; products, categories and brands are matched by SKU or address in this shop.',
  reading: 'Reading the file…',
  'problem.notJson': 'This file can’t be read. Choose the .json file you downloaded with “Download a copy”.',
  'problem.notCopy': 'This isn’t a page copy. Choose a .json file made with “Download a copy” in the page builder.',
  'problem.newerVersion': 'This copy was made by a newer version of the page builder and can’t be imported here yet.',
  'problem.tooLarge': 'This file is bigger than 30 MB.',
  'problem.theme': 'A theme can’t be imported here.',
  'problem.noFile': 'Choose a file first.',
  fileFrom: 'From {store}',
  fileDate: 'downloaded {date}',
  filePictures: { one: '{count} picture', other: '{count} pictures' },
  fileProducts: { one: '{count} product', other: '{count} products' },
  'kind.page': 'Home page',
  'kind.landing': 'Campaign page',
  'kind.cms': 'Content page',
  'kind.header': 'Header',
  'kind.footer': 'Footer',
  'kind.zone': 'Shop page area',
  'kind.popup': 'Popup or bar',
  'kind.global': 'Global section',
  'kind.template': 'Store page design',
  targetLegend: 'Where should it go?',
  'target.new': 'As a new campaign page',
  'target.newHelp': 'A new page at its own address. Your other pages stay as they are.',
  'target.replace': 'Over the draft of a page you have',
  'target.replaceHelp': 'Only the draft changes: shoppers keep seeing the published page until you publish.',
  'target.replaceNone': 'You have no {kind} to replace yet.',
  'target.newNotPossible': 'Only pages can become a new campaign page; this copy can replace the draft of one of yours.',
  pageLabel: 'Page to replace',
  pagePlaceholder: 'Choose a page',
  pageProblem: 'Choose the page whose draft should be replaced.',
  replaceWarning: 'The current draft of “{name}” is replaced by the copy. Unpublished changes in it are lost.',
  submit: 'Import',
  importing: 'Importing…',
  'error.invalid': 'This file can’t be imported. Choose a .json file made with “Download a copy” in the page builder.',
  'error.reason': 'What the shop said: {reason}',
  'error.tooLarge': 'This file is bigger than 30 MB, or its pictures are too large.',
  'error.kindMismatch': 'This copy is a different kind of page. Choose a page of the same kind.',
  'error.conflict': 'Someone changed that page while you were choosing. The list is up to date now: try again.',
  'error.locked': '{name} is editing that page right now. Try again when they are done.',
  'error.lockedSomeone': 'Someone is editing that page right now. Try again when they are done.',
  // Report
  'done.new': '“{name}” is ready as a draft',
  'done.replace': 'The draft of “{name}” was replaced',
  'done.notPublished': 'Nothing is published. Shoppers see it only after you publish it.',
  'done.mapped': 'Brought over',
  'done.mappedNone': 'The page has only text and design: nothing needed to be matched.',
  'mapped.media': { one: '{count} picture, in your media library', other: '{count} pictures, in your media library' },
  'mapped.products': { one: '{count} product found in this shop', other: '{count} products found in this shop' },
  'mapped.categories': { one: '{count} category found', other: '{count} categories found' },
  'mapped.brands': { one: '{count} brand found', other: '{count} brands found' },
  'mapped.banners': { one: '{count} banner added', other: '{count} banners added' },
  'mapped.menus': { one: '{count} menu found', other: '{count} menus found' },
  'mapped.blog_categories': { one: '{count} blog category found', other: '{count} blog categories found' },
  'mapped.promotions': { one: '{count} promotion found', other: '{count} promotions found' },
  'done.missing': 'Not in this shop',
  'done.missingHelp': 'The page shows without these. Add them to your shop, then choose them in the editor.',
  'missing.product': 'Product',
  'missing.category': 'Category',
  'missing.brand': 'Brand',
  'missing.menu': 'Menu',
  'missing.blog_category': 'Blog category',
  'missing.promotion': 'Promotion',
  'missing.media': 'Picture',
  'missing.other': 'Item',
  'missing.noName': '(no name)',
  'done.dropped': 'Left out',
  'done.droppedHelp': 'These parts can’t be used on this kind of page or in this shop, so they were left out.',
  droppedCount: '{name} × {count}',
  'done.allGood': 'Everything in the copy was brought over.',
  'done.open': 'Open in the editor',
  'done.close': 'Close',
}

type Words = typeof en
type Forms = { one: string; other: string }
export type ImportWordKey = { [K in keyof Words]: Words[K] extends string ? K : never }[keyof Words]
export type ImportCountKey = { [K in keyof Words]: Words[K] extends Forms ? K : never }[keyof Words]

const bn: Words = {
  open: 'একটি পেজ আনুন…',
  title: 'একটি পেজ আনুন',
  intro: 'পেজ বিল্ডারের “কপি ডাউনলোড করুন” দিয়ে বানানো পেজের কপি (.json) আনুন — এই দোকান বা অন্য দোকান থেকে। এটি খসড়া হিসেবে আসবে; কিছুই প্রকাশ হবে না।',
  fileLabel: 'পেজ কপির ফাইল (.json)',
  fileHelp: '৩০ MB পর্যন্ত। ছবিগুলো আপনার মিডিয়া লাইব্রেরিতে আসবে; পণ্য, ক্যাটাগরি ও ব্র্যান্ড এই দোকানে SKU বা ঠিকানা দিয়ে মেলানো হবে।',
  reading: 'ফাইলটি পড়া হচ্ছে…',
  'problem.notJson': 'ফাইলটি পড়া যাচ্ছে না। “কপি ডাউনলোড করুন” দিয়ে নামানো .json ফাইলটি বেছে নিন।',
  'problem.notCopy': 'এটি পেজের কপি নয়। পেজ বিল্ডারের “কপি ডাউনলোড করুন” দিয়ে বানানো .json ফাইল বেছে নিন।',
  'problem.newerVersion': 'এই কপিটি পেজ বিল্ডারের নতুন সংস্করণে বানানো, তাই এখানে এখনো আনা যাবে না।',
  'problem.tooLarge': 'ফাইলটি ৩০ MB-এর চেয়ে বড়।',
  'problem.theme': 'থিম এখানে আনা যায় না।',
  'problem.noFile': 'আগে একটি ফাইল বেছে নিন।',
  fileFrom: '{store} থেকে',
  fileDate: '{date} তারিখে নামানো',
  filePictures: { one: '{count}টি ছবি', other: '{count}টি ছবি' },
  fileProducts: { one: '{count}টি পণ্য', other: '{count}টি পণ্য' },
  'kind.page': 'হোম পেজ',
  'kind.landing': 'ক্যাম্পেইন পেজ',
  'kind.cms': 'কনটেন্ট পেজ',
  'kind.header': 'হেডার',
  'kind.footer': 'ফুটার',
  'kind.zone': 'দোকানের পেজের অংশ',
  'kind.popup': 'পপআপ বা বার',
  'kind.global': 'গ্লোবাল সেকশন',
  'kind.template': 'দোকানের পেজের ডিজাইন',
  targetLegend: 'কোথায় যাবে?',
  'target.new': 'নতুন ক্যাম্পেইন পেজ হিসেবে',
  'target.newHelp': 'নিজস্ব ঠিকানায় একটি নতুন পেজ। আপনার অন্য পেজগুলো যেমন আছে তেমনই থাকবে।',
  'target.replace': 'আপনার একটি পেজের খসড়ার জায়গায়',
  'target.replaceHelp': 'শুধু খসড়া বদলাবে: আপনি প্রকাশ না করা পর্যন্ত ক্রেতারা প্রকাশিত পেজটিই দেখবেন।',
  'target.replaceNone': 'বদলানোর মতো কোনো {kind} এখনো নেই।',
  'target.newNotPossible': 'শুধু পেজ থেকেই নতুন ক্যাম্পেইন পেজ হয়; এই কপি আপনার একটির খসড়ার জায়গা নিতে পারে।',
  pageLabel: 'যে পেজ বদলাবেন',
  pagePlaceholder: 'একটি পেজ বেছে নিন',
  pageProblem: 'কোন পেজের খসড়া বদলাবে তা বেছে নিন।',
  replaceWarning: '“{name}”-এর এখনকার খসড়ার জায়গায় কপিটি বসবে। খসড়ার অপ্রকাশিত পরিবর্তনগুলো হারিয়ে যাবে।',
  submit: 'আনুন',
  importing: 'আনা হচ্ছে…',
  'error.invalid': 'ফাইলটি আনা যাচ্ছে না। পেজ বিল্ডারের “কপি ডাউনলোড করুন” দিয়ে বানানো .json ফাইল বেছে নিন।',
  'error.reason': 'দোকান যা বলেছে: {reason}',
  'error.tooLarge': 'ফাইলটি ৩০ MB-এর চেয়ে বড়, অথবা এর ছবিগুলো খুব বড়।',
  'error.kindMismatch': 'এই কপিটি অন্য ধরনের পেজ। একই ধরনের একটি পেজ বেছে নিন।',
  'error.conflict': 'আপনি বেছে নেওয়ার সময় কেউ পেজটি বদলেছেন। তালিকা এখন হালনাগাদ: আবার চেষ্টা করুন।',
  'error.locked': '{name} এখন পেজটি সম্পাদনা করছেন। তাঁর কাজ শেষ হলে আবার চেষ্টা করুন।',
  'error.lockedSomeone': 'কেউ এখন পেজটি সম্পাদনা করছেন। কাজ শেষ হলে আবার চেষ্টা করুন।',
  'done.new': '“{name}” খসড়া হিসেবে তৈরি',
  'done.replace': '“{name}”-এর খসড়া বদলানো হয়েছে',
  'done.notPublished': 'কিছুই প্রকাশ হয়নি। আপনি প্রকাশ করার পরেই ক্রেতারা এটি দেখবেন।',
  'done.mapped': 'যা আনা হয়েছে',
  'done.mappedNone': 'পেজে শুধু লেখা ও ডিজাইন আছে: কিছু মেলানোর দরকার হয়নি।',
  'mapped.media': { one: '{count}টি ছবি, আপনার মিডিয়া লাইব্রেরিতে', other: '{count}টি ছবি, আপনার মিডিয়া লাইব্রেরিতে' },
  'mapped.products': { one: 'এই দোকানে {count}টি পণ্য পাওয়া গেছে', other: 'এই দোকানে {count}টি পণ্য পাওয়া গেছে' },
  'mapped.categories': { one: '{count}টি ক্যাটাগরি পাওয়া গেছে', other: '{count}টি ক্যাটাগরি পাওয়া গেছে' },
  'mapped.brands': { one: '{count}টি ব্র্যান্ড পাওয়া গেছে', other: '{count}টি ব্র্যান্ড পাওয়া গেছে' },
  'mapped.banners': { one: '{count}টি ব্যানার যোগ হয়েছে', other: '{count}টি ব্যানার যোগ হয়েছে' },
  'mapped.menus': { one: '{count}টি মেনু পাওয়া গেছে', other: '{count}টি মেনু পাওয়া গেছে' },
  'mapped.blog_categories': { one: '{count}টি ব্লগ ক্যাটাগরি পাওয়া গেছে', other: '{count}টি ব্লগ ক্যাটাগরি পাওয়া গেছে' },
  'mapped.promotions': { one: '{count}টি প্রমোশন পাওয়া গেছে', other: '{count}টি প্রমোশন পাওয়া গেছে' },
  'done.missing': 'এই দোকানে নেই',
  'done.missingHelp': 'পেজটি এগুলো ছাড়াই দেখাবে। এগুলো দোকানে যোগ করুন, তারপর এডিটরে বেছে নিন।',
  'missing.product': 'পণ্য',
  'missing.category': 'ক্যাটাগরি',
  'missing.brand': 'ব্র্যান্ড',
  'missing.menu': 'মেনু',
  'missing.blog_category': 'ব্লগ ক্যাটাগরি',
  'missing.promotion': 'প্রমোশন',
  'missing.media': 'ছবি',
  'missing.other': 'জিনিস',
  'missing.noName': '(নাম নেই)',
  'done.dropped': 'বাদ দেওয়া হয়েছে',
  'done.droppedHelp': 'এই অংশগুলো এই ধরনের পেজে বা এই দোকানে ব্যবহার করা যায় না, তাই বাদ দেওয়া হয়েছে।',
  droppedCount: '{name} × {count}',
  'done.allGood': 'কপির সবকিছু আনা হয়েছে।',
  'done.open': 'এডিটরে খুলুন',
  'done.close': 'বন্ধ করুন',
}

const WORDS: Record<ScreenLang, Words> = { en, bn }

export type WordValues = Record<string, string | number>

function fill(lang: ScreenLang, text: string, values: WordValues): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name]
    if (value === undefined) return match
    return typeof value === 'number' ? formatNumber(lang, value) : value
  })
}

/** The dialog's words in the language. */
export function importWord(lang: ScreenLang, key: ImportWordKey, values: WordValues = {}): string {
  return fill(lang, (WORDS[lang][key] ?? en[key]) as string, values)
}

/** A count's form of the words (`{count}` filled in). */
export function importCount(lang: ScreenLang, key: ImportCountKey, count: number, values: WordValues = {}): string {
  const forms = (WORDS[lang][key] ?? en[key]) as Forms
  return fill(lang, count === 1 ? forms.one : forms.other, { ...values, count })
}

export const IMPORT_WORDS = WORDS
