import { z } from 'zod'
import type { PaymentGateway, PaymentGatewayInput } from '@/features/online-payments/api'
import { readBn, toTranslationsInput, translationsSchema } from '@/features/translations/translations'
import { ApiError } from '@/lib/api/client'
import { MONEY_PATTERN } from '@/lib/money'
import { BD_MOBILE, normalizeBdPhone } from '@/storefront/account/schemas'

export const DISPLAY_NAME_MAX = 60
export const INSTRUCTIONS_MAX = 2000
/** Translatable checkout texts (E12b). */
const GATEWAY_TRANSLATIONS = [{ name: 'display_name', max: DISPLAY_NAME_MAX }, { name: 'instructions', max: INSTRUCTIONS_MAX }] as const
const GATEWAY_TRANSLATION_NAMES = GATEWAY_TRANSLATIONS.map((f) => f.name)

/** BD1c: bKash / Nagad / Rocket "Send Money" — the shopper sends money to the shop's number and types the transaction ID. */
export const SEND_MONEY_CODES = ['bkash_manual', 'nagad_manual', 'rocket_manual'] as const
export type SendMoneyCode = (typeof SEND_MONEY_CODES)[number]

/** Methods configured on the page, in display order (online gateways arrive later). */
export const OFFLINE_CODES = ['cod', 'bank_transfer', ...SEND_MONEY_CODES] as const
export type ConfiguredCode = (typeof OFFLINE_CODES)[number]

export function isSendMoneyCode(code: string): code is SendMoneyCode {
  return (SEND_MONEY_CODES as readonly string[]).includes(code)
}

export const ACCOUNT_TYPES = ['personal', 'agent', 'merchant'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = { personal: 'Personal', agent: 'Agent', merchant: 'Merchant' }

const sendMoneyCopy = (wallet: string) => ({
  title: `${wallet} (Send Money)`,
  description: `The customer sends the money to your ${wallet} number from their phone and types the transaction ID (TrxID). You check it in your ${wallet} app and confirm it on the order. Unpaid orders are cancelled after the hold time.`,
  instructionsHint: `Optional extra steps shown with the number, e.g. “Use Send Money, not Cash Out. Write the order number as the reference.”`,
})

export const GATEWAY_COPY: Record<ConfiguredCode, { title: string; description: string; instructionsHint: string }> = {
  cod: {
    title: 'Cash on delivery',
    description: 'The customer pays the courier when the parcel arrives. Orders are confirmed at once.',
    instructionsHint: 'Optional note shown with the order, e.g. “Please keep the exact amount ready.”',
  },
  bank_transfer: {
    title: 'Bank transfer',
    description: 'The customer transfers the money first; you confirm the payment on the order. Unpaid orders are cancelled after the hold time.',
    instructionsHint: 'Bank, account name and number, and what to write as the reference. Shown after the order is placed and in the confirmation e-mail.',
  },
  bkash_manual: sendMoneyCopy('bKash'),
  nagad_manual: sendMoneyCopy('Nagad'),
  rocket_manual: sendMoneyCopy('Rocket'),
}

const holdsOrders = (code: string) => code === 'bank_transfer' || isSendMoneyCode(code)

export const gatewaySchema = z
  .object({
    code: z.string(),
    is_enabled: z.boolean(),
    display_name: z.string().trim().min(1, 'Required.').max(60),
    instructions: z.string().trim().max(2000),
    hold_hours: z.string().trim(),
    max_order_total: z.string().trim(),
    account_number: z.string().trim(),
    account_type: z.enum(ACCOUNT_TYPES),
    translations: translationsSchema(GATEWAY_TRANSLATIONS),
  })
  .superRefine((v, ctx) => {
    if (holdsOrders(v.code)) {
      const hours = Number(v.hold_hours)
      if (!/^\d+$/.test(v.hold_hours) || hours < 1 || hours > 168) ctx.addIssue({ code: 'custom', path: ['hold_hours'], message: 'Whole hours between 1 and 168.' })
    }
    if (v.code === 'bank_transfer' && v.is_enabled && !v.instructions) ctx.addIssue({ code: 'custom', path: ['instructions'], message: 'Tell customers where to send the money.' })
    if (isSendMoneyCode(v.code)) {
      const number = normalizeBdPhone(v.account_number)
      if (number !== '' && !BD_MOBILE.test(number)) ctx.addIssue({ code: 'custom', path: ['account_number'], message: 'Enter a Bangladeshi mobile number, e.g. 01712345678.' })
      else if (number === '' && v.is_enabled) ctx.addIssue({ code: 'custom', path: ['account_number'], message: 'Enter the number customers send the money to.' })
    }
    if (v.code === 'cod' && v.max_order_total !== '' && !MONEY_PATTERN.test(v.max_order_total)) {
      ctx.addIssue({ code: 'custom', path: ['max_order_total'], message: 'A non-negative amount with at most 2 decimals, or empty.' })
    }
  })

export type GatewayValues = z.infer<typeof gatewaySchema>
export const GATEWAY_FIELDS = ['is_enabled', 'display_name', 'instructions', 'hold_hours', 'max_order_total', 'account_number', 'account_type', 'translations'] as const

const text = (v: unknown): string => (typeof v === 'number' || typeof v === 'string' ? String(v) : '')
const accountType = (v: unknown): AccountType => ((ACCOUNT_TYPES as readonly unknown[]).includes(v) ? (v as AccountType) : 'personal')

export function toGatewayValues(g: PaymentGateway): GatewayValues {
  return {
    code: g.code,
    is_enabled: g.is_enabled,
    display_name: g.display_name,
    instructions: g.instructions ?? '',
    hold_hours: text(g.settings.hold_hours) || (isSendMoneyCode(g.code) ? '24' : '48'),
    max_order_total: text(g.settings.max_order_total),
    account_number: text(g.settings.account_number),
    account_type: accountType(g.settings.account_type),
    translations: { bn: readBn(g.translations, GATEWAY_TRANSLATION_NAMES) },
  }
}

/** Keeps settings this form does not edit; only the method's own settings are written. */
export function toGatewayInput(g: PaymentGateway, v: GatewayValues): PaymentGatewayInput {
  const settings: Record<string, unknown> = { ...g.settings }
  if (holdsOrders(g.code)) settings.hold_hours = Number(v.hold_hours)
  if (g.code === 'cod') settings.max_order_total = v.max_order_total || null
  if (isSendMoneyCode(g.code)) {
    settings.account_number = normalizeBdPhone(v.account_number) || null
    settings.account_type = v.account_type
  }
  return {
    is_enabled: v.is_enabled,
    display_name: v.display_name,
    instructions: v.instructions || null,
    settings,
    sort_order: g.sort_order,
    translations: toTranslationsInput(v.translations.bn, GATEWAY_TRANSLATION_NAMES, g.translations),
  }
}

/** The server reports method settings as `settings.account_number`; the form's fields are flat. */
export function flattenSettingsErrors(error: unknown): unknown {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return error
  const details = Object.fromEntries(Object.entries(error.fieldErrors).map(([key, messages]) => [key.startsWith('settings.') ? key.slice('settings.'.length) : key, messages]))
  return new ApiError(error.status, error.code, error.message, details, error.requestId)
}
