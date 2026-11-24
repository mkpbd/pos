import { InfoIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocale } from '../i18n/locale'
import { formatPrice } from '../money'
import type { CodAdvance, ManualPaymentOption } from '../types'
import { accountTypeLabel, methodNames } from './manual-methods'

/*
 * BD1c: what the checkout and the landing-page order form say next to the payment choices — the
 * shop's number for a Send Money method, and the advance a cash-on-delivery order needs.
 */

/** "Send the money to 01XXXXXXXXX (Personal) after placing the order." */
export function ManualMethodNote({ method, className }: { method: Partial<Pick<ManualPaymentOption, 'account_number' | 'account_type'>>; className?: string }) {
  const { t } = useLocale()
  return (
    <span className={cn('block text-sm', className)} data-testid="manual-method-note">
      {method.account_number ? t('payments.checkout.sendAfter', { number: method.account_number, type: accountTypeLabel(t, method.account_type) }) : t('payments.checkout.payAfter')}
    </span>
  )
}

/** "Pay the delivery charge of ৳120 in advance by bKash / Nagad after placing your order. The rest is paid in cash on delivery." */
export function CodAdvanceNotice({ advance, currency, className }: { advance: CodAdvance; currency: string | null; className?: string }) {
  const { t } = useLocale()
  const methods = methodNames(Array.isArray(advance.methods) ? advance.methods : [])
  return (
    <span role="note" className={cn('mt-1 flex items-start gap-2 rounded-md bg-sf-canvas px-3 py-2 text-sm font-medium text-sf-heading', className)} data-testid="cod-advance-notice">
      <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{t('payments.codAdvance.notice', { amount: formatPrice(advance.amount, currency), methods: methods || 'bKash / Nagad / Rocket' })}</span>
    </span>
  )
}
