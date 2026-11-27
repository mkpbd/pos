import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, toPaginated, type Paginated } from '@/lib/api/client'
import type { SmsEncoding } from '@/features/sms/sms-text'

/**
 * BD1a: the organization's SMS gateway (GET/PATCH /sms/settings), a synchronous test message
 * (POST /sms/test) and the message log (GET /sms/messages). The API key is write-only: the
 * server only says whether one is saved (`api_key_set`).
 */

export const SMS_PERMISSIONS = { view: 'sms.view', manage: 'sms.manage' } as const

export type SmsDriver = 'log' | 'http'
export type SmsHttpMethod = 'GET' | 'POST'
export type SmsHttpBody = 'form' | 'json'
export type SmsPhoneFormat = 'local' | '880' | 'plus880'

export const ORDER_EVENTS = ['order_placed', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled'] as const
export type OrderEvent = (typeof ORDER_EVENTS)[number]

/** POS1d: the receipt of a sale at the till, sent from the till or the sale page ("Send receipt"). */
export const SALE_RECEIPT_EVENT = 'sale_receipt'
/** R1: what a customer owes (scheduled, or "Send due reminder" on the customer's account). */
export const DUE_REMINDER_EVENT = 'due_reminder'
/** BD2b: a signed-in shopper left items in the cart (sent when the shopper has no e-mail address). */
export const CART_REMINDER_EVENT = 'cart_reminder'
const EXTRA_EVENTS = [SALE_RECEIPT_EVENT, DUE_REMINDER_EVENT, CART_REMINDER_EVENT] as const
export type TemplateEvent = OrderEvent | (typeof EXTRA_EVENTS)[number]

export type SmsTemplate = { enabled: boolean; en: string; bn: string }
/** `sale_receipt` (POS1d), `due_reminder` (R1) and `cart_reminder` (BD2b) are present when the server has them. */
export type SmsTemplates = Record<OrderEvent, SmsTemplate> & { sale_receipt?: SmsTemplate; due_reminder?: SmsTemplate; cart_reminder?: SmsTemplate }

/** The events the templates have, in display order: the order events, then the sale receipt and the reminders when the server lists them. */
export function templateEvents(templates: SmsTemplates): TemplateEvent[] {
  return [...ORDER_EVENTS, ...EXTRA_EVENTS.filter((e) => templates[e])]
}

export type SmsSettings = {
  is_enabled: boolean
  driver: SmsDriver
  http_url: string | null
  http_method: SmsHttpMethod
  http_body: SmsHttpBody
  param_to: string
  param_message: string
  param_sender: string | null
  param_api_key: string | null
  api_key_set: boolean
  sender_id: string | null
  extra_params: Record<string, string>
  success_contains: string | null
  phone_format: SmsPhoneFormat
  monthly_limit: number | null
  templates: SmsTemplates
  default_templates: SmsTemplates
  placeholders: string[]
  /** Enabled and able to send (test mode, or a gateway address). */
  ready: boolean
  /** Can send sign-in and checkout codes (not test mode on a production server). */
  otp_ready: boolean
  usage: { month_sent: number; month_failed: number; month_segments: number }
}

export type SmsSettingsInput = Partial<
  Pick<
    SmsSettings,
    | 'is_enabled'
    | 'driver'
    | 'http_url'
    | 'http_method'
    | 'http_body'
    | 'param_to'
    | 'param_message'
    | 'param_sender'
    | 'param_api_key'
    | 'sender_id'
    | 'extra_params'
    | 'success_contains'
    | 'phone_format'
    | 'monthly_limit'
    | 'templates'
  >
> & {
  /** Omitted = keep; null = remove; a string = replace. Never returned. */
  api_key?: string | null
}

export const DEFAULT_PLACEHOLDERS = ['shop', 'name', 'order', 'total', 'link', 'courier', 'tracking', 'tracking_link']

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0)
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback)

function normalizeTemplates(raw: unknown): SmsTemplates {
  const source = isObj(raw) ? raw : {}
  const events: readonly TemplateEvent[] = [...ORDER_EVENTS, ...EXTRA_EVENTS.filter((e) => isObj(source[e]))]
  return Object.fromEntries(
    events.map((event) => {
      const t = isObj(source[event]) ? (source[event] as Obj) : {}
      return [event, { enabled: t.enabled === true, en: str(t.en) ?? '', bn: str(t.bn) ?? '' }]
    }),
  ) as SmsTemplates
}

