import { en, type MessageKey } from './en'
import { formatNumber, type DigitOptions } from './format'
import type { Locale } from './runtime'
import type { Message, MessageVars } from './types'

export type Dictionary = Readonly<Record<MessageKey, Message>>

/**
 * `t(key, vars?)`: the message for the locale (English when a key is somehow missing), with
 * `{name}` placeholders filled. A plural message picks its form from `vars.count`.
 */
export type Translate = (key: MessageKey, vars?: MessageVars) => string

const PLACEHOLDER = /\{(\w+)\}/g
const pluralRules = new Map<Locale, Intl.PluralRules>()

function pluralCategory(locale: Locale, count: number): 'one' | 'other' {
  let rules = pluralRules.get(locale)
  if (!rules) {
    rules = new Intl.PluralRules(locale)
    pluralRules.set(locale, rules)
  }
  return rules.select(count) === 'one' ? 'one' : 'other'
}

export function interpolate(text: string, vars: MessageVars | undefined, digits: DigitOptions): string {
  if (!vars) return text
  return text.replace(PLACEHOLDER, (match, name: string) => {
    if (!(name in vars)) return match
    const value = vars[name]
    return typeof value === 'number' ? formatNumber(value, {}, digits) : String(value)
  })
}

export function createTranslator(dictionary: Dictionary, digits: DigitOptions): Translate {
  return (key, vars) => {
    const message: Message | undefined = dictionary[key] ?? en[key]
    if (message === undefined) return key
    if (typeof message === 'string') return interpolate(message, vars, digits)
    const count = Number(vars?.count ?? 0)
    return interpolate(message[pluralCategory(digits.locale, Number.isFinite(count) ? count : 0)], vars, digits)
  }
}

export function isMessageKey(value: string): value is MessageKey {
  return Object.hasOwn(en, value)
}
