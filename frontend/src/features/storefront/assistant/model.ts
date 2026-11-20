/*
 * AI2b Online store → Assistant: plain helpers for the shopper support assistant's admin page
 * (settings shape and checks, words for tools / statuses / hand-off, and defensive normalizers for
 * the conversations, transcript and summary endpoints — cosmetic contract differences must not
 * break the page).
 */

export type AssistantHandoff = 'whatsapp' | 'contact' | 'none'
export type AssistantLanguage = 'en' | 'bn'
export type AssistantReplyStatus = 'ok' | 'unavailable' | 'limit' | 'budget'

/** Contract §1 limits. */
export const ASSISTANT_LIMITS = {
  name: 40,
  greeting: 200,
  dailyMin: 1,
  dailyMax: 2000,
} as const

export const ASSISTANT_DEFAULTS = {
  enabled: false,
  name: 'Shop assistant',
  greeting: '',
  greeting_bn: '',
  daily_conversation_limit: 200,
} as const

/** Conversations (and their messages) are pruned after this many days. */
export const KEPT_DAYS = 30

// ---------------------------------------------------------------- settings

/** The `assistant` key of the storefront settings as the page uses it. */
export type AssistantSettings = {
  enabled: boolean
  name: string
  greeting: string
  greeting_bn: string
  daily_conversation_limit: number
  handoff: AssistantHandoff
}

/** The PATCH body's `assistant` key; the Bangla greeting travels as `translations.bn.greeting` ("" removes it). */
export type AssistantSettingsInput = {
  enabled: boolean
  name: string
  /** null = no greeting. */
  greeting: string | null
  daily_conversation_limit: number
  handoff: AssistantHandoff
  translations: { bn: { greeting: string } }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null)
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const bool = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true'

export const isHandoff = (v: unknown): v is AssistantHandoff => v === 'whatsapp' || v === 'contact' || v === 'none'

/**
 * The saved settings, with defaults for anything missing. `hasWhatsapp` decides the default
 * hand-off (WhatsApp when the store has a number, else the contact page).
 */
export function readAssistantSettings(raw: unknown, hasWhatsapp: boolean): AssistantSettings {
  const r = isObj(raw) ? raw : {}
  const greeting = r.greeting
  const translations = isObj(r.translations) && isObj(r.translations.bn) ? r.translations.bn : {}
  const en = isObj(greeting) ? str(greeting.en) : str(greeting)
  const bn = isObj(greeting) ? str(greeting.bn) : (str(translations.greeting) ?? str(r.greeting_bn))
  const limit = num(r.daily_conversation_limit)
  return {
    enabled: bool(r.enabled),
    name: str(r.name) ?? ASSISTANT_DEFAULTS.name,
    greeting: en ?? ASSISTANT_DEFAULTS.greeting,
    greeting_bn: bn ?? ASSISTANT_DEFAULTS.greeting_bn,
    daily_conversation_limit: limit > 0 ? Math.round(limit) : ASSISTANT_DEFAULTS.daily_conversation_limit,
    handoff: isHandoff(r.handoff) ? r.handoff : hasWhatsapp ? 'whatsapp' : 'contact',
  }
}

export function toAssistantInput(values: AssistantSettings): AssistantSettingsInput {
  return {
    enabled: values.enabled,
    name: values.name.trim(),
    greeting: values.greeting.trim() === '' ? null : values.greeting.trim(),
    daily_conversation_limit: values.daily_conversation_limit,
    handoff: values.handoff,
    translations: { bn: { greeting: values.greeting_bn.trim() } },
  }
}

export type AssistantField = 'name' | 'greeting' | 'greeting_bn' | 'daily_conversation_limit' | 'handoff'

