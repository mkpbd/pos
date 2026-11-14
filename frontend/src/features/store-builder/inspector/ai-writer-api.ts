/*
 * B9 AI writer request (contract §2): POST /storefront/builder/ai/write and plain-language
 * explanations of why it could not write (AI off, budget, rate limit, failure).
 */

import { ApiError, api } from '@/lib/api/client'
import type { AiAnswer, AiLanguage, AiMode, AiTone } from './ai-writer-model'

export type AiWriteInput = {
  mode: AiMode
  document_id: string
  node_id: string
  type?: string
  instruction: string
  language: AiLanguage
  tone: AiTone
  /** Element: `{<field key>: text}`; section: `{<element id>: {<field key>: text}}` (unsaved texts win over the saved draft). */
  current: Record<string, string> | Record<string, Record<string, string>>
}

/** The answer: where the texts go (`translations.bn` whenever the language is Bangla) and the texts. */
export type AiWriteResult = AiAnswer & { target: 'base' | 'translations.bn'; source: 'ai' }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const textsOf = (v: unknown): Record<string, string> => (isObj(v) ? (Object.fromEntries(Object.entries(v).filter(([, t]) => typeof t === 'string')) as Record<string, string>) : {})

export async function writeWithAi(input: AiWriteInput, signal?: AbortSignal): Promise<AiWriteResult> {
  const body: unknown = (await api.post<unknown>('/storefront/builder/ai/write', input, { signal })).data
  const data = isObj(body) ? body : {}
  const elements = isObj(data.elements) ? Object.fromEntries(Object.entries(data.elements).map(([id, texts]) => [id, textsOf(texts)])) : {}
  return {
    source: 'ai',
    target: data.target === 'translations.bn' || (data.target === undefined && input.language === 'bn') ? 'translations.bn' : 'base',
    texts: textsOf(data.texts),
    elements,
  }
}

/** Why AI writing is not available, in plain words (the `reason` of a 422 AI_UNAVAILABLE). */
export function aiOffReason(reason: unknown): string {
  switch (reason) {
    case 'disabled':
      return 'AI writing is turned off for your shop. An administrator can turn it on under Organization → AI.'
    case 'budget_exceeded':
      return 'Your shop has used this month’s AI allowance. An administrator can raise it under Organization → AI, or it starts again next month.'
    case 'refused':
      return 'The AI couldn’t write this. Try different words in “What should it say?”.'
    default:
      return 'The AI service didn’t answer. Try again in a minute; your texts haven’t changed.'
  }
}

export type AiWriteError = { title: string; message: string; off: boolean }

export function describeWriteError(error: unknown): AiWriteError {
  if (error instanceof ApiError) {
    if (error.code === 'AI_UNAVAILABLE') {
      const reason = error.details?.reason
      const off = reason === 'disabled'
      return { title: off ? 'AI writing is off' : 'AI couldn’t write this', message: aiOffReason(reason), off }
    }
    if (error.code === 'AI_BUDGET_EXCEEDED') return { title: 'AI allowance used up', message: aiOffReason('budget_exceeded'), off: false }
    if (error.code === 'NODE_NOT_FOUND') return { title: 'Not saved yet', message: 'The page is still saving your latest changes. Wait a moment and try again.', off: false }
    if (error.code === 'NO_TEXT_FIELDS') return { title: 'Nothing to write', message: 'There’s no text here for the AI to write.', off: false }
    if (error.code === 'TOO_MANY_FIELDS') return { title: 'Too many texts', message: `This section has more texts than the AI can write at once (${String(error.details?.limit ?? 40)}). Write its elements one by one instead.`, off: false }
    if (error.status === 429) return { title: 'Too many requests', message: 'You asked the AI many times in a short while. Wait a minute and try again.', off: false }
    if (error.status === 403) return { title: 'Not allowed', message: 'Your role can’t use AI writing. Ask an administrator.', off: false }
    if (error.status === 422) return { title: 'AI couldn’t write this', message: error.message || 'Check what you asked for and try again.', off: false }
  }
  return { title: 'AI couldn’t write this', message: 'Something went wrong. Check your connection and try again; your texts haven’t changed.', off: false }
}
