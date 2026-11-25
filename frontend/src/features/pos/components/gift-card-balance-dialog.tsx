import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { GIFT_CARD_KINDS, giftCardReasonText, maskedCard, normalizeGiftCode, useLookupGiftCardMutation } from '@/features/pos/stored-value-api'
import { ApiError } from '@/lib/api/client'
import { formatMoney } from '@/lib/money'

/** POS1b: what is left on a gift card, voucher or credit note (type or scan its code). */
export function GiftCardBalanceDialog({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('')
  const lookup = useLookupGiftCardMutation()
  const card = lookup.data
  const checkedCode = lookup.variables

  const check = (e: React.FormEvent) => {
    e.preventDefault()
    const normalized = normalizeGiftCode(code)
    if (normalized) lookup.mutate(normalized)
  }

  const failure = lookup.error
    ? lookup.error instanceof ApiError && lookup.error.status === 429 ? 'Too many gift card checks; wait a minute and try again.' : lookup.error.message
    : null

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gift card balance</DialogTitle>
          <DialogDescription>Type or scan the code of a gift card, voucher or credit note.</DialogDescription>
        </DialogHeader>
        <form onSubmit={check} className="flex gap-2">
          <Input
            aria-label="Gift card code"
            placeholder="XXXX-XXXX-XXXX-XXXX"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="font-mono uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit" disabled={lookup.isPending || normalizeGiftCode(code) === ''}>
            {lookup.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Check
          </Button>
        </form>
        <div aria-live="polite">
          {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
          {card && checkedCode === normalizeGiftCode(code) && (
            card.reason === 'not_found' ? (
              <p role="alert" className="text-sm text-destructive">{giftCardReasonText('not_found')}</p>
            ) : (
              <dl className="grid grid-cols-2 gap-1 rounded-md border p-3 text-sm" data-testid="gift-card-balance">
                <dt className="text-muted-foreground">Card</dt>
                <dd className="text-right">{GIFT_CARD_KINDS[card.kind ?? 'gift_card']} <span className="font-mono">{maskedCard(card.code_last4)}</span></dd>
                <dt className="text-muted-foreground">Balance</dt>
                <dd className="text-right font-mono text-lg font-semibold">{formatMoney(card.balance, card.currency ?? undefined)}</dd>
                <dt className="text-muted-foreground">Expires</dt>
                <dd className="text-right">{card.expires_at ? new Date(card.expires_at).toLocaleDateString() : 'Never'}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="text-right">
                  {card.usable ? <Badge variant="secondary">Can pay</Badge> : <Badge variant="destructive">{giftCardReasonText(card.reason)}</Badge>}
                </dd>
              </dl>
            )
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
