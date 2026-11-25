import { GiftCodeDialog } from '@/features/gift-cards/components/gift-code-dialog'
import type { CreditNote } from '@/features/returns/api'

/** A completed return's credit note (POS1b "Gift card" refund): its code is shown once. */
export type IssuedCreditNote = CreditNote & { currency: string; returnNumber: string; customerName: string | null }

export function CreditNoteDialog({ note, onDone }: { note: IssuedCreditNote | null; onDone: () => void }) {
  return (
    <GiftCodeDialog
      title="Credit note issued"
      issued={note && { code: note.code, kindLabel: 'Credit note', amount: note.amount, currency: note.currency, expiresAt: note.expires_at, customerName: note.customerName, number: note.returnNumber }}
      onDone={onDone}
    />
  )
}
