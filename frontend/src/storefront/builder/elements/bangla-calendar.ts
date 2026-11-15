/*
 * B17 calendars, pure: today in a time zone, the Bangladesh revised Bengali calendar (Bangla
 * Academy, 2019 revision) and the tabular (arithmetic) Hijri calendar.
 *
 * Bengali calendar (Bangladesh, revised 2019): the year starts on 14 April (1 Boishakh). Boishakh
 * to Ashwin have 31 days; Kartik, Ogrohayon, Poush, Magh and Choitro 30; Falgun 29, or 30 when the
 * Gregorian year it falls in is a leap year (so 21 February is always 8 Falgun, 16 December always
 * 1 Poush). The Bengali year is the Gregorian year − 593 from 14 April, − 594 before it.
 *
 * Hijri: the civil tabular calendar (30-year cycle, epoch 16 July 622). It can differ by a day or
 * two from the dates announced after the moon sighting in Bangladesh, so the storefront marks it
 * "expected".
 */

/** A calendar day (Gregorian, month 1–12). */
export type CivilDate = { year: number; month: number; day: number }

/** Day of week 0 = Sunday … 6 = Saturday. */
export type BengaliDate = { year: number; month: number; day: number; weekday: number; season: number }
export type HijriDate = { year: number; month: number; day: number }

/** Today's date in an IANA time zone; the UTC date for an unknown zone. */
export function zonedDate(date: Date, timeZone: string): CivilDate {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', calendar: 'gregory', numberingSystem: 'latn' }).formatToParts(date)
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
    const out = { year: get('year'), month: get('month'), day: get('day') }
    if ([out.year, out.month, out.day].every(Number.isInteger)) return out
  } catch {
    // An unknown time zone: fall through to UTC.
  }
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Days since 1970-01-01 of a civil date (proleptic Gregorian). */
function epochDay({ year, month, day }: CivilDate): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: CivilDate): number {
  return (((epochDay(date) + 4) % 7) + 7) % 7
}

/** Bengali month lengths of the year that starts on 14 April of `gregorianStart`. */
export function bengaliMonthLengths(gregorianStart: number): number[] {
  return [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, isLeap(gregorianStart + 1) ? 30 : 29, 30]
}

/** The Bengali date (Bangladesh revised calendar) of a Gregorian day. `season` 0–5 (grishmo … boshonto), two months each. */
export function toBengali(date: CivilDate): BengaliDate {
  const startYear = date.month > 4 || (date.month === 4 && date.day >= 14) ? date.year : date.year - 1
  let offset = epochDay(date) - epochDay({ year: startYear, month: 4, day: 14 })
  const lengths = bengaliMonthLengths(startYear)
  let month = 0
  while (month < 11 && offset >= lengths[month]!) {
    offset -= lengths[month]!
    month += 1
  }
  return { year: startYear - 593, month: month + 1, day: offset + 1, weekday: weekdayOf(date), season: Math.floor(month / 2) }
}

/** The civil tabular Hijri date of a Gregorian day. */
export function toHijri(date: CivilDate): HijriDate {
  // Julian day number at noon, then the classic arithmetic conversion.
  const jd = epochDay(date) + 2_440_588
  const l0 = jd - 1_948_440 + 10_632
  const n = Math.floor((l0 - 1) / 10_631)
  let l = l0 - 10_631 * n + 354
  const j = Math.floor((10_985 - l) / 5_316) * Math.floor((50 * l) / 17_719) + Math.floor(l / 5_670) * Math.floor((43 * l) / 15_238)
  l = l - Math.floor((30 - j) / 15) * Math.floor((17_719 * j) / 50) - Math.floor(j / 16) * Math.floor((15_238 * j) / 43) + 29
  const month = Math.floor((24 * l) / 709)
  const day = l - Math.floor((709 * month) / 24)
  const year = 30 * n + j - 30
  return { year, month, day }
}

/* ----------------------------------------------------------------------------------------------
 * Names (Bangla script and the usual English spelling)
 * -------------------------------------------------------------------------------------------- */

