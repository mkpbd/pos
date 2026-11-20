/*
 * AI2a Online store → AI help: plain helpers shared by the Drafts, Categories and Bundle ideas tabs
 * (labels, text limits, the plain-text editing of AI descriptions, confidence words, errors).
 */

import { ApiError } from '@/lib/api/client'
import type { CurrentUser } from '@/features/auth/types'

export type AiSubject = 'product' | 'category' | 'brand'
export type AiLanguage = 'en' | 'bn'
export type AiTone = 'friendly' | 'formal' | 'festive' | 'simple'
export type AiLength = 'short' | 'medium' | 'long'
export type MissingCriterion = 'description' | 'seo' | 'bangla'
export type Confidence = 'high' | 'medium' | 'low'

export const AI_HELP_PERMISSIONS = {
  view: 'online_catalog.view',
  manage: 'online_catalog.manage',
  /** Applying a category is also a product edit: the API needs online_catalog.manage AND products.manage. */
  applyCategory: 'products.manage',
} as const

/** Where the page lives in the admin app (the address bar shows /admin/storefront/ai). */
export const AI_HELP_PATH = '/storefront/ai'

/** Contract §2: at most 200 subjects in one run of AI drafts; §3: 20 products per suggestion call; §4: 3 products per bundle. */
export const MAX_BATCH_SUBJECTS = 200
export const MAX_CATEGORY_PRODUCTS = 20
export const MAX_BUNDLE_PRODUCTS = 3
export const MAX_NOTES = 1000
export const MAX_APPROVE_MANY = 100

/** AI is switched on for the organization. Only an explicit `true` shows the AI help page and buttons. */
export function aiSwitchedOn(me: CurrentUser | null | undefined): boolean {
  return (me?.ai_enabled ?? me?.organization?.ai_enabled) === true
}

export const SUBJECT_LABELS: Record<AiSubject, { one: string; many: string }> = {
  product: { one: 'Product', many: 'Products' },
  category: { one: 'Category', many: 'Categories' },
  brand: { one: 'Brand', many: 'Brands' },
}

/** Fields the AI can write for each kind of listing (contract §1). */
export const SUBJECT_FIELDS: Record<AiSubject, string[]> = {
  product: ['short_description', 'description', 'seo_title', 'seo_description'],
  category: ['description', 'seo_title', 'seo_description'],
  brand: ['description', 'seo_title', 'seo_description'],
}

const FIELD_LABELS: Record<string, string> = {
  short_description: 'Short description',
  description: 'Description',
  description_html: 'Description',
  seo_title: 'Search engine title',
  seo_description: 'Search engine description',
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/** The longest text each field can hold (SaveProductListing / SaveCategoryListing / SaveBrandListing). */
export function fieldLimit(subject: AiSubject, field: string): number | null {
  if (field === 'seo_title') return 70
  if (field === 'seo_description') return 160
  if (field === 'short_description') return 500
  if ((field === 'description' || field === 'description_html') && subject === 'brand') return 1000
  return null
}

export const LANGUAGE_LABELS: Record<AiLanguage, string> = { en: 'English', bn: 'Bangla' }
export const LANGUAGE_CHOICES: { value: 'en' | 'bn' | 'both'; label: string; languages: AiLanguage[] }[] = [
  { value: 'en', label: 'English', languages: ['en'] },
  { value: 'bn', label: 'বাংলা (Bangla)', languages: ['bn'] },
  { value: 'both', label: 'Both', languages: ['en', 'bn'] },
]

export const TONES: { value: AiTone; label: string }[] = [
  { value: 'friendly', label: 'Friendly' },
  { value: 'formal', label: 'Formal' },
  { value: 'festive', label: 'Festive' },
  { value: 'simple', label: 'Simple' },
]

export const LENGTHS: { value: AiLength; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long' },
]

export const MISSING_CHOICES: { value: MissingCriterion; label: string }[] = [
  { value: 'description', label: 'No description yet' },
  { value: 'seo', label: 'No search engine title or description' },
  { value: 'bangla', label: 'No Bangla texts' },
]

export const CONFIDENCE_WORDS: Record<Confidence, { label: string; hint: string }> = {
  high: { label: 'High', hint: 'A clear match' },
  medium: { label: 'Medium', hint: 'Probably right — check it' },
  low: { label: 'Low', hint: 'A guess — check it carefully' },
}

// ---------------------------------------------------------------- description text

const HTML_BLOCK = /<(p|ul|ol|li|br|h[1-6]|div|strong|em)\b/i

/** The server writes descriptions as simple HTML (paragraphs and bullet lists). */
export function looksLikeHtml(text: string): boolean {
  return HTML_BLOCK.test(text)
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * Simple HTML → plain text for reading and editing: paragraphs separated by a blank line, list
 * items as "- item" lines. Nothing from the HTML is rendered; it is only parsed.
 */
export function htmlToPlain(html: string): string {
  if (!looksLikeHtml(html)) return html
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const blocks: string[] = []
  const walk = (parent: Element) => {
    let loose = ''
    const flush = () => {
      if (clean(loose)) blocks.push(clean(loose))
      loose = ''
    }
    parent.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        loose += node.textContent ?? ''
        return
      }
      if (!(node instanceof Element)) return
      const tag = node.tagName.toLowerCase()
      if (tag === 'ul' || tag === 'ol') {
        flush()
        const items = Array.from(node.querySelectorAll(':scope > li')).map((li) => `- ${clean(li.textContent ?? '')}`).filter((line) => line !== '- ')
        if (items.length) blocks.push(items.join('\n'))
      } else if (tag === 'p' || /^h[1-6]$/.test(tag)) {
        flush()
        if (clean(node.textContent ?? '')) blocks.push(clean(node.textContent ?? ''))
      } else if (tag === 'div') {
        flush()
        walk(node)
      } else if (tag === 'br') {
        flush()
      } else {
        loose += node.textContent ?? ''
      }
    })
    flush()
  }
  walk(doc.body)
  return blocks.join('\n\n')
}