/** Tolerates missing optional keys so a partial answer still renders. */
export function normalizeSmsSettings(raw: unknown): SmsSettings {
  const r = isObj(raw) ? raw : {}
  const usage = isObj(r.usage) ? r.usage : {}
  const extra = isObj(r.extra_params) ? r.extra_params : {}
  return {
    is_enabled: r.is_enabled === true,
    driver: oneOf(r.driver, ['log', 'http'] as const, 'log'),
    http_url: str(r.http_url),
    http_method: oneOf(r.http_method, ['GET', 'POST'] as const, 'POST'),
    http_body: oneOf(r.http_body, ['form', 'json'] as const, 'form'),
    param_to: str(r.param_to) ?? 'to',
    param_message: str(r.param_message) ?? 'message',
    param_sender: str(r.param_sender),
    param_api_key: str(r.param_api_key),
    api_key_set: r.api_key_set === true,
    sender_id: str(r.sender_id),
    extra_params: Object.fromEntries(Object.entries(extra).filter((e): e is [string, string] => typeof e[1] === 'string')),
    success_contains: str(r.success_contains),
    phone_format: oneOf(r.phone_format, ['local', '880', 'plus880'] as const, '880'),
    monthly_limit: r.monthly_limit === null || r.monthly_limit === undefined ? null : num(r.monthly_limit),
    templates: normalizeTemplates(r.templates),
    default_templates: normalizeTemplates(r.default_templates),
    placeholders: Array.isArray(r.placeholders) && r.placeholders.every((p) => typeof p === 'string') ? (r.placeholders as string[]) : DEFAULT_PLACEHOLDERS,
    ready: r.ready === true,
    otp_ready: r.otp_ready === true,
    usage: { month_sent: num(usage.month_sent), month_failed: num(usage.month_failed), month_segments: num(usage.month_segments) },
  }
}

export const smsKeys = {
  settings: ['sms', 'settings'] as const,
  messages: (params: SmsMessageFilters) => ['sms', 'messages', params] as const,
  allMessages: ['sms', 'messages'] as const,
}

export function useSmsSettingsQuery() {
  return useQuery({
    queryKey: smsKeys.settings,
    queryFn: ({ signal }) => api.get<unknown>('/sms/settings', { signal }).then((r) => normalizeSmsSettings(r.data)),
  })
}

export function useSaveSmsSettingsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SmsSettingsInput) => api.patch<unknown>('/sms/settings', input).then((r) => normalizeSmsSettings(r.data)),
    onSuccess: (data) => {
      queryClient.setQueryData(smsKeys.settings, data)
      // The storefront settings carry sms_ready / otp_ready.
      void queryClient.invalidateQueries({ queryKey: ['storefront', 'settings'] })
    },
  })
}

export type SmsTestResult = {
  status: 'sent' | 'failed'
  error: string | null
  provider_status: number | null
  provider_response: string | null
  segments: number
  encoding: SmsEncoding
}

export function useSendTestSmsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { phone: string; message?: string }) =>
      api.post<unknown>('/sms/test', input).then((r): SmsTestResult => {
        const d = isObj(r.data) ? r.data : {}
        return {
          status: d.status === 'sent' ? 'sent' : 'failed',
          error: str(d.error),
          provider_status: d.provider_status === null || d.provider_status === undefined ? null : num(d.provider_status),
          provider_response: str(d.provider_response),
          segments: num(d.segments),
          encoding: d.encoding === 'unicode' ? 'unicode' : 'gsm',
        }
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: smsKeys.allMessages })
      void queryClient.invalidateQueries({ queryKey: smsKeys.settings })
    },
  })
}

export type SmsStatus = 'queued' | 'sent' | 'failed' | 'skipped'
export type SmsPurpose = TemplateEvent | 'otp' | 'test'

export type SmsMessage = {
  id: string
  to_phone: string
  purpose: SmsPurpose
  body: string
  segments: number
  encoding: SmsEncoding
  driver: SmsDriver
  status: SmsStatus
  error: string | null
  attempts: number
  created_at: string
  sent_at: string | null
  related: { type: string; id: string } | null
}

export type SmsMessageFilters = {
  page: number
  status?: SmsStatus
  purpose?: SmsPurpose
  search?: string
  from?: string
  to?: string
}

export function useSmsMessagesQuery(params: SmsMessageFilters) {
  return useQuery({
    queryKey: smsKeys.messages(params),
    queryFn: ({ signal }): Promise<Paginated<SmsMessage>> => api.get<SmsMessage[]>('/sms/messages', { signal, query: params }).then(toPaginated),
    placeholderData: (previous) => previous,
  })
}

export const PURPOSE_LABELS: Record<SmsPurpose, string> = {
  otp: 'Sign-in / checkout code',
  order_placed: 'Order placed',
  order_confirmed: 'Payment received',
  order_shipped: 'Order shipped',
  order_delivered: 'Order delivered',
  order_cancelled: 'Order cancelled',
  sale_receipt: 'Sale receipt',
  due_reminder: 'Due reminder',
  cart_reminder: 'Cart reminder',
  test: 'Test message',
}

export const STATUS_LABELS: Record<SmsStatus, string> = { queued: 'Queued', sent: 'Sent', failed: 'Failed', skipped: 'Skipped' }
