import { createContext, useContext } from 'react'
import { formatDate, formatNumber, isScreenLang, translate, translateCount, type CountKey, type MessageKey, type MessageValues, type ScreenLang } from './messages'

/*
 * The language of the Page builder start screen (B7): English or Bangla, remembered in this
 * browser. Components read the words with `useScreenText()`; outside the screen (or in tests that
 * render a part alone) the default is English.
 */

const LANG_KEY = 'pos.storeBuilder.pagesLang'
const GUIDE_KEY = 'pos.storeBuilder.guideHidden'

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Private mode or storage turned off: the choice lasts until the page is left.
  }
}

export function storedScreenLang(): ScreenLang {
  const value = read(LANG_KEY)
  return isScreenLang(value) ? value : 'en'
}

export const rememberScreenLang = (lang: ScreenLang) => write(LANG_KEY, lang)

export const storedGuideHidden = () => read(GUIDE_KEY) === '1'

export const rememberGuideHidden = (hidden: boolean) => write(GUIDE_KEY, hidden ? '1' : null)

export type ScreenLanguage = { lang: ScreenLang; setLang: (lang: ScreenLang) => void }

export const ScreenLangContext = createContext<ScreenLanguage>({ lang: 'en', setLang: () => {} })

export function useScreenText() {
  const { lang, setLang } = useContext(ScreenLangContext)
  return {
    lang,
    setLang,
    t: (key: MessageKey, values?: MessageValues) => translate(lang, key, values),
    tc: (key: CountKey, count: number, values?: MessageValues) => translateCount(lang, key, count, values),
    num: (value: number) => formatNumber(lang, value),
    date: (iso: string | null | undefined, withTime = false) => formatDate(lang, iso, withTime),
  }
}

export type ScreenText = ReturnType<typeof useScreenText>