/** Client checks with the server's limits, in plain words; empty when all is well. */
export function assistantProblems(values: AssistantSettings, hasWhatsapp: boolean): Partial<Record<AssistantField, string>> {
  const out: Partial<Record<AssistantField, string>> = {}
  const name = values.name.trim()
  if (name === '') out.name = 'Give the assistant a name.'
  else if (name.length > ASSISTANT_LIMITS.name) out.name = `Use at most ${ASSISTANT_LIMITS.name} characters.`
  if (values.greeting.trim().length > ASSISTANT_LIMITS.greeting) out.greeting = `Use at most ${ASSISTANT_LIMITS.greeting} characters.`
  if (values.greeting_bn.trim().length > ASSISTANT_LIMITS.greeting) out.greeting_bn = `Use at most ${ASSISTANT_LIMITS.greeting} characters.`
  const limit = values.daily_conversation_limit
  if (!Number.isInteger(limit) || limit < ASSISTANT_LIMITS.dailyMin || limit > ASSISTANT_LIMITS.dailyMax) {
    out.daily_conversation_limit = `Enter a whole number from ${ASSISTANT_LIMITS.dailyMin} to ${ASSISTANT_LIMITS.dailyMax}.`
  }
  if (values.handoff === 'whatsapp' && !hasWhatsapp) out.handoff = 'Your store has no WhatsApp number yet. Add one under Settings & domains, or choose another option.'
  return out
}

/** Server field errors ("assistant.name", "assistant.translations.bn.greeting", …) by page field. */
export function assistantServerErrors(map: Record<string, string>): Partial<Record<AssistantField | 'form', string>> {
  const out: Partial<Record<AssistantField | 'form', string>> = {}
  for (const [key, message] of Object.entries(map)) {
    const k = key.replace(/^assistant\./, '')
    if (k === 'translations.bn.greeting' || k === 'greeting_bn' || k === 'greeting.bn') out.greeting_bn ??= message
    else if (k === 'greeting' || k === 'greeting.en') out.greeting ??= message
    else if (k === 'name' || k === 'daily_conversation_limit' || k === 'handoff') out[k] ??= message
    else out.form ??= message
  }
  return out
}

export const HANDOFF_CHOICES: { value: AssistantHandoff; label: string; hint: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp chat', hint: 'The assistant offers a button that opens WhatsApp with the shopper’s question filled in.' },
  { value: 'contact', label: 'Contact page', hint: 'The assistant offers a link to your store’s contact page. It needs a published page at /pages/contact; without one, no hand-off is shown.' },
  { value: 'none', label: 'No hand-off', hint: 'The assistant does not point shoppers to a person.' },
]

// ---------------------------------------------------------------- words

export const LANGUAGE_WORDS: Record<AssistantLanguage, string> = { en: 'English', bn: 'Bangla' }

const TOOL_WORDS: Record<string, string> = {
  search_products: 'Searched products',
  get_product: 'Looked up a product',
  store_policies: 'Store policies',
  search_help: 'Help pages and FAQ',
  current_offers: 'Current offers',
  my_orders: 'The shopper’s orders',
  order_status: 'Order status',
}

/** A tool's name in plain words (unknown tools: "some_tool" → "Some tool"). */
export function toolLabel(name: string): string {
  return TOOL_WORDS[name] ?? name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

export const REPLY_STATUS_WORDS: Record<Exclude<AssistantReplyStatus, 'ok'>, { label: string; hint: string }> = {
  unavailable: { label: 'AI unavailable', hint: 'The AI could not answer, so the shopper got the standard reply pointing to your hand-off.' },
  limit: { label: 'Limit reached', hint: 'A message, conversation or daily limit was reached, so the shopper got the standard reply.' },
  budget: { label: 'AI allowance used up', hint: 'This month’s AI allowance was used up, so the shopper got the standard reply.' },
}

// ---------------------------------------------------------------- conversations

export type ConversationRow = {
  id: string
  started_at: string | null
  last_message_at: string | null
  language: AssistantLanguage
  signed_in: boolean
  /** Only when the API sends it (the user has customers.view). */
  customer_name: string | null
  message_count: number
  handed_off: boolean
  status: 'open' | 'closed'
  preview: string
}

export type TranscriptMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools: string[]
  status: AssistantReplyStatus
  created_at: string | null
}

export type Transcript = ConversationRow & { messages: TranscriptMessage[] }

const languageOf = (v: unknown): AssistantLanguage => (v === 'bn' ? 'bn' : 'en')
const replyStatusOf = (v: unknown): AssistantReplyStatus => (v === 'unavailable' || v === 'limit' || v === 'budget' ? v : 'ok')

