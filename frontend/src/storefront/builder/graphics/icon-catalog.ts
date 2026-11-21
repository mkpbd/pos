import type { AnimatedIconName, IllustrationName } from './names'

/*
 * B20: the animated icon set as the editor's picker shows it — groups (the backend registry's keys
 * and order) and en + bn search keywords — and the illustrations' names. The backend registry
 * (`GET /storefront/builder/elements` → enums.animated_icon_groups / animated_icon_keywords /
 * illustration_labels) publishes the same; this copy is for code without the registry at hand.
 * Not imported by the storefront.
 */

export type IconGroupKey = 'delivery' | 'payment' | 'returns' | 'offers' | 'time' | 'contact' | 'shopping' | 'praise' | 'nature'

export type IconGroup = { key: IconGroupKey; label: string; label_bn: string; icons: readonly AnimatedIconName[] }

export const ICON_GROUPS: readonly IconGroup[] = [
  { key: 'delivery', label: 'Delivery', label_bn: 'ডেলিভারি', icons: ['delivery_truck', 'delivery_van', 'rickshaw_van', 'motorbike_delivery', 'parcel', 'parcel_open', 'location_pin', 'map'] },
  { key: 'payment', label: 'Payment', label_bn: 'পেমেন্ট', icons: ['cash_on_delivery', 'mobile_wallet', 'card_payment', 'secure_payment', 'shield_check'] },
  { key: 'returns', label: 'Returns & guarantees', label_bn: 'রিটার্ন ও গ্যারান্টি', icons: ['return_box', 'refund', 'exchange', 'warranty', 'quality_badge', 'check_circle'] },
  { key: 'offers', label: 'Offers', label_bn: 'অফার', icons: ['sale_tag', 'percent', 'coupon', 'flash', 'gift', 'fire'] },
  { key: 'time', label: 'Time', label_bn: 'সময়', icons: ['clock', 'calendar', 'hourglass'] },
  { key: 'contact', label: 'Contact', label_bn: 'যোগাযোগ', icons: ['phone', 'chat', 'whatsapp_bubble', 'mail', 'headset'] },
  { key: 'shopping', label: 'Shopping', label_bn: 'কেনাকাটা', icons: ['store', 'shopping_bag', 'cart', 'basket'] },
  { key: 'praise', label: 'Praise', label_bn: 'প্রশংসা', icons: ['star', 'heart', 'thumbs_up', 'smile', 'users', 'trophy', 'sparkle', 'rocket'] },
  { key: 'nature', label: 'Nature & handmade', label_bn: 'প্রাকৃতিক ও হাতে তৈরি', icons: ['leaf', 'organic', 'handmade'] },
]

