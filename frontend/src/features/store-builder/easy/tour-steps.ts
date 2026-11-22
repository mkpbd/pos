import type { TipId } from './ease-store'

/*
 * B21 guided tour: six steps, each pointing at a part of the editor marked `data-tour="<target>"`.
 * Plain words in English and Bangla (original texts).
 */

export type TourTarget = 'add' | 'canvas' | 'picture' | 'phone' | 'motion' | 'publish'

export type TourText = { title: string; body: string }

export type TourStep = { target: TourTarget; en: TourText; bn: TourText }

export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: 'add',
    en: { title: 'Add a section', body: 'Pick a ready-made section or an element here and click it — or drag it onto the page.' },
    bn: { title: 'একটি অংশ যোগ করুন', body: 'এখান থেকে তৈরি একটি অংশ বা উপাদান বেছে ক্লিক করুন — অথবা টেনে পাতায় নিয়ে আসুন।' },
  },
  {
    target: 'canvas',
    en: { title: 'Change the words', body: 'Click any heading or text on the page and type to change it.' },
    bn: { title: 'লেখা বদলান', body: 'পাতার যেকোনো শিরোনাম বা লেখায় ক্লিক করে টাইপ করলেই তা বদলে যাবে।' },
  },
  {
    target: 'picture',
    en: { title: 'Change a picture', body: 'Select a picture and choose another one here — or simply drag a picture from your computer onto it.' },
    bn: { title: 'ছবি বদলান', body: 'একটি ছবি বেছে নিয়ে এখানে অন্য ছবি দিন — অথবা কম্পিউটার থেকে ছবি টেনে এনে তার ওপর ছেড়ে দিন।' },
  },
  {
    target: 'phone',
    en: { title: 'See it on a phone', body: 'Most shoppers use a phone: switch to the phone view to see the page as they do.' },
    bn: { title: 'ফোনে দেখুন', body: 'বেশিরভাগ ক্রেতা ফোন ব্যবহার করেন: ফোন ভিউ চাপলে পাতাটি তাঁদের মতো করে দেখবেন।' },
  },
  {
    target: 'motion',
    en: { title: 'Add some movement', body: 'The Motion menu gives the whole page a ready-made animation theme in one click.' },
    bn: { title: 'নড়াচড়া যোগ করুন', body: 'Motion মেনু থেকে এক ক্লিকে পুরো পাতায় তৈরি একটি অ্যানিমেশন থিম দিন।' },
  },
  {
    target: 'publish',
    en: { title: 'Publish when you are ready', body: 'Your changes are saved as a draft — nothing is live on your store until you publish.' },
    bn: { title: 'প্রস্তুত হলে প্রকাশ করুন', body: 'আপনার পরিবর্তন খসড়া হিসেবে সেভ হয় — প্রকাশ না করা পর্যন্ত দোকানে কিছুই লাইভ হয় না।' },
  },
]

export const TOUR_WORDS = {
  en: { label: 'Editor tour', step: (n: number, of: number) => `Step ${n} of ${of}`, next: 'Next', back: 'Back', skip: 'Skip tour', done: 'Done' },
  bn: { label: 'এডিটর পরিচিতি', step: (n: number, of: number) => `ধাপ ${toBangla(n)} / ${toBangla(of)}`, next: 'পরবর্তী', back: 'আগের', skip: 'পরিচিতি বাদ দিন', done: 'শেষ' },
} as const

const BN_DIGITS = '০১২৩৪৫৬৭৮৯'

export function toBangla(n: number): string {
  return String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]!)
}

/**
 * Where the step card goes next to its target (viewport pixels): below it, else above, else
 * beside it, else over its middle (a big target such as the canvas); always inside the screen.
 */
export function placeCard(
  target: { top: number; left: number; width: number; height: number } | null,
  card: { width: number; height: number },
  view: { width: number; height: number },
  gap = 12,
  margin = 16,
): { top: number; left: number } {
  const clampX = (x: number) => Math.max(margin, Math.min(x, view.width - card.width - margin))
  const clampY = (y: number) => Math.max(margin, Math.min(y, view.height - card.height - margin))
  if (!target) return { top: clampY((view.height - card.height) / 2), left: clampX((view.width - card.width) / 2) }
  const centreX = target.left + target.width / 2 - card.width / 2
  const below = target.top + target.height + gap
  if (below + card.height <= view.height - margin) return { top: below, left: clampX(centreX) }
  const above = target.top - gap - card.height
  if (above >= margin) return { top: above, left: clampX(centreX) }
  const right = target.left + target.width + gap
  if (right + card.width <= view.width - margin) return { top: clampY(target.top), left: right }
  const left = target.left - gap - card.width
  if (left >= margin) return { top: clampY(target.top), left }
  return { top: clampY(target.top + target.height / 2 - card.height / 2), left: clampX(centreX) }
}

/* B21 contextual tips (tips.tsx). */

type TipText = { en: string; bn: string }

export const TIP_TEXT: Record<TipId, TipText> = {
  picture: { en: 'Tip: drag a picture from your computer onto it.', bn: 'টিপ: কম্পিউটার থেকে একটি ছবি টেনে এনে এর ওপর ছেড়ে দিন।' },
  empty: {
    en: 'Tip: an empty page? “Build it for me” on the page makes a whole page in a minute — or add a section from the Add panel.',
    bn: 'টিপ: পাতা খালি? পাতার “Build it for me” চাপলে এক মিনিটে পুরো পাতা তৈরি হয় — অথবা Add প্যানেল থেকে একটি অংশ যোগ করুন।',
  },
  publish: { en: 'Tip: Check page looks for problems first.', bn: 'টিপ: আগে Check page দিয়ে সমস্যা খুঁজে দেখুন।' },
}

