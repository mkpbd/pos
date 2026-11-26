import { useMemo, useState } from 'react'
import { SendIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCan } from '@/features/auth/use-auth'
import { fetchReceiptLink, saleDocument, tookCash } from '@/features/pos/printing/receipt-document'
import { TillPrintButton, type TillPrintJob } from '@/features/pos/printing/till-print-button'
import type { Sale } from '@/features/sales/api'
import { ReceiptDialog } from '@/features/sales/components/receipt-dialog'
import { SendReceiptDialog } from '@/features/sales/components/send-receipt-dialog'

/**
 * POS1d: the receipt at the till — the receipt dialog with the till's printer (silent printing and
 * the drawer kick after a fresh sale, see `TillPrintButton`) and "Send receipt" (SMS / e-mail).
 */
export function TillReceiptDialog({
  sale,
  fresh = false,
  cash,
  ...props
}: {
  sale: Sale | null
  /** Just completed: prints by itself (and opens the drawer when cash moved). */
  fresh?: boolean
  /** Cash moved in the transaction (default: the sale has a cash payment). */
  cash?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  closeLabel?: string
}) {
  const can = useCan()
  const [sending, setSending] = useState(false)
  const canSend = can('sales.view') && can('pos.sell')
  const tookCashHere = sale ? (cash ?? tookCash(sale)) : false

  const job = useMemo<TillPrintJob | null>(() => {
    if (!sale) return null
    return {
      key: `sale:${sale.id}`,
      cash: tookCashHere,
      build: async () => saleDocument(sale, sale.status === 'cancelled' ? null : await fetchReceiptLink(sale.id)),
    }
  }, [sale, tookCashHere])

  return (
    <ReceiptDialog
      {...props}
      sale={sale}
      printAction={(browser) => <TillPrintButton job={job} auto={fresh} onBrowserPrint={browser.print} disabled={browser.printing} />}
      actions={sale && canSend && sale.status !== 'cancelled' && (
        <>
          <Button type="button" variant="outline" onClick={() => setSending(true)}>
            <SendIcon data-icon="inline-start" /> Send receipt
          </Button>
          <SendReceiptDialog
            saleId={sale.id}
            customer={sale.customer ? { phone: sale.customer.phone, email: sale.customer.email ?? null } : null}
            open={sending}
            onOpenChange={setSending}
          />
        </>
      )}
    />
  )
}
