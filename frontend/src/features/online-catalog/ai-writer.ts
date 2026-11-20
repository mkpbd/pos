/*
 * AI2a §1 "Write with AI" for one product / category / brand listing: the request to
 * POST /online-catalog/ai/write, the answer read into rows to review, and plain-word errors.
 * Nothing is saved by the server; the editor fills the form and staff save it as usual.
 */

import { useMutation } from '@tanstack/react-query'
import { ApiError, api } from '@/lib/api/client'
import type { CurrentUser } from '@/features/auth/types'

export type AiSubject = 'product' | 'category' | 'brand'
export type AiField = 'short_description' | 'description' | 'seo_title' | 'seo_description'
export type AiLanguage = 'en' | 'bn'
export type AiLanguageChoice = 'en' | 'bn' | 'both'
export type AiTone = 'friendly' | 'formal' | 'festive' | 'simple'
export type AiLength = 'short' | 'medium' | 'long'

export const AI_NOTES_MAX = 1000

/** The fields each subject can have written (the API's list). */
export const AI_FIELDS: Record<AiSubject, readonly AiField[]> = {
  product: ['short_description', 'description', 'seo_title', 'seo_description'],
  category: ['description', 'seo_title', 'seo_description'],
  brand: ['description', 'seo_title', 'seo_description'],
}

export const AI_LANGUAGES: Record<AiLanguageChoice, readonly AiLanguage[]> = { en: ['en'], bn: ['bn'], both: ['en', 'bn'] }

export const TONES: readonly { value: AiTone; label: string; hint: string }[] = [
  { value: 'friendly', label: 'Friendly', hint: 'Warm and welcoming, like a helpful shopkeeper.' },
  { value: 'formal', label: 'Formal', hint: 'Polite and businesslike.' },
  { value: 'festive', label: 'Festive', hint: 'Cheerful, for Eid, Puja, Pohela Boishakh and sales.' },
  { value: 'simple', label: 'Simple', hint: 'Short sentences and everyday words.' },
]

export const LENGTHS: readonly { value: AiLength; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long' },
]

export type AiWriteInput = {
  subject: AiSubject
  id: string
  fields: AiField[]
  languages: AiLanguage[]
  tone: AiTone
  length: AiLength
  notes?: string
}

