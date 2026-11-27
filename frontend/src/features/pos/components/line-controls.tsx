import { useState } from 'react'
import { PercentIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  defaultOpen = false,
  children,
}: {
  value: DiscountInput | null
  onChange: (discount: DiscountInput | null) => void
  label: string
  hint?: string
  /** POS1a: opens on mount (right after a manager approved discounts). */
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
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
