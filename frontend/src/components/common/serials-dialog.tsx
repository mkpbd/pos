import { useState, type FormEvent } from 'react'
import { ScanBarcodeIcon, XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useStoreSerialsQuery } from '@/features/inventory/api'

type Props = {
  /** What the serials belong to (product name), shown in the dialog. */
  label: string
  /** Units that need a serial each; anything but a whole number shows "?". */
  quantity: string
  serials: string[]
  onChange: (serials: string[]) => void
  /** Accessible name of the opening button (default "Serial numbers of {label}"). */
  buttonLabel?: string
  /** ST2d issues: serials that may be picked, e.g. those that came on a receipt. */
  available?: string[]
  /** ST2d issues: offer the serials in stock at this store (loaded when the dialog opens). */
  pickFrom?: { storeId: string | null | undefined; variantId: string }
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * Scan one serial number per unit of a serial-tracked product (till lines and, since ST2d, stock
 * and purchase document lines). For issues it also lists the serials that can be picked; typing a
 * serial is still allowed — the server checks every serial.
 */
export function SerialsDialog({ label, quantity, serials, onChange, buttonLabel, available, pickFrom }: Props) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<string[]>(serials)
  const [entry, setEntry] = useState('')
  const needed = /^\d+$/.test(quantity) ? Number(quantity) : null
  const stock = useStoreSerialsQuery(pickFrom?.storeId, pickFrom?.variantId, open && !!pickFrom && !available)
  const choices = available ?? (pickFrom ? (stock.data ?? []) : null)

  const add = (e: FormEvent) => {
    e.preventDefault()
    // The dialog may sit inside a document form: do not submit that one.
    e.stopPropagation()
    // A comma-separated list (pasted) adds every serial.
    const next = [...list]
    for (const serial of entry.split(',').map((s) => s.trim())) if (serial && !next.some((s) => same(s, serial))) next.push(serial)
    setList(next)
    setEntry('')
  }
  const toggle = (serial: string) => setList((l) => (l.some((s) => same(s, serial)) ? l.filter((s) => !same(s, serial)) : [...l, serial]))

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        aria-label={buttonLabel ?? `Serial numbers of ${label}`}
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
          <form onSubmit={add} className="flex gap-2">
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
          {choices && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">
                {available ? 'Pick from this document' : 'Pick from stock at this store'}
                {pickFrom && !available && stock.isPending ? ' …' : choices.length === 0 ? ': none listed' : ''}
              </p>
              <div role="group" aria-label="Serials to pick" className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                {choices.map((s) => {
                  const picked = list.some((x) => same(x, s))
                  return (
                    <Button key={s} type="button" size="sm" variant={picked ? 'default' : 'outline'} className="h-7 font-mono" aria-pressed={picked} onClick={() => toggle(s)}>{s}</Button>
                  )
                })}
              </div>
            </div>
          )}
          <p className="text-sm" aria-live="polite">{list.length} of {needed ?? '?'} entered</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" onClick={() => { onChange(list); setOpen(false) }}>Save {list.length} serial{list.length === 1 ? '' : 's'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