export function normalizeConversation(raw: unknown): ConversationRow {
  const r = isObj(raw) ? raw : {}
  const customer = isObj(r.customer) ? r.customer : null
  const name = str(r.customer_name) ?? (customer ? str(customer.name) : null)
  const preview = str(r.preview) ?? str(r.first_message) ?? str(r.first_message_preview) ?? ''
  return {
    id: str(r.id) ?? '',
    started_at: str(r.started_at) ?? str(r.created_at),
    last_message_at: str(r.last_message_at),
    language: languageOf(r.language),
    signed_in: r.signed_in !== undefined ? bool(r.signed_in) : bool(r.is_signed_in) || customer !== null || name !== null,
    customer_name: name && name.trim() !== '' ? name : null,
    message_count: num(r.message_count),
    handed_off: bool(r.handed_off),
    status: r.status === 'closed' ? 'closed' : 'open',
    preview: preview.length > 80 ? `${preview.slice(0, 79)}…` : preview,
  }
}

export function normalizeMessage(raw: unknown): TranscriptMessage {
  const r = isObj(raw) ? raw : {}
  return {
    id: str(r.id) ?? '',
    role: r.role === 'user' ? 'user' : 'assistant',
    text: str(r.text) ?? '',
    tools: list(r.tools)
      .map((t) => (isObj(t) ? str(t.name) : str(t)))
      .filter((t): t is string => t !== null && t.trim() !== ''),
    status: replyStatusOf(r.status),
    created_at: str(r.created_at),
  }
}

export function normalizeTranscript(raw: unknown): Transcript {
  const r = isObj(raw) ? raw : {}
  const inner = isObj(r.conversation) ? r.conversation : r
  return { ...normalizeConversation(inner), messages: list(r.messages ?? inner.messages).map(normalizeMessage) }
}

// ---------------------------------------------------------------- summary

export type AssistantSummary = {
  conversations: number
  messages: number
  handed_off: number
  /** 0–100, rounded. */
  handed_off_percent: number
  unavailable: number
  limit: number
  budget: number
  top_tools: { name: string; count: number }[]
}

/** handed_off_share may come as 0–1, as a percent number or as a "12.5%" string. */
function percentOf(share: unknown, handedOff: number, conversations: number): number {
  if (share === undefined || share === null || share === '') return conversations > 0 ? Math.round((handedOff / conversations) * 100) : 0
  const text = typeof share === 'string' ? share.replace('%', '').trim() : share
  const value = num(text)
  const percent = typeof share === 'string' && share.includes('%') ? value : value <= 1 ? value * 100 : value
  return Math.min(100, Math.max(0, Math.round(percent)))
}

export function normalizeSummary(raw: unknown): AssistantSummary {
  const r = isObj(raw) ? raw : {}
  const fallbacks = isObj(r.fallbacks) ? r.fallbacks : isObj(r.statuses) ? r.statuses : r
  const conversations = num(r.conversations)
  const handedOff = num(r.handed_off ?? r.handed_off_count)
  return {
    conversations,
    messages: num(r.messages),
    handed_off: handedOff,
    handed_off_percent: percentOf(r.handed_off_share ?? r.handed_off_percent, handedOff, conversations),
    unavailable: num(fallbacks.unavailable),
    limit: num(fallbacks.limit),
    budget: num(fallbacks.budget),
    top_tools: (isObj(r.top_tools)
      ? Object.entries(r.top_tools).map(([name, count]) => ({ name, count: num(count) }))
      : list(r.top_tools).map((t) => (isObj(t) ? { name: str(t.name) ?? str(t.tool) ?? '', count: num(t.count ?? t.uses) } : { name: '', count: 0 }))
    )
      .filter((t) => t.name !== '')
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  }
}

/** "20 Nov, 14:05" in the organization's time zone (browser zone when unknown). */
export function makeDateTime(timeZone: string | undefined) {
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone })
  } catch {
    format = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }
  return (iso: string | null) => {
    if (!iso) return '—'
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? '—' : format.format(date)
  }
}

/** "1 conversation" / "3 conversations". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}
