import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { priceProblem } from '@/features/pos/till-helpers'
import { trimDecimal } from '@/lib/money'

/**
 * Asks for a unit price: an open-price item being added (required), or a new price for a cart
 * line. Whether a manager must approve is decided by the caller after this dialog.
 */
export function PriceDialog({
  title,
  description,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  title: string
  description: React.ReactNode
  initial: string | null
  submitLabel: string
  onSubmit: (price: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial ? trimDecimal(initial) : '')
  const [touched, setTouched] = useState(false)
  const problem = priceProblem(value)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          id="price-form"
          noValidate
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setTouched(true)
            if (!problem) onSubmit(value.trim())
          }}
        >
          <Label htmlFor="pos-unit-price">Unit price</Label>
          <Input
            id="pos-unit-price"
            inputMode="decimal"
            autoFocus
            className="h-11 font-mono text-lg"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.target.select()}
            aria-invalid={touched && !!problem}
          />
          {touched && problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" form="price-form">{submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