export const BENGALI_MONTHS_BN = ['বৈশাখ', 'জ্যৈষ্ঠ', 'আষাঢ়', 'শ্রাবণ', 'ভাদ্র', 'আশ্বিন', 'কার্তিক', 'অগ্রহায়ণ', 'পৌষ', 'মাঘ', 'ফাল্গুন', 'চৈত্র'] as const
export const BENGALI_MONTHS_EN = ['Boishakh', 'Joishtho', 'Asharh', 'Shrabon', 'Bhadro', 'Ashwin', 'Kartik', 'Ogrohayon', 'Poush', 'Magh', 'Falgun', 'Choitro'] as const
export const SEASONS_BN = ['গ্রীষ্মকাল', 'বর্ষাকাল', 'শরৎকাল', 'হেমন্তকাল', 'শীতকাল', 'বসন্তকাল'] as const
export const SEASONS_EN = ['Summer', 'Monsoon', 'Autumn', 'Late autumn', 'Winter', 'Spring'] as const
export const WEEKDAYS_BN = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'] as const
export const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
export const HIJRI_MONTHS_BN = ['মহররম', 'সফর', 'রবিউল আউয়াল', 'রবিউস সানি', 'জমাদিউল আউয়াল', 'জমাদিউস সানি', 'রজব', 'শাবান', 'রমজান', 'শাওয়াল', 'জিলকদ', 'জিলহজ'] as const
export const HIJRI_MONTHS_EN = ['Muharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Thani', 'Jumada al-Awwal', 'Jumada al-Thani', 'Rajab', 'Shaban', 'Ramadan', 'Shawwal', 'Dhul Qadah', 'Dhul Hijjah'] as const
const GREGORIAN_MONTHS_BN = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'] as const
const GREGORIAN_MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯'

/** Latin digits as Bengali digits ("1434" → "১৪৩৪"). */
export function banglaDigits(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => BENGALI_DIGITS[Number(d)]!)
}

export type CalendarLanguage = 'bn' | 'en'

/** "১ বৈশাখ ১৪৩৪" / "1 Boishakh 1434" (Bangla always with Bengali digits). */
export function formatBengali(date: BengaliDate, language: CalendarLanguage): string {
  return language === 'bn'
    ? `${banglaDigits(date.day)} ${BENGALI_MONTHS_BN[date.month - 1]} ${banglaDigits(date.year)}`
    : `${date.day} ${BENGALI_MONTHS_EN[date.month - 1]} ${date.year}`
}

export function formatWeekday(weekday: number, language: CalendarLanguage): string {
  return (language === 'bn' ? WEEKDAYS_BN : WEEKDAYS_EN)[weekday]!
}

export function formatSeason(season: number, language: CalendarLanguage): string {
  return (language === 'bn' ? SEASONS_BN : SEASONS_EN)[season]!
}

/** "১৪ এপ্রিল ২০২৭" / "14 April 2027". */
export function formatGregorian(date: CivilDate, language: CalendarLanguage): string {
  return language === 'bn'
    ? `${banglaDigits(date.day)} ${GREGORIAN_MONTHS_BN[date.month - 1]} ${banglaDigits(date.year)}`
    : `${date.day} ${GREGORIAN_MONTHS_EN[date.month - 1]} ${date.year}`
}

/** "৬ জিলকদ ১৪৪৮" / "6 Dhul Qadah 1448" (the "expected" mark is added by the caller). */
export function formatHijri(date: HijriDate, language: CalendarLanguage): string {
  return language === 'bn'
    ? `${banglaDigits(date.day)} ${HIJRI_MONTHS_BN[date.month - 1]} ${banglaDigits(date.year)}`
    : `${date.day} ${HIJRI_MONTHS_EN[date.month - 1]} ${date.year}`
}

/** ISO `YYYY-MM-DD` of a civil date (the `<time datetime>` value). */
export function isoDate({ year, month, day }: CivilDate): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