export type AiWriteAnswer = {
  /** `{<lang>: {<field>: text}}`; the description is HTML for products and categories, plain text for brands. */
  suggestions: Partial<Record<AiLanguage, Partial<Record<AiField, string>>>>
  /** What the AI would need to write better ("material", "care instructions"). */
  missingInfo: string[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Reads the answer leniently: unknown languages / fields and non-text values are dropped. */
export function normalizeAnswer(raw: unknown, input: Pick<AiWriteInput, 'fields' | 'languages'>): AiWriteAnswer {
  const data = isObj(raw) ? raw : {}
  const suggestions: AiWriteAnswer['suggestions'] = {}
  const all = isObj(data.suggestions) ? data.suggestions : {}
  for (const lang of input.languages) {
    const texts = all[lang]
    if (!isObj(texts)) continue
    const out: Partial<Record<AiField, string>> = {}
    for (const field of input.fields) {
      const value = texts[field] ?? (field === 'description' ? texts.description_html : undefined)
      if (typeof value === 'string' && value.trim() !== '') out[field] = value
    }
    suggestions[lang] = out
  }
  const missing = Array.isArray(data.missing_info) ? data.missing_info : []
  return {
    suggestions,
    missingInfo: missing.filter((m): m is string => typeof m === 'string' && m.trim() !== '').map((m) => m.trim()).slice(0, 5),
  }
}

export async function writeListingWithAi(input: AiWriteInput, signal?: AbortSignal): Promise<AiWriteAnswer> {
  const { notes, ...rest } = input
  const body: Omit<AiWriteInput, 'notes'> & { notes?: string } = notes?.trim() ? { ...rest, notes: notes.trim() } : rest
  const raw = (await api.post<unknown>('/online-catalog/ai/write', body, { signal })).data
  return normalizeAnswer(raw, input)
}

export function useListingAiWriteMutation() {
  return useMutation({
    mutationFn: ({ input, signal }: { input: AiWriteInput; signal?: AbortSignal }) => writeListingWithAi(input, signal),
  })
}

/** Write with AI is offered only when the session says AI is on for the organization. */
export function listingAiOn(me: CurrentUser | null | undefined): boolean {
  return (me?.ai_enabled ?? me?.organization?.ai_enabled) === true
}

export type AiWriteError = { title: string; message: string; /** Trying again won't help (AI off, allowance used). */ final: boolean }

/** Why the AI could not write, in plain words (`reason` of 422 AI_UNAVAILABLE and the other errors). */
export function describeAiWriteError(error: unknown): AiWriteError {
  if (error instanceof ApiError) {
    if (error.code === 'AI_UNAVAILABLE') {
      switch (error.details?.reason) {
        case 'disabled':
          return { title: 'AI writing is off', message: 'AI is turned off for your shop. An administrator can turn it on under Organization → AI.', final: true }
        case 'budget_exceeded':
          return { title: 'AI allowance used up', message: 'Your shop has used this month’s AI allowance. An administrator can raise it under Organization → AI, or it starts again next month.', final: true }
        case 'refused':
          return { title: 'The AI wouldn’t write this', message: 'Try different notes, or write this text yourself.', final: false }
        case 'empty':
          return { title: 'The AI sent back nothing', message: 'Try again, perhaps with a few notes about the item.', final: false }
        case 'invalid':
          return { title: 'The AI’s answer was not usable', message: 'Try again in a moment.', final: false }
        default:
          return { title: 'The AI service didn’t answer', message: 'Try again in a minute. Nothing in your form has changed.', final: false }
      }
    }
    if (error.code === 'NOTHING_TO_WRITE') return { title: 'Nothing to write', message: 'Choose at least one text and one language.', final: false }
    if (error.status === 404) return { title: 'Not found', message: 'This item no longer exists. Reload the page.', final: true }
    if (error.status === 429) return { title: 'Too many requests', message: 'The AI was asked many times in a short while. Wait a minute and try again.', final: false }
    if (error.status === 403) return { title: 'Not allowed', message: 'Your role can’t use AI writing. Ask an administrator.', final: true }
    if (error.code === 'VALIDATION_FAILED') return { title: 'Check your choices', message: error.message || 'Some choices were not accepted. Check them and try again.', final: false }
  }
  return { title: 'The AI couldn’t write this', message: 'Something went wrong. Check your connection and try again. Nothing in your form has changed.', final: false }
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Rich-text fields take HTML; a plain-text answer becomes paragraphs (the server normally sends HTML). */
export function asHtml(text: string): string {
  if (/^\s*</.test(text)) return text
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** Lines to show an HTML text in the review: paragraphs as they are, list items with a bullet. */
export function htmlLines(html: string): string[] {
  if (!/^\s*</.test(html)) return html.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const lines: string[] = []
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase()
      if (tag === 'li') lines.push(`• ${child.textContent?.replace(/\s+/g, ' ').trim() ?? ''}`)
      else if (tag === 'ul' || tag === 'ol' || tag === 'div' || tag === 'section') walk(child)
      else {
        const text = child.textContent?.replace(/\s+/g, ' ').trim()
        if (text) lines.push(text)
      }
    }
  }
  walk(doc.body)
  if (lines.length === 0) {
    const text = doc.body.textContent?.replace(/\s+/g, ' ').trim()
    if (text) lines.push(text)
  }
  return lines.filter((l) => l !== '• ')
}

/** Whether a form value counts as empty (rich text "<p></p>" too). */
export function isBlank(value: string, html: boolean): boolean {
  return (html ? htmlLines(value).join('') : value).trim() === ''
}