// ---------------------------------------------------------------- errors

export type AiHelpError = { title: string; message: string }

/** Why the AI could not help, in plain words (the `reason` of a 422 AI_UNAVAILABLE). */
export function aiReasonText(reason: unknown): string {
  switch (reason) {
    case 'disabled':
      return 'AI is turned off for your shop. An administrator can turn it on under Organization → AI assistant.'
    case 'budget_exceeded':
      return 'Your shop has used this month’s AI allowance. An administrator can raise it under Organization → AI assistant, or it starts again next month.'
    case 'refused':
      return 'The AI would not write this. Try different notes.'
    case 'empty':
    case 'invalid':
      return 'The AI gave an answer we could not use. Try again.'
    default:
      return 'The AI service did not answer. Try again in a minute. Nothing has changed.'
  }
}

export function describeAiHelpError(error: unknown): AiHelpError {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'AI_UNAVAILABLE': {
        const reason = error.details?.reason
        return { title: reason === 'disabled' ? 'AI is off' : reason === 'budget_exceeded' ? 'AI allowance used up' : 'The AI could not help this time', message: aiReasonText(reason) }
      }
      case 'AI_BUDGET_EXCEEDED':
        return { title: 'AI allowance used up', message: aiReasonText('budget_exceeded') }
      case 'BATCH_TOO_LARGE':
        return { title: 'Too many at once', message: `One run can write drafts for up to ${String(error.details?.limit ?? MAX_BATCH_SUBJECTS)} items. Choose fewer, or narrow what is missing.` }
      case 'BATCH_RUNNING':
        return { title: 'Drafts are already being written', message: 'Wait for the current run to finish, or cancel it, then start another.' }
      case 'BATCH_NOT_RUNNING':
        return { title: 'The run has already ended', message: 'There is nothing left to cancel.' }
      case 'NOTHING_TO_WRITE':
        return { title: 'Nothing to write', message: 'Nothing is missing — every item already has these texts.' }
      case 'DRAFT_NOT_PENDING':
        return { title: 'Already reviewed', message: 'Someone has already approved or rejected this draft. Refresh the list.' }
      case 'DRAFT_STALE':
        return { title: 'The text changed since the draft was written', message: 'Someone edited this listing after the AI wrote the draft. Check the current text, then approve anyway to replace it.' }
      case 'NO_CATEGORIES':
        return { title: 'No categories yet', message: 'Add categories under Catalog first, then ask for suggestions.' }
      case 'PRODUCT_NOT_FOUND':
        return { title: 'Product not found', message: 'One of the products no longer exists or was archived. Refresh and try again.' }
      case 'TOO_MANY_PICKS':
        return { title: 'Too many picks', message: `A product can have up to ${String(error.details?.limit ?? 12)} “frequently bought together” picks. ${typeof error.details?.room === 'number' ? (error.details.room === 0 ? 'This one is full — remove some on its listing first.' : `There is room for ${String(error.details.room)} more.`) : 'Choose fewer.'}` }
      case 'TOO_MANY_CATEGORIES':
        return { title: 'Too many categories', message: `Your shop has more categories than the AI can compare at once (${String(error.details?.limit ?? 400)}).` }
      case 'VALIDATION_FAILED': {
        const first = Object.values(error.fieldErrors)[0]?.[0]
        return { title: 'Check your choices', message: first ?? error.message }
      }
    }
    if (error.status === 429) return { title: 'Too many requests', message: 'You asked the AI many times in a short while. Wait a minute and try again.' }
    if (error.status === 403) return { title: 'Not allowed', message: 'Your role cannot do this. Ask an administrator.' }
    if (error.status === 404) return { title: 'Not found', message: 'This item no longer exists. Refresh the page.' }
    return { title: 'Something went wrong', message: error.message || 'Try again.' }
  }
  return { title: 'Something went wrong', message: error instanceof Error ? error.message : 'Try again.' }
}

/** Why a draft could not be written (draft.error). */
export function draftErrorText(error: string | null): string {
  switch (error) {
    case 'disabled':
    case 'unavailable':
    case 'refused':
    case 'empty':
    case 'invalid':
      return aiReasonText(error)
    case 'not_found':
      return 'The item no longer exists.'
    default:
      return 'Something went wrong while writing this draft.'
  }
}

/** Why approve-many left a draft out (skipped[].reason). */
export function approveSkipText(reason: string): string {
  switch (reason) {
    case 'stale':
      return 'its listing changed since the draft was written — open it to approve anyway'
    case 'not_pending':
      return 'it was already reviewed'
    case 'failed':
      return 'it could not be written'
    case 'not_found':
      return 'it no longer exists'
    default:
      return 'it could not be approved'
  }
}

/** Why a category was not applied (apply → skipped[].reason). */
export function skipReasonText(reason: string): string {
  switch (reason) {
    case 'unchanged':
      return 'it already had that category'
    case 'product_not_found':
      return 'the product no longer exists'
    case 'category_not_found':
      return 'the category no longer exists'
    default:
      return 'it could not be changed'
  }
}

/** "1 draft" / "3 drafts". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
