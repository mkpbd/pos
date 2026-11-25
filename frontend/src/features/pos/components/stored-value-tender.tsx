import { CheckCircle2Icon, Loader2Icon, XCircleIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GIFT_CARD_KINDS, giftCardReasonText, maskedCard, normalizeGiftCode, type TenderProblem } from '@/features/pos/stored-value-api'
import { checkedCard, type TenderRow } from '@/features/pos/stored-value-tenders'
import { formatMoney } from '@/lib/money'

/**
 * POS1b: the store credit note and gift card code field of the payment dialog. The full gift card
 * code stays in the dialog's state only.
 */

/** Store credit balance under the store credit tender. */
export function StoreCreditNote({ balance, currency, problem }: { balance: string | null; currency: string; problem: TenderProblem | null }) {
  return (
    <>
      <p className="text-xs text-muted-foreground" data-testid="tender-store-credit">
        {balance === null ? 'Store credit balance not known; the server checks it.' : `Store credit balance ${formatMoney(balance, currency)}`}
      </p>
      {problem?.kind === 'store_credit' && <p role="alert" className="text-xs text-destructive">{problem.message}</p>}
    </>
  )
}

/** Code field of a gift card tender: type or scan, Enter (or "Check") looks it up. */
export function GiftCardCodeField({
  index,
  tender,
  currency,
  autoFocus,
  problem,
  onCodeChange,
  onCheck,
}: {
  index: number
  tender: TenderRow
  currency: string
  autoFocus?: boolean
  problem: TenderProblem | null
  onCodeChange: (code: string) => void
  onCheck: () => void
}) {
  const code = normalizeGiftCode(tender.reference)
  const check = tender.check && tender.check.code === code ? tender.check : null
  const card = checkedCard(tender)
  const serverProblem = problem?.kind === 'gift_card' && (problem.last4 === null || code.endsWith(problem.last4)) ? problem : null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <Input
          aria-label={`Gift card code of payment ${index + 1}`}
          placeholder="Type or scan the code"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          className="font-mono uppercase"
          value={tender.reference}
          onChange={(e) => onCodeChange(e.target.value)}
          onKeyDown={(e) => {
            // Scanners end with Enter: check the card instead of completing the sale.
            if (e.key === 'Enter') {
              e.preventDefault()
              onCheck()
            }
          }}
        />
        <Button type="button" variant="outline" disabled={code === '' || check?.status === 'checking'} onClick={onCheck} aria-label={`Check gift card of payment ${index + 1}`}>
          Check
        </Button>
      </div>
      <div className="text-xs" data-testid="gift-card-status" aria-live="polite">
        {check?.status === 'checking' && (
          <span className="flex items-center gap-1 text-muted-foreground"><Loader2Icon className="size-3 animate-spin" aria-hidden /> Checking…</span>
        )}
        {check?.status === 'failed' && <span className="text-destructive">{check.message}</span>}
        {card && card.usable && (
          <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2Icon className="size-3" aria-hidden />
            {GIFT_CARD_KINDS[card.kind ?? 'gift_card']} {maskedCard(card.code_last4)} · balance {formatMoney(card.balance, card.currency ?? currency)}
            {card.expires_at && ` · expires ${new Date(card.expires_at).toLocaleDateString()}`}
          </span>
        )}
        {card && !card.usable && (
          <span className="flex items-center gap-1 text-destructive">
            <XCircleIcon className="size-3" aria-hidden /> {giftCardReasonText(card.reason)}
          </span>
        )}
      </div>
      {serverProblem && <p role="alert" className="text-xs text-destructive">{serverProblem.message}</p>}
    </div>
  )
}
