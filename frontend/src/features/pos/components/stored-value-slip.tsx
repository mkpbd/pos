import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import type { ReceiptFormat } from '@/features/sales/receipt-formats'

/**
 * POS1b: the slip for money taken at the till that is not a sale — a gift card sold (with its
 * full code, shown and printed this once) or a customer advance. Same look as the sale receipt.
 */
export type SlipData = {
  organization: string | null
  branch: string | null
  title: string
  number: string
  at: string
  cashier: string | null
  rows: { label: string; value: string; bold?: boolean }[]
  /** The full gift card code (grouped); never stored, only shown and printed now. */
  code?: string
  footer?: string
}

const PAGE: Record<ReceiptFormat, string> = {
  '58mm': '@page { size: 58mm auto; margin: 0 }',
  '80mm': '@page { size: 80mm auto; margin: 0 }',
  a4: '@page { size: A4; margin: 15mm }',
}

export function StoredValueSlip({ slip, format = '80mm' }: { slip: SlipData; format?: ReceiptFormat }) {
  const thermal = format !== 'a4'

  return (
    <div
      data-testid="stored-value-slip"
      className={cn(
        'bg-white text-black',
        thermal ? 'font-mono text-[11px] leading-snug' : 'w-[120mm] p-2 text-sm',
        format === '58mm' && 'w-[48mm] px-[2mm] py-[3mm]',
        format === '80mm' && 'w-[72mm] px-[3mm] py-[4mm]',
      )}
    >
      <div className="text-center">
        {slip.organization && <div className={cn('font-bold', thermal ? 'text-[13px]' : 'text-xl')}>{slip.organization}</div>}
        {slip.branch && <div>{slip.branch}</div>}
      </div>
      <div className="my-1 border-t border-dashed border-black" />
      <div>{slip.title}: <b>{slip.number}</b></div>
      <div>{new Date(slip.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</div>
      {slip.cashier && <div>Cashier: {slip.cashier}</div>}
      <div className="my-1 border-t border-dashed border-black" />
      {slip.code && (
        <div className="my-1 text-center">
          <div>Card code</div>
          <div className={cn('font-bold tracking-wider', thermal ? 'text-[13px]' : 'text-lg')} data-testid="gift-card-code">{slip.code}</div>
        </div>
      )}
      <div className="flex flex-col">
        {slip.rows.map((r) => (
          <div key={r.label} className={cn('flex justify-between gap-2', r.bold && 'font-bold')}>
            <span>{r.label}</span>
            <span>{r.value}</span>
          </div>
        ))}
      </div>
      <div className="my-1 border-t border-dashed border-black" />
      <div className="text-center">{slip.footer ?? 'Thank you!'}</div>
    </div>
  )
}

/** Prints the slip through the print-only portal (like the sale receipt). */
export function SlipPrinter({ slip, format, onDone }: { slip: SlipData; format: ReceiptFormat; onDone: () => void }) {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      window.print()
      onDone()
    })
    return () => cancelAnimationFrame(frame)
  }, [onDone])

  return createPortal(
    <div className="print-root">
      <style>{PAGE[format]}</style>
      <StoredValueSlip slip={slip} format={format} />
    </div>,
    document.body,
  )
}
