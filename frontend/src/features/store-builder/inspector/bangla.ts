import type { BnValues } from '@/features/translations/translations'

export type Translations = Record<string, Record<string, string>>

/** The node's `translations` with the Bangla values replaced; blank values and an empty locale are dropped. */
export function withBangla(translations: Translations, values: BnValues): Translations {
  const bn = Object.fromEntries(Object.entries(values).filter(([, text]) => text.trim() !== ''))
  const next = { ...translations }
  if (Object.keys(bn).length > 0) next.bn = bn
  else delete next.bn
  return next
}
