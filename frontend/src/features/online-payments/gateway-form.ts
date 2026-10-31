import { z } from 'zod'
import type { PaymentGateway, PaymentGatewayInput } from '@/features/online-payments/api'
import { MONEY_PATTERN } from '@/lib/money'

/** Methods configured in this phase, in display order (online gateways arrive later). */
export const OFFLINE_CODES = ['cod', 'bank_transfer'] as const

export const GATEWAY_COPY: Record<(typeof OFFLINE_CODES)[number], { title: string; description: string; instructionsHint: string }> = {
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
}

export const gatewaySchema = z
  .object({
    code: z.string(),
    is_enabled: z.boolean(),
    display_name: z.string().trim().min(1, 'Required.').max(60),
    instructions: z.string().trim().max(2000),
    hold_hours: z.string().trim(),
    max_order_total: z.string().trim(),
  })
  .superRefine((v, ctx) => {
    if (v.code === 'bank_transfer') {
      const hours = Number(v.hold_hours)
      if (!/^\d+$/.test(v.hold_hours) || hours < 1 || hours > 168) ctx.addIssue({ code: 'custom', path: ['hold_hours'], message: 'Whole hours between 1 and 168.' })
      if (v.is_enabled && !v.instructions) ctx.addIssue({ code: 'custom', path: ['instructions'], message: 'Tell customers where to send the money.' })
    }
    if (v.code === 'cod' && v.max_order_total !== '' && !MONEY_PATTERN.test(v.max_order_total)) {
      ctx.addIssue({ code: 'custom', path: ['max_order_total'], message: 'A non-negative amount with at most 2 decimals, or empty.' })
    }
  })

export type GatewayValues = z.infer<typeof gatewaySchema>
export const GATEWAY_FIELDS = ['is_enabled', 'display_name', 'instructions', 'hold_hours', 'max_order_total'] as const

const text = (v: unknown): string => (typeof v === 'number' || typeof v === 'string' ? String(v) : '')

export function toGatewayValues(g: PaymentGateway): GatewayValues {
  return {
    code: g.code,
    is_enabled: g.is_enabled,
    display_name: g.display_name,
    instructions: g.instructions ?? '',
    hold_hours: text(g.settings.hold_hours) || '48',
    max_order_total: text(g.settings.max_order_total),
  }
}

/** Keeps settings this form does not edit; only the method's own setting is written. */
export function toGatewayInput(g: PaymentGateway, v: GatewayValues): PaymentGatewayInput {
  const settings: Record<string, unknown> = { ...g.settings }
  if (g.code === 'bank_transfer') settings.hold_hours = Number(v.hold_hours)
  if (g.code === 'cod') settings.max_order_total = v.max_order_total || null
  return { is_enabled: v.is_enabled, display_name: v.display_name, instructions: v.instructions || null, settings, sort_order: g.sort_order }
}
