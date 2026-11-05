/**
 * Dictionary types (ADR-011). A message is a string with `{name}` placeholders, or plural forms
 * chosen by the `count` variable (Intl.PluralRules: English uses one/other; Bangla has one
 * grammatical form, so its `one` and `other` are usually the same text).
 */

export type PluralMessage = { one: string; other: string }
export type Message = string | PluralMessage
export type Messages = Record<string, Message>

/** The Bangla side of an English namespace: every key, same shape (missing keys are type errors). */
export type Translations<E extends Messages> = { readonly [K in keyof E]: E[K] extends string ? string : PluralMessage }

/** Values for `{name}` placeholders: numbers are formatted for the locale (grouping, digits); strings go in as they are. */
export type MessageVars = Record<string, string | number>
