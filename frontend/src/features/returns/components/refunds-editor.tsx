import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Settlement } from '@/features/returns/api'
import { newRefundKey, refundsRemaining, type RefundRow } from '@/features/returns/refunds'
import { compareDecimal, formatMoney, isZeroDecimal } from '@/lib/money'
import type { RefundMethod } from '@/lib/payment-methods'
import { cn } from '@/lib/utils'

type Props = {
  settlement: Settlement
  currency?: string
  rows: RefundRow[]
  onChange: (rows: RefundRow[]) => void
  /** Server field errors keyed like "refunds.0.amount". */
  errors?: Record<string, string>
  disabled?: boolean
}

/** Split the refund due over the methods the invoice allows; must add up exactly. */
export function RefundsEditor({ settlement, currency, rows, onChange, errors = {}, disabled }: Props) {
  const used = new Set(rows.map((r) => r.method))
  const unused = settlement.refundable.filter((o) => !used.has(o.method))
  const remaining = refundsRemaining(rows, settlement.refund_due)
  const balanced = isZeroDecimal(remaining)
  const update = (key: string, patch: Partial<RefundRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  return (
    <div className="flex flex-col gap-3" role="group" aria-label="Refunds">
      {rows.map((row, i) => {
        const option = settlement.refundable.find((o) => o.method === row.method)
        const choices = settlement.refundable.filter((o) => o.method === row.method || !used.has(o.method))
        const amountError = errors[`refunds.${i}.amount`]
        const methodError = errors[`refunds.${i}.method`]
        const referenceError = errors[`refunds.${i}.reference`]
        return (
          <div key={row.key} className="flex flex-col gap-1">
            <div className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-start gap-2 sm:grid-cols-[10rem_8rem_minmax(0,1fr)_auto]">
              <Select value={row.method} onValueChange={(v) => update(row.key, { method: v as RefundMethod })} disabled={disabled}>
                <SelectTrigger className="w-full" aria-label={`Refund method ${i + 1}`} aria-invalid={methodError ? true : undefined}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {choices.map((o) => <SelectItem key={o.method} value={o.method}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                aria-label={`Refund amount ${i + 1}`}
                aria-invalid={amountError ? true : undefined}
                inputMode="decimal"
                className="text-right font-mono"
                value={row.amount}
                disabled={disabled}
                onChange={(e) => update(row.key, { amount: e.target.value })}
              />
              {row.method === 'cash' ? (
                <span className="col-span-3 row-start-2 text-xs text-muted-foreground sm:col-span-1 sm:row-start-auto sm:self-center">Paid out of your open register session.</span>
              ) : (
                <Input
                  aria-label={`Refund reference ${i + 1}`}
                  aria-invalid={referenceError ? true : undefined}
                  placeholder="Reference (optional)"
                  className="col-span-3 row-start-2 sm:col-span-1 sm:row-start-auto"
                  maxLength={100}
                  value={row.reference}
                  disabled={disabled}
                  onChange={(e) => update(row.key, { reference: e.target.value })}
                />
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove refund ${i + 1}`}
                className="col-start-3 row-start-1 sm:col-start-auto"
                disabled={disabled}
                onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
              >
                <Trash2Icon />
              </Button>
            </div>
            {option?.max != null && <p className="text-xs text-muted-foreground">Up to {formatMoney(option.max, currency)} (paid this way on the invoice).</p>}
            {(amountError || methodError || referenceError) && <p className="text-sm text-destructive">{amountError ?? methodError ?? referenceError}</p>}
          </div>
        )
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || unused.length === 0}
          onClick={() => {
            const next = unused[0]
            if (!next) return
            onChange([...rows, { key: newRefundKey(), method: next.method, amount: compareDecimal(remaining, '0') > 0 && !remaining.startsWith('-') ? remaining : '', reference: '' }])
          }}
        >
          <PlusIcon data-icon="inline-start" /> Add refund method
        </Button>
        <p role="status" className={cn('text-sm', balanced ? 'text-muted-foreground' : 'font-medium text-destructive')}>
          Refund due {formatMoney(settlement.refund_due, currency)} · {balanced ? 'fully allocated' : remaining.startsWith('-') ? `over by ${formatMoney(remaining.slice(1))}` : `${formatMoney(remaining)} left to allocate`}
        </p>
      </div>
    </div>
  )
}
