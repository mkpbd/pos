import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CopyIcon, PrinterIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAuth } from '@/features/auth/use-auth'
import { formatGiftCode } from '@/features/gift-cards/api'
import { copyText } from '@/features/marketing/clipboard'
import { formatMoney } from '@/lib/money'

/** What was just issued; `code` is the full code, which the server never returns again. */
export type IssuedCode = {
  code: string
  /** "Voucher", "Credit note", "Gift card". */
  kindLabel: string
  amount: string
  currency: string
  expiresAt: string | null
  customerName?: string | null
  /** A document number to print with it (GCS-…, the return number). */
  number?: string | null
}

const day = (iso: string, timeZone?: string) => new Date(iso).toLocaleDateString(undefined, { timeZone, dateStyle: 'medium' })

function Slip({ issued, organizationName, timeZone }: { issued: IssuedCode; organizationName?: string | null; timeZone?: string }) {
  return (
    <div className="flex w-[72mm] flex-col gap-1 bg-white p-[4mm] text-center font-mono text-[12px] text-black" data-testid="gift-code-slip">
      {organizationName && <div className="text-[14px] font-bold">{organizationName}</div>}
      <div className="font-bold uppercase">{issued.kindLabel}</div>
      {issued.number && <div>{issued.number}</div>}
      <div className="my-1 border-t border-dashed border-black" />
      <div className="text-[16px] font-bold tracking-wider">{formatGiftCode(issued.code)}</div>
      <div>Value {formatMoney(issued.amount, issued.currency)}</div>
      <div>{issued.expiresAt ? `Valid until ${day(issued.expiresAt, timeZone)}` : 'Does not expire'}</div>
      {issued.customerName && <div>For {issued.customerName}</div>}
      <div className="my-1 border-t border-dashed border-black" />
      <div>Keep this code safe: it pays like cash.</div>
    </div>
  )
}

/** Prints only the slip (see `.print-root` in index.css). */
function SlipPrinter({ onDone, ...props }: Parameters<typeof Slip>[0] & { onDone: () => void }) {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      window.print()
      onDone()
    })
    return () => cancelAnimationFrame(frame)
  }, [onDone])

  return createPortal(
    <div className="print-root">
      <style>{'@page { size: 80mm auto; margin: 0 }'}</style>
      <Slip {...props} />
    </div>,
    document.body,
  )
}

/**
 * Shows a freshly issued gift card / voucher / credit note code exactly once, with copy and print.
 * It only closes through "Done" (not by Escape or a click outside), so the code is not lost by accident.
 */
export function GiftCodeDialog({ issued, title, onDone }: { issued: IssuedCode | null; title: string; onDone: () => void }) {
  const me = useAuth()
  const [printing, setPrinting] = useState(false)
  const donePrinting = useCallback(() => setPrinting(false), [])
  const timeZone = me.organization?.timezone
  const code = issued ? formatGiftCode(issued.code) : ''

  return (
    <Dialog open={issued !== null} onOpenChange={(o) => { if (!o) onDone() }}>
      <DialogContent showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {issued && <>{issued.kindLabel} worth <span className="font-mono">{formatMoney(issued.amount, issued.currency)}</span>{issued.customerName && ` for ${issued.customerName}`}.</>}
          </DialogDescription>
        </DialogHeader>
        {issued && (
          <div className="flex flex-col gap-3">
            <div role="note" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <p className="font-medium">Copy or print the code now — it won’t be shown again.</p>
              <p className="text-muted-foreground">Anyone holding the code can spend it. Only the last 4 characters are kept on file.</p>
            </div>
            <output aria-label="Code" className="block rounded-md border bg-muted/40 px-3 py-3 text-center font-mono text-lg font-semibold tracking-wider break-all sm:text-xl" data-testid="gift-code">
              {code}
            </output>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {issued.number && <><dt className="text-muted-foreground">Number</dt><dd className="font-mono">{issued.number}</dd></>}
              <dt className="text-muted-foreground">Valid until</dt>
              <dd>{issued.expiresAt ? day(issued.expiresAt, timeZone) : 'Does not expire'}</dd>
            </dl>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => void copyText(code, 'Code copied.')}><CopyIcon data-icon="inline-start" /> Copy code</Button>
          <Button variant="outline" disabled={printing} onClick={() => setPrinting(true)}><PrinterIcon data-icon="inline-start" /> Print</Button>
          <Button onClick={onDone}>Done</Button>
        </DialogFooter>
        {issued && printing && <SlipPrinter issued={issued} organizationName={me.organization?.name} timeZone={timeZone} onDone={donePrinting} />}
      </DialogContent>
    </Dialog>
  )
}
