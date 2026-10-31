import { useCallback, useState } from 'react'
import { PrinterIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Sale } from '@/features/sales/api'
import { Receipt, ReceiptPrinter } from '@/features/sales/components/receipt'
import { RECEIPT_FORMATS, type ReceiptFormat } from '@/features/sales/receipt-formats'

const FORMAT_KEY = 'pos-receipt-format'

function savedFormat(): ReceiptFormat {
  const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(FORMAT_KEY)
  return saved && saved in RECEIPT_FORMATS ? (saved as ReceiptFormat) : '80mm'
}

/** Receipt preview with a format choice (remembered per device) and printing. */
export function ReceiptDialog({
  sale,
  open,
  onOpenChange,
  title,
  description,
  closeLabel = 'Close',
}: {
  sale: Sale | null
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  closeLabel?: string
}) {
  const [format, setFormat] = useState<ReceiptFormat>(savedFormat)
  const [printing, setPrinting] = useState(false)
  const donePrinting = useCallback(() => setPrinting(false), [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription asChild><div>{description}</div></DialogDescription>}
        </DialogHeader>
        {sale && (
          <div className="flex justify-center overflow-x-auto rounded-md border bg-muted/40 p-3">
            <div className="shadow-sm">
              <Receipt sale={sale} format={format} />
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <Select
            value={format}
            onValueChange={(v) => {
              setFormat(v as ReceiptFormat)
              try { localStorage.setItem(FORMAT_KEY, v) } catch { /* storage unavailable */ }
            }}
          >
            <SelectTrigger className="w-44" aria-label="Receipt format"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(RECEIPT_FORMATS) as ReceiptFormat[]).map((f) => <SelectItem key={f} value={f}>{RECEIPT_FORMATS[f]}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!sale || printing} onClick={() => setPrinting(true)}>
              <PrinterIcon data-icon="inline-start" /> Print
            </Button>
            <Button autoFocus onClick={() => onOpenChange(false)}>{closeLabel}</Button>
          </div>
        </DialogFooter>
        {sale && printing && <ReceiptPrinter sale={sale} format={format} onDone={donePrinting} />}
      </DialogContent>
    </Dialog>
  )
}
