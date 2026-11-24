import type { SmsMessage, SmsSettings, SmsTemplates } from '@/features/sms/api'
import { ADMIN_PERMISSIONS, makeCurrentUser } from '@/test/fixtures'

export const SMS_ADMIN = () => makeCurrentUser({ permissions: [...ADMIN_PERMISSIONS, 'sms.view', 'sms.manage'] })
export const SMS_VIEWER = () => makeCurrentUser({ permissions: ['branches.view', 'sms.view'] })

export const defaultTemplates = (): SmsTemplates => ({
  order_placed: { enabled: true, en: '{shop}: Order {order} received. Total Tk {total}. Track: {link}', bn: '{shop}: আপনার অর্ডার {order} গৃহীত হয়েছে। মোট ৳{total}। ট্র্যাক: {link}' },
  order_confirmed: { enabled: false, en: '{shop}: Payment for order {order} received. Thank you!', bn: '{shop}: অর্ডার {order}-এর পেমেন্ট পেয়েছি। ধন্যবাদ!' },
  order_shipped: { enabled: true, en: '{shop}: Order {order} handed to {courier}, tracking {tracking} {tracking_link}', bn: '{shop}: অর্ডার {order} {courier}-এ দেওয়া হয়েছে, ট্র্যাকিং {tracking} {tracking_link}' },
  order_delivered: { enabled: true, en: '{shop}: Order {order} delivered. Thank you for shopping with us!', bn: '{shop}: অর্ডার {order} পৌঁছে গেছে। ধন্যবাদ!' },
  order_cancelled: { enabled: true, en: '{shop}: Order {order} was cancelled.', bn: '{shop}: অর্ডার {order} বাতিল হয়েছে।' },
})

export const smsSettings = (overrides: Partial<SmsSettings> = {}): SmsSettings => ({
  is_enabled: false,
  driver: 'log',
  http_url: null,
  http_method: 'POST',
  http_body: 'form',
  param_to: 'to',
  param_message: 'message',
  param_sender: null,
  param_api_key: null,
  api_key_set: false,
  sender_id: null,
  extra_params: {},
  success_contains: null,
  phone_format: '880',
  monthly_limit: null,
  templates: defaultTemplates(),
  default_templates: defaultTemplates(),
  placeholders: ['shop', 'name', 'order', 'total', 'link', 'courier', 'tracking', 'tracking_link'],
  ready: false,
  otp_ready: false,
  usage: { month_sent: 1234, month_failed: 5, month_segments: 1502 },
  ...overrides,
})

export const smsMessage = (overrides: Partial<SmsMessage> = {}): SmsMessage => ({
  id: 'm-1',
  to_phone: '01712345678',
  purpose: 'order_placed',
  body: 'Corner Shop: Order W-10025 received. Total Tk 1,250.00. Track: https://corner.test/order/W-10025',
  segments: 1,
  encoding: 'gsm',
  driver: 'http',
  status: 'sent',
  error: null,
  attempts: 1,
  created_at: '2026-11-24T08:30:00Z',
  sent_at: '2026-11-24T08:30:02Z',
  related: { type: 'order', id: 'o-1' },
  ...overrides,
})

export const paged = (total: number, page = 1, perPage = 20) => ({ pagination: { current_page: page, per_page: perPage, total, last_page: Math.max(1, Math.ceil(total / perPage)) } })
