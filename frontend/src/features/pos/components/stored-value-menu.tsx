import { useState } from 'react'
import { GiftIcon, HandCoinsIcon, SearchIcon, WalletCardsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useCan } from '@/features/auth/use-auth'
import type { CustomerRef } from '@/features/pos/cart-store'
import { CustomerAdvanceDialog } from '@/features/pos/components/customer-advance-dialog'
import { GiftCardBalanceDialog } from '@/features/pos/components/gift-card-balance-dialog'
import { SellGiftCardDialog, type TillContext } from '@/features/pos/components/sell-gift-card-dialog'

type Action = 'sell' | 'advance' | 'balance'

/**
 * POS1b: gift cards and store credit at the till — sell a gift card, take a customer's advance,
 * check what is left on a card. Each item shows only with the permission its endpoint needs.
 */
export function StoredValueMenu({ till, customer, creditBalance }: { till: TillContext; customer: CustomerRef | null; creditBalance: string | null }) {
  const can = useCan()
  const [action, setAction] = useState<Action | null>(null)
  const canSell = can('pos.sell') && can('payments.collect')
  const canAdvance = can('payments.collect')
  const canCheck = can('pos.sell')
  if (!canSell && !canAdvance && !canCheck) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline">
            <WalletCardsIcon data-icon="inline-start" /> Cards &amp; credit
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canSell && (
            <DropdownMenuItem onSelect={() => setAction('sell')}>
              <GiftIcon /> Sell gift card
            </DropdownMenuItem>
          )}
          {canAdvance && (
            <DropdownMenuItem disabled={!customer} onSelect={() => setAction('advance')}>
              <HandCoinsIcon />
              <span className="flex flex-col">
                Customer advance
                {!customer && <span className="text-xs text-muted-foreground">Choose a customer first</span>}
              </span>
            </DropdownMenuItem>
          )}
          {canCheck && (
            <DropdownMenuItem onSelect={() => setAction('balance')}>
              <SearchIcon /> Gift card balance
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {action === 'sell' && <SellGiftCardDialog till={till} customer={customer} onClose={() => setAction(null)} />}
      {action === 'advance' && customer && <CustomerAdvanceDialog till={till} customer={customer} balance={creditBalance} onClose={() => setAction(null)} />}
      {action === 'balance' && <GiftCardBalanceDialog onClose={() => setAction(null)} />}
    </>
  )
}