export const ICON_KEYWORDS: Record<AnimatedIconName, { en: readonly string[]; bn: readonly string[] }> = {
  delivery_truck: { en: ['truck', 'delivery', 'shipping', 'lorry'], bn: ['ট্রাক', 'ডেলিভারি', 'পরিবহন'] },
  delivery_van: { en: ['van', 'delivery', 'courier', 'fast'], bn: ['ভ্যান', 'ডেলিভারি', 'কুরিয়ার'] },
  rickshaw_van: { en: ['rickshaw', 'van', 'local', 'cargo'], bn: ['রিকশা', 'ভ্যান', 'রিকশাভ্যান'] },
  motorbike_delivery: { en: ['bike', 'motorbike', 'rider', 'express'], bn: ['বাইক', 'মোটরসাইকেল', 'রাইডার'] },
  parcel: { en: ['parcel', 'box', 'package', 'order'], bn: ['পার্সেল', 'বাক্স', 'প্যাকেট'] },
  parcel_open: { en: ['unbox', 'open box', 'received', 'package'], bn: ['খোলা বাক্স', 'পার্সেল', 'আনবক্স'] },
  location_pin: { en: ['location', 'pin', 'address', 'place'], bn: ['ঠিকানা', 'লোকেশন', 'জায়গা'] },
  map: { en: ['map', 'area', 'coverage', 'route'], bn: ['মানচিত্র', 'ম্যাপ', 'এলাকা'] },
  cash_on_delivery: { en: ['cash', 'cash on delivery', 'cod', 'money'], bn: ['ক্যাশ অন ডেলিভারি', 'নগদ', 'টাকা'] },
  mobile_wallet: { en: ['mobile wallet', 'mobile banking', 'wallet', 'bkash', 'nagad'], bn: ['মোবাইল ব্যাংকিং', 'মোবাইল ওয়ালেট', 'বিকাশ', 'নগদ'] },
  card_payment: { en: ['card', 'credit card', 'debit', 'pay'], bn: ['কার্ড', 'ক্রেডিট কার্ড', 'পেমেন্ট'] },
  secure_payment: { en: ['secure', 'safe payment', 'protected', 'card'], bn: ['নিরাপদ পেমেন্ট', 'সুরক্ষিত', 'কার্ড'] },
  shield_check: { en: ['shield', 'secure', 'safe', 'trusted'], bn: ['নিরাপদ', 'সুরক্ষা', 'বিশ্বস্ত'] },
  return_box: { en: ['return', 'easy return', 'send back'], bn: ['রিটার্ন', 'ফেরত', 'সহজ রিটার্ন'] },
  refund: { en: ['refund', 'money back', 'repay'], bn: ['রিফান্ড', 'টাকা ফেরত'] },
  exchange: { en: ['exchange', 'swap', 'replace'], bn: ['এক্সচেঞ্জ', 'বদল', 'পরিবর্তন'] },
  warranty: { en: ['warranty', 'guarantee', 'certified'], bn: ['ওয়ারেন্টি', 'গ্যারান্টি'] },
  quality_badge: { en: ['quality', 'badge', 'premium', 'best'], bn: ['মান', 'কোয়ালিটি', 'সেরা'] },
  check_circle: { en: ['check', 'done', 'verified', 'ok'], bn: ['টিক', 'যাচাইকৃত', 'সম্পন্ন'] },
  sale_tag: { en: ['sale', 'tag', 'price', 'discount'], bn: ['সেল', 'ট্যাগ', 'দাম', 'ছাড়'] },
  percent: { en: ['percent', 'discount', 'off'], bn: ['শতাংশ', 'ছাড়', 'ডিসকাউন্ট'] },
  coupon: { en: ['coupon', 'voucher', 'code', 'ticket'], bn: ['কুপন', 'ভাউচার', 'কোড'] },
  flash: { en: ['flash', 'lightning', 'deal', 'fast'], bn: ['ফ্ল্যাশ', 'বিদ্যুৎ', 'দ্রুত'] },
  gift: { en: ['gift', 'present', 'bonus', 'free'], bn: ['উপহার', 'গিফট', 'ফ্রি'] },
  fire: { en: ['hot', 'fire', 'trending', 'popular'], bn: ['হট', 'আগুন', 'জনপ্রিয়'] },
  clock: { en: ['clock', 'time', 'hours'], bn: ['ঘড়ি', 'সময়', 'খোলার সময়'] },
  calendar: { en: ['calendar', 'date', 'schedule', 'booking'], bn: ['ক্যালেন্ডার', 'তারিখ', 'সময়সূচি'] },
  hourglass: { en: ['hourglass', 'limited time', 'wait', 'countdown'], bn: ['বালিঘড়ি', 'সীমিত সময়', 'অপেক্ষা'] },
  phone: { en: ['phone', 'call', 'hotline'], bn: ['ফোন', 'কল', 'হটলাইন'] },
  chat: { en: ['chat', 'message', 'talk'], bn: ['চ্যাট', 'মেসেজ', 'কথা'] },
  whatsapp_bubble: { en: ['whatsapp', 'messenger', 'chat', 'message'], bn: ['হোয়াটসঅ্যাপ', 'মেসেজ', 'চ্যাট'] },
  mail: { en: ['mail', 'email', 'letter', 'newsletter'], bn: ['ইমেইল', 'মেইল', 'চিঠি'] },
  headset: { en: ['support', 'help', 'customer care', 'headset'], bn: ['সাপোর্ট', 'সহায়তা', 'কাস্টমার কেয়ার'] },
  store: { en: ['store', 'shop', 'outlet'], bn: ['দোকান', 'স্টোর', 'শপ'] },
  shopping_bag: { en: ['bag', 'shopping', 'buy'], bn: ['ব্যাগ', 'শপিং', 'কেনাকাটা'] },
  cart: { en: ['cart', 'trolley', 'checkout'], bn: ['কার্ট', 'ট্রলি', 'অর্ডার'] },
  basket: { en: ['basket', 'grocery', 'market'], bn: ['ঝুড়ি', 'বাজার', 'মুদি'] },
  star: { en: ['star', 'rating', 'review', 'favourite'], bn: ['তারা', 'রেটিং', 'রিভিউ'] },
  heart: { en: ['heart', 'love', 'like', 'wishlist'], bn: ['হৃদয়', 'ভালোবাসা', 'পছন্দ'] },
  thumbs_up: { en: ['thumbs up', 'like', 'approve', 'good'], bn: ['লাইক', 'ভালো', 'সমর্থন'] },
  smile: { en: ['smile', 'happy', 'satisfied'], bn: ['হাসি', 'খুশি', 'সন্তুষ্ট'] },
  users: { en: ['people', 'customers', 'team', 'community'], bn: ['মানুষ', 'গ্রাহক', 'টিম'] },
  trophy: { en: ['trophy', 'award', 'winner', 'best'], bn: ['ট্রফি', 'পুরস্কার', 'বিজয়ী'] },
  sparkle: { en: ['sparkle', 'new', 'shine', 'magic'], bn: ['ঝলমল', 'নতুন', 'চমক'] },
  rocket: { en: ['rocket', 'launch', 'fast', 'new'], bn: ['রকেট', 'লঞ্চ', 'দ্রুত'] },
  leaf: { en: ['leaf', 'fresh', 'natural', 'eco'], bn: ['পাতা', 'তাজা', 'প্রাকৃতিক'] },
  organic: { en: ['organic', 'sprout', 'plant', 'healthy'], bn: ['অর্গানিক', 'জৈব', 'চারা'] },
  handmade: { en: ['handmade', 'craft', 'sewing', 'tailor'], bn: ['হাতে তৈরি', 'কারুশিল্প', 'সেলাই'] },
}

export const ILLUSTRATION_LABELS: Record<IllustrationName, { en: string; bn: string }> = {
  delivery_scene: { en: 'Delivery on the way', bn: 'ডেলিভারি পথে' },
  shopping_bag_pop: { en: 'Shopping bag', bn: 'শপিং ব্যাগ' },
  sale_tag_swing: { en: 'Sale tag', bn: 'সেল ট্যাগ' },
  gift_unwrap: { en: 'Gift box', bn: 'উপহারের বাক্স' },
  phone_order: { en: 'Order by phone', bn: 'ফোনে অর্ডার' },
  parcel_journey: { en: 'Parcel journey', bn: 'পার্সেলের যাত্রা' },
  happy_shopper: { en: 'Happy shopper', bn: 'খুশি ক্রেতা' },
  eid_lanterns: { en: 'Eid lanterns', bn: 'ঈদের লণ্ঠন' },
}
