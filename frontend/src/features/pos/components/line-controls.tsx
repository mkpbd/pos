import { useState } from 'react'
import { PercentIcon, ScanBarcodeIcon, XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { DiscountInput } from '@/features/pos/api'
import { compareDecimal, MONEY_PATTERN, trimDecimal } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * Percent or fixed-amount discount editor, used for a line and for the whole invoice.
 * Limits (permission, product maximum) are enforced by the server when the cart is priced.
 */
export function DiscountPopover({
  value,
  onChange,
  label,
  hint,
  children,
}: {
  value: DiscountInput | null
  onChange: (discount: DiscountInput | null) => void
  label: string
  hint?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<DiscountInput['type']>(value?.type ?? 'percent')
  const [amount, setAmount] = useState(value ? trimDecimal(value.value) : '')
  const valid = MONEY_PATTERN.test(amount.trim()) && (type === 'amount' || compareDecimal(amount.trim(), '100') <= 0)

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setType(value?.type ?? 'percent')
          setAmount(value ? trimDecimal(value.value) : '')
        }
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64" align="end">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!valid) return
            onChange(/^0+(\.0+)?$/.test(amount.trim()) ? null : { type, value: amount.trim() })
            setOpen(false)
          }}
        >
          <div className="text-sm font-medium">{label}</div>
          <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="Discount type">
            {(['percent', 'amount'] as const).map((t) => (
              <Button key={t} type="button" role="radio" aria-checked={type === t} size="sm" variant={type === t ? 'default' : 'outline'} onClick={() => setType(t)}>
                {t === 'percent' ? 'Percent %' : 'Amount'}
              </Button>
            ))}
          </div>
          <Input aria-label="Discount value" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={type === 'percent' ? 'e.g. 10' : 'e.g. 50.00'} />
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          {!valid && amount.trim() !== '' && <p className="text-xs text-destructive">{type === 'percent' ? 'A percentage from 0 to 100.' : 'An amount with up to 2 decimals.'}</p>}
          <div className="flex justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={!value} onClick={() => { onChange(null); setOpen(false) }}>
              <XIcon data-icon="inline-start" /> Remove
            </Button>
            <Button type="submit" size="sm" disabled={!valid}>Apply</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

export function DiscountButton({ discount, ...props }: { discount: DiscountInput | null } & React.ComponentProps<typeof Button>) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" className={cn(discount && 'text-primary')} {...props}>
      <PercentIcon />
    </Button>
  )
}

/** Scan one serial number per unit of a serial-tracked product. */
export function SerialsDialog({ label, quantity, serials, onChange }: { label: string; quantity: string; serials: string[]; onChange: (serials: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<string[]>(serials)
  const [entry, setEntry] = useState('')
  const needed = /^\d+$/.test(quantity) ? Number(quantity) : null

  const add = () => {
    const serial = entry.trim()
    if (serial && !list.some((s) => s.toLowerCase() === serial.toLowerCase())) setList((l) => [...l, serial])
    setEntry('')
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        aria-label={`Serial numbers of ${label}`}
        onClick={() => { setList(serials); setOpen(true) }}
      >
        <ScanBarcodeIcon />
        <Badge variant={needed !== null && serials.length === needed ? 'success' : 'destructive'}>{serials.length}/{needed ?? '?'}</Badge>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Serial numbers</DialogTitle>
            <DialogDescription>{label}: scan one serial number per unit ({needed ?? 'whole units only'}).</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); add() }} className="flex gap-2">
            <Input aria-label="Serial number" autoFocus value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="Scan or type, then Enter" />
            <Button type="submit" variant="outline">Add</Button>
          </form>
          <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
            {list.map((s) => (
              <li key={s} className="flex items-center justify-between rounded border px-2 py-1 font-mono text-sm">
                {s}
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove serial ${s}`} onClick={() => setList((l) => l.filter((x) => x !== s))}><XIcon /></Button>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" onClick={() => { onChange(list); setOpen(false) }}>Save {list.length} serial{list.length === 1 ? '' : 's'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
