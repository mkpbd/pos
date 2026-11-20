import type { Translate } from '../i18n/translate'
import { waChatLink, waNumber } from '../social/links'
import type { StorefrontBootstrap } from '../types'
import type { AssistantHandoff } from './api'
import { safeStorePath } from './safe-text'

/*
 * AI2b hand-off: when the assistant cannot help, the shopper goes to a person — a WhatsApp chat with the
 * store (the conversation's first question typed in) or the store's contact page. Only two kinds of
 * address are ever followed: https://wa.me/<number> and this store's own pages.
 */

export type HandoffTarget = { kind: 'whatsapp'; href: string } | { kind: 'contact'; path: string }

/** The longest first question carried into the WhatsApp message. */
const QUESTION_LIMIT = 300

/** The store number of a wa.me address, or null for any other address. */
export function waNumberOf(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'wa.me' || parsed.username || parsed.password || parsed.port) return null
    return waNumber(decodeURIComponent(parsed.pathname.slice(1)))
  } catch {
    return null
  }
}

function whatsAppMessage(t: Translate, question: string | null): string {
  const trimmed = question?.replace(/\s+/g, ' ').trim() ?? ''
  if (!trimmed) return t('assistant.handoff.hello')
  return t('assistant.handoff.message', { question: trimmed.length > QUESTION_LIMIT ? `${trimmed.slice(0, QUESTION_LIMIT - 1)}…` : trimmed })
}

/**
 * Where a reply's hand-off goes. A wa.me link is rebuilt from its number with the conversation's first
 * question (the server's own text when it has one); a contact path must be one of the store's pages.
 */
export function replyHandoff(handoff: AssistantHandoff | null | undefined, t: Translate, firstQuestion: string | null): HandoffTarget | null {
  if (!handoff) return null
  if (handoff.type === 'whatsapp') {
    const number = waNumberOf(handoff.url)
    if (!number) return null
    let text: string | null = null
    try {
      text = new URL(handoff.url).searchParams.get('text')
    } catch {
      text = null
    }
    return { kind: 'whatsapp', href: waChatLink(number, text?.trim() ? text : whatsAppMessage(t, firstQuestion)) }
  }
  if (handoff.type === 'contact') {
    const path = safeStorePath(handoff.url)
    return path ? { kind: 'contact', path } : null
  }
  return null
}

/** The panel's own "talk to a person" target, from the bootstrap (the store's hand-off choice). */
export function storeHandoff(bootstrap: StorefrontBootstrap, t: Translate, firstQuestion: string | null): HandoffTarget | null {
  const assistant = bootstrap.assistant
  if (!assistant || assistant.handoff === 'none') return null
  if (assistant.handoff === 'whatsapp') {
    const number = waNumberOf(assistant.handoff_url) ?? waNumber(bootstrap.store.whatsapp_number)
    return number ? { kind: 'whatsapp', href: waChatLink(number, whatsAppMessage(t, firstQuestion)) } : null
  }
  const path = safeStorePath(assistant.handoff_url)
  return path ? { kind: 'contact', path } : null
}
