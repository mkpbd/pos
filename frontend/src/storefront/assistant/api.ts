import { storeApi } from '../http'
import type { Locale } from '../i18n/runtime'

/*
 * AI2b shopper assistant endpoints (store host). Part of the panel's lazy chunk.
 * POST /store/assistant/messages — one turn; GET /store/assistant/conversations/current — reopening the chat.
 */

export const MAX_MESSAGE_LENGTH = 500

export type AssistantStatus = 'ok' | 'unavailable' | 'limit' | 'budget'

export type AssistantProduct = { slug: string; name: string; image_url: string | null; price_text: string; in_stock: boolean }
export type AssistantLink = { label: string; path: string }
export type AssistantHandoff = { type: 'whatsapp' | 'contact'; url: string }

export type AssistantReply = { text: string; products: AssistantProduct[]; links: AssistantLink[]; handoff: AssistantHandoff | null }

export type AssistantPageContext = { type: 'product' | 'category' | 'other'; slug?: string }

export type AssistantTurn = {
  /** Null when no conversation could be started (assistant off, the store's daily limit): the reply is a fallback. */
  conversation_token: string | null
  reply: AssistantReply
  status: AssistantStatus
  /** Shopper messages left in this conversation; 0 = full. */
  remaining_messages: number
}

export type StoredAssistantMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  products: AssistantProduct[]
  links: AssistantLink[]
  handoff: AssistantHandoff | null
  status: AssistantStatus | null
  created_at: string
}

export type CurrentConversation = {
  /** Null when the token is unknown, expired or someone else's: start afresh. */
  conversation_token: string | null
  /** The last 20 messages, oldest first. */
  messages: StoredAssistantMessage[]
  remaining_messages: number
}

export type SendInput = { conversation_token?: string; message: string; language: Locale; page?: AssistantPageContext }

export async function sendAssistantMessage(input: SendInput): Promise<AssistantTurn> {
  return (await storeApi.post<AssistantTurn>('/store/assistant/messages', input)).data
}

export async function fetchCurrentConversation(token: string, signal?: AbortSignal): Promise<CurrentConversation> {
  return (await storeApi.get<CurrentConversation>('/store/assistant/conversations/current', { signal, query: { conversation_token: token } })).data
}

/** What the shopper is looking at, sent with each question: a product or a category page; anything else is "other". */
export function pageContext(pathname: string): AssistantPageContext {
  const match = /^\/(product|category)\/([^/]+)\/?$/.exec(pathname)
  if (!match) return { type: 'other' }
  let slug = match[2]!
  try {
    slug = decodeURIComponent(slug)
  } catch {
    // A malformed escape: sent as it is.
  }
  return { type: match[1] as 'product' | 'category', slug }
}
