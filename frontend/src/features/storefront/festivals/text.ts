import { useScreenText } from '@/features/store-builder/pages/screen-language'
import { festivalText, toBanglaDigits, type FestivalMessageKey } from './messages'

/** The Festivals screen's words in the screen's language (shared with the Page builder screen). */
export function useFestivalText() {
  const { lang, setLang } = useScreenText()
  return {
    lang,
    setLang,
    t: (key: FestivalMessageKey, values?: Record<string, string | number>) => festivalText(lang, key, values),
    num: (value: number | string) => (lang === 'bn' ? toBanglaDigits(String(value)) : String(value)),
  }
}

export type FestivalText = ReturnType<typeof useFestivalText>
