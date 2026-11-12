import { useLocale } from '../../../i18n/locale'

/*
 * The chart's own interface words (English and Bangla). Kept beside the chart so its lazy chunk
 * carries them; everything the owner typed (title, labels, series names) comes from the document.
 */

const EN = {
  showTable: 'Show data table',
  hideTable: 'Hide data table',
  category: 'Category',
  value: 'Value',
  share: 'Share',
  total: 'Total',
  kinds: { bar: 'Bar chart', column: 'Column chart', line: 'Line chart', area: 'Area chart', pie: 'Pie chart', donut: 'Donut chart' },
  summary: (kind: string, series: number, categories: number) =>
    `${kind}, ${series === 1 ? '1 series' : `${series} series`}, ${categories === 1 ? '1 category' : `${categories} categories`}. The data table below lists every value.`,
  points: 'Data points — use the arrow keys to move between them',
  loading: 'Loading chart…',
}

type Messages = typeof EN

const BN: Messages = {
  showTable: 'ডেটা টেবিল দেখুন',
  hideTable: 'ডেটা টেবিল লুকান',
  category: 'বিভাগ',
  value: 'মান',
  share: 'অংশ',
  total: 'মোট',
  kinds: { bar: 'বার চার্ট', column: 'কলাম চার্ট', line: 'লাইন চার্ট', area: 'এরিয়া চার্ট', pie: 'পাই চার্ট', donut: 'ডোনাট চার্ট' },
  summary: (kind: string, series: number, categories: number) => `${kind}, ${series}টি সিরিজ, ${categories}টি বিভাগ। নিচের ডেটা টেবিলে প্রতিটি মান আছে।`,
  points: 'ডেটা পয়েন্ট — এক পয়েন্ট থেকে অন্যটিতে যেতে তীর কী ব্যবহার করুন',
  loading: 'চার্ট লোড হচ্ছে…',
}

export type ChartMessages = Messages

export function chartMessages(locale: string): ChartMessages {
  return locale === 'bn' ? BN : EN
}

export function useChartMessages(): ChartMessages {
  const { locale } = useLocale()
  return chartMessages(locale)
}
