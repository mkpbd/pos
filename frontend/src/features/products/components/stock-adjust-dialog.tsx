import { useId, useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { StoreSelect } from '@/components/common/store-select'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { REASON_LABELS, type AdjustmentReason } from '@/features/inventory/api'
import { useGridStockAdjustmentMutation, type VariantStock } from '@/features/products/api'
import { ApiError } from '@/lib/api/client'
import { trimDecimal } from '@/lib/money'

export type StockTarget = { variant_id: string; label: string; stock: VariantStock | null | undefined }

type Mode = 'add' | 'remove'

const REASONS: Record<Mode, AdjustmentReason[]> = {
  add: ['correction', 'count', 'other'],
  remove: ['correction', 'count', 'damage', 'expiry', 'theft', 'other'],
}

const QUANTITY = /^\d{1,15}(\.\d{1,3})?$/
const WHOLE = /^\d{1,15}(\.0{1,3})?$/

function storeQuantity(stock: VariantStock | null | undefined, storeId: string): string {
  const row = stock?.by_store.find((s) => s.store_id === storeId)
  return trimDecimal(row?.quantity ?? '0')
}

type Props = {
  productId: string
  targets: StockTarget[]
  allowDecimal: boolean
  onClose: () => void
}

/**
 * "Adjust stock" from the variant grid (P1a §2): one Inventory adjustment for the chosen store,
 * with the note "Variant grid" (audited, in a transaction on the server). Not idempotent, so the
 * button is disabled while it posts and the product is fetched again afterwards.
 */
export function StockAdjustDialog({ productId, targets, allowDecimal, onClose }: Props) {
  const ids = useId()
  const post = useGridStockAdjustmentMutation(productId)
  const [storeId, setStoreId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('add')
  const [reason, setReason] = useState<AdjustmentReason>('correction')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = () => {
    const next: Record<string, string> = {}
    if (!storeId) next.store = 'Choose a store.'
    const lines: { variant_id: string; quantity: string }[] = []
    for (const t of targets) {
      const q = (quantities[t.variant_id] ?? '').trim()
      if (q === '') continue
      if (!QUANTITY.test(q) || /^0+(\.0+)?$/.test(q)) next[t.variant_id] = 'A quantity above zero.'
      else if (!allowDecimal && !WHOLE.test(q)) next[t.variant_id] = 'Whole numbers only.'
      else lines.push({ variant_id: t.variant_id, quantity: mode === 'remove' ? `-${q}` : q })
    }
    if (lines.length === 0 && Object.keys(next).every((k) => k === 'store')) next.form = 'Enter a quantity for at least one variant.'
    setErrors(next)
    if (Object.keys(next).length > 0 || !storeId) return

    post.mutate(
      { store_id: storeId, reason, lines },
      {
        onSuccess: (adjustment) => {
          toast.success(`Stock updated (adjustment ${adjustment.number}).`)
          onClose()
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
            const field = error.fieldErrors
            setErrors({ store: field.store_id?.[0] ?? '', form: Object.entries(field).filter(([k]) => k !== 'store_id').map(([, m]) => m[0]).join(' ') || '' })
          } else {
            setErrors({ form: error.message })
          }
        },
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !post.isPending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>Recorded as an inventory adjustment with the note “Variant grid”. You can see it later under Inventory → Adjustments.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!post.isPending) submit()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label>Store</Label>
            <StoreSelect value={storeId} onChange={setStoreId} aria-label="Store for the stock change" invalid={!!errors.store} />
            {errors.store && <p className="text-sm text-destructive">{errors.store}</p>}
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">Change</legend>
            <div className="flex flex-wrap gap-4">
              {(['add', 'remove'] as const).map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`${ids}-mode`}
                    value={m}
                    checked={mode === m}
                    onChange={() => {
                      setMode(m)
                      if (!REASONS[m].includes(reason)) setReason('correction')
                    }}
                    className="size-4 accent-primary"
                  />
                  {m === 'add' ? 'Add stock' : 'Remove stock'}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-reason`}>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as AdjustmentReason)}>
              <SelectTrigger id={`${ids}-reason`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{REASONS[mode].map((r) => <SelectItem key={r} value={r}>{REASON_LABELS[r]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            {targets.map((t) => {
              const id = `${ids}-${t.variant_id}`
              return (
                <div key={t.variant_id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2">
                  <Label htmlFor={id} className="flex flex-col items-start gap-0.5">
                    <span>{mode === 'add' ? 'Add to' : 'Remove from'} {t.label}</span>
                    {storeId && <span className="text-xs font-normal text-muted-foreground">Now in this store: {storeQuantity(t.stock, storeId)}</span>}
                  </Label>
                  <Input
                    id={id}
                    inputMode={allowDecimal ? 'decimal' : 'numeric'}
                    placeholder="0"
                    value={quantities[t.variant_id] ?? ''}
                    aria-invalid={errors[t.variant_id] ? true : undefined}
                    onChange={(e) => setQuantities((q) => ({ ...q, [t.variant_id]: e.target.value }))}
                  />
                  {errors[t.variant_id] && <p className="col-span-2 text-sm text-destructive">{errors[t.variant_id]}</p>}
                </div>
              )
            })}
          </div>
          {errors.form && <p role="alert" className="text-sm text-destructive">{errors.form}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={post.isPending}>Cancel</Button>
            <Button type="submit" disabled={post.isPending}>
              {post.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
              {mode === 'add' ? 'Add stock' : 'Remove stock'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
