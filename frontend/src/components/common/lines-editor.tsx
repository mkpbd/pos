import { Controller, useFieldArray, useWatch, type Control, type FieldErrors, type UseFormRegister, type UseFormSetValue } from 'react-hook-form'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { emptyLine, packQuantity, packUnitCost, type LinesForm } from '@/components/common/line-values'
import { SerialsDialog } from '@/components/common/serials-dialog'
import { VariantPicker } from '@/components/common/variant-picker'
import { useBatchesQuery, useStockOnHandQuery } from '@/features/inventory/api'
import { serialsMode, serialsNeeded } from '@/features/inventory/lines'
import { isZeroDecimal, subtractDecimal, trimDecimal } from '@/lib/money'

/** The "Pack" select's single-units choice. */
const UNITS = '__units__'

type Config = {
  /** Show a unit cost column. */
  cost?: 'required' | 'optional'
  /** Show a tax % column. */
  tax?: boolean
  /** Batch handling for batch-tracked products: 'in' asks for number + expiry, 'out' picks an existing batch, 'signed' decides by the quantity's sign. */
  batch?: 'in' | 'out' | 'signed'
  /** Store whose batches can be picked for outgoing lines. */
  storeId?: string | null
  /** Allow negative quantities (adjustments). */
  signed?: boolean
  /** Products are fixed (lines copied from another document). */
  fixedProducts?: boolean
  stockedOnly?: boolean
  currency?: string
  /** Stock count: the quantity is what was counted; shows "In stock now" and the resulting difference per line. */
  count?: boolean
  /** ST2a purchase lines: "Free qty" and "Disc %" columns. */
  discount?: boolean
  /** Placeholder of an empty cost (what the server uses instead); turns off the last-purchase-cost pre-fill. */
  costPlaceholder?: string
  /** ST2d serial-tracked products: 'in' types / scans new serials, 'out' also offers the store's in-stock serials, 'signed' decides by the quantity's sign. */
  serials?: 'in' | 'out' | 'signed'
}

type Props<T extends LinesForm> = {
  control: Control<T>
  register: UseFormRegister<T>
  setValue: UseFormSetValue<T>
  errors: FieldErrors<T>
  config: Config
}

function lineError(errors: FieldErrors<LinesForm>, index: number, field: string): string | undefined {
  const row = (errors.lines as unknown as Record<string, Record<string, { message?: string }>> | undefined)?.[index]
  return row?.[field]?.message
}

function BatchPicker({ variantId, storeId, value, onChange, invalid }: { variantId: string; storeId: string | null | undefined; value: string | null; onChange: (id: string) => void; invalid?: boolean }) {
  const batches = useBatchesQuery({ variant_id: variantId, store_id: storeId ?? undefined }, !!storeId)

  return (
    <Select value={value ?? undefined} onValueChange={onChange} disabled={!storeId}>
      <SelectTrigger className="w-full" aria-label="Batch" aria-invalid={invalid || undefined}>
        <SelectValue placeholder={storeId ? 'Choose batch' : 'Choose store first'} />
      </SelectTrigger>
      <SelectContent>
        {(batches.data ?? []).map((b) => (
          <SelectItem key={b.batch.id} value={b.batch.id}>
            {b.batch.batch_number} · {b.quantity}{b.batch.expires_on && ` · exp ${b.batch.expires_on}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

type CountLine = { variantId: string | undefined; storeId: string | null | undefined; batchId: string | null | undefined; trackBatches: boolean }

/** "In stock now" of a stock count line (read-only). */
function StockNowCell({ line }: { line: CountLine }) {
  const stock = useStockOnHandQuery(line.variantId, line.storeId, line.batchId, line.trackBatches)
  const hint = !line.storeId ? 'Choose store' : line.trackBatches && !line.batchId ? 'Choose batch' : null

  return (
    <td className="pr-2">
      <output className="block py-1.5 font-mono tabular-nums" aria-label="In stock now">
        {hint ? <span className="font-sans text-xs text-muted-foreground">{hint}</span> : stock.quantity === null ? (stock.isPending && line.variantId ? '…' : '—') : trimDecimal(stock.quantity)}
      </output>
    </td>
  )
}

/** Counted − in stock now: what the count will add (+) or remove (−). */
function DifferenceCell({ line, counted }: { line: CountLine; counted: string }) {
  const stock = useStockOnHandQuery(line.variantId, line.storeId, line.batchId, line.trackBatches)
  const valid = /^\d{1,15}(\.\d{1,3})?$/.test(counted)
  const diff = valid && stock.quantity !== null ? subtractDecimal(counted, stock.quantity) : null
  const sign = diff === null || isZeroDecimal(diff) ? 0 : diff.startsWith('-') ? -1 : 1

  return (
    <td className="pr-2">
      <output className="block py-1.5 font-mono tabular-nums" aria-label="Difference" aria-live="polite">
        {diff === null ? '—' : sign === 0 ? <span className="font-sans text-xs text-muted-foreground">No change</span> : (
          <span className={sign > 0 ? 'text-success-soft-foreground' : 'text-destructive-soft-foreground'}>{sign > 0 ? '+' : '−'}{trimDecimal(diff.replace('-', ''))}</span>
        )}
      </output>
    </td>
  )
}

/**
 * Editable product lines of a stock or purchase document. Shows only an estimate of line
 * amounts for orientation; the server computes the binding totals.
 */
export function LinesEditor<T extends LinesForm>({ control, register, setValue, errors, config }: Props<T>) {
  // The editor only touches the `lines` part of the parent form.
  const c = control as unknown as Control<LinesForm>
  const reg = register as unknown as UseFormRegister<LinesForm>
  const set = setValue as unknown as UseFormSetValue<LinesForm>
  const errs = errors as FieldErrors<LinesForm>
  const { fields, append, remove } = useFieldArray({ control: c, name: 'lines' })
  const lines = useWatch({ control: c, name: 'lines' })

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-3xl border-separate border-spacing-y-1 text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-[34%] font-medium">Product</th>
              {config.count && <th className="w-24 font-medium">In stock now</th>}
              <th className="w-28 font-medium">{config.count ? 'Counted quantity' : 'Quantity'}</th>
              {config.count && <th className="w-24 font-medium">Difference</th>}
              {config.discount && <th className="w-20 font-medium">Free qty</th>}
              {config.cost && <th className="w-32 font-medium">Unit cost{config.cost === 'optional' && ' (opt.)'}</th>}
              {config.discount && <th className="w-20 font-medium">Disc %</th>}
              {config.tax && <th className="w-24 font-medium">Tax %</th>}
              {config.batch && <th className="font-medium">Batch</th>}
              <th className="w-10"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field, i) => {
              const line = lines?.[i]
              const variant = line?.variant
              const negative = (line?.quantity ?? '').trim().startsWith('-')
              // A count names the batch on the shelf; signed lines decide by the sign.
              const batchMode = config.count ? 'out' : config.batch === 'signed' ? (negative ? 'out' : 'in') : config.batch
              const countLine: CountLine = { variantId: variant?.id, storeId: config.storeId, batchId: line?.batch_id, trackBatches: !!variant?.track_batches }
              const err = (f: string) => lineError(errs, i, f)
              // ST2c: entering in packs (carton of 24) fills quantity = packs × units and unit cost = pack cost ÷ units.
              const packs = config.cost && !config.count && !config.signed ? (variant?.packs ?? []) : []
              const pack = packs.find((p) => p.barcode === line?.pack)
              const packUnits = pack?.units ?? ''
              const fillFromPacks = (next: { units?: string; count?: string; cost?: string }) => {
                const units = next.units ?? packUnits
                if (!units) return
                const quantity = packQuantity(next.count ?? line?.pack_count ?? '', units)
                if (quantity !== null) set(`lines.${i}.quantity`, quantity, { shouldValidate: !!err('quantity') })
                const cost = config.cost ? packUnitCost(next.cost ?? line?.pack_cost ?? '', units) : null
                if (cost !== null) set(`lines.${i}.unit_cost`, cost, { shouldValidate: !!err('unit_cost') })
              }

              return (
                <tr key={field.id} className="align-top">
                  <td className="pr-2">
                    {config.fixedProducts ? (
                      <div className="py-1.5">
                        <div className="font-medium">{variant?.label}</div>
                        <div className="font-mono text-xs text-muted-foreground">{variant?.sku}</div>
                      </div>
                    ) : (
                      <Controller
                        control={c}
                        name={`lines.${i}.variant`}
                        render={({ field: f }) => (
                          <VariantPicker
                            value={f.value}
                            stockedOnly={config.stockedOnly}
                            invalid={!!err('variant') || !!err('variant_id')}
                            aria-label={`Product of line ${i + 1}`}
                            onChange={(option) => {
                              f.onChange(option)
                              set(`lines.${i}.pack`, '')
                              set(`lines.${i}.serials`, [])
                              // Pre-fill the last known cost; the user can overwrite it.
                              if (config.cost && !config.costPlaceholder && !line?.unit_cost && option.purchase_price) set(`lines.${i}.unit_cost`, option.purchase_price)
                            }}
                          />
                        )}
                      />
                    )}
                    {(err('variant') || err('variant_id')) && <p className="mt-1 text-xs text-destructive">{err('variant') ?? err('variant_id')}</p>}
                  </td>
                  {config.count && <StockNowCell line={countLine} />}
                  <td className="pr-2">
                    <Input
                      aria-label={`${config.count ? 'Counted quantity' : 'Quantity'} of line ${i + 1}`}
                      inputMode="decimal"
                      placeholder={config.signed && !config.count ? '+/−' : '0'}
                      aria-invalid={!!err('quantity') || undefined}
                      {...reg(`lines.${i}.quantity`)}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {variant?.unit_code}{line?.max_quantity && ` · max ${line.max_quantity}`}
                    </p>
                    {err('quantity') && <p className="text-xs text-destructive">{err('quantity')}</p>}
                    {config.serials && line && variant?.track_serials && (
                      <div className="mt-1">
                        <Controller
                          control={c}
                          name={`lines.${i}.serials`}
                          render={({ field: f }) => (
                            <SerialsDialog
                              label={variant.label}
                              buttonLabel={`Serials of line ${i + 1}`}
                              quantity={String(serialsNeeded(line, config) ?? '')}
                              serials={f.value ?? []}
                              onChange={f.onChange}
                              pickFrom={serialsMode(config, line.quantity) === 'out' ? { storeId: config.storeId, variantId: variant.id } : undefined}
                            />
                          )}
                        />
                        {err('serials') && <p className="text-xs text-destructive">{err('serials')}</p>}
                      </div>
                    )}
                    {packs.length > 0 && (
                      <div className="mt-1 flex flex-col gap-1">
                        <Select
                          value={pack?.barcode ?? UNITS}
                          onValueChange={(v) => {
                            set(`lines.${i}.pack`, v === UNITS ? '' : v)
                            fillFromPacks({ units: packs.find((p) => p.barcode === v)?.units ?? '' })
                          }}
                        >
                          <SelectTrigger size="sm" className="w-full" aria-label={`Pack of line ${i + 1}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNITS}>Units</SelectItem>
                            {packs.map((p) => <SelectItem key={p.barcode} value={p.barcode}>{p.pack_name ?? 'Pack'} ({trimDecimal(p.units)})</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {packUnits && (
                          <Input
                            aria-label={`Packs of line ${i + 1}`}
                            className="h-8"
                            inputMode="decimal"
                            placeholder="Packs"
                            {...reg(`lines.${i}.pack_count`, { onChange: (e: { target: { value: string } }) => fillFromPacks({ count: e.target.value }) })}
                          />
                        )}
                      </div>
                    )}
                  </td>
                  {config.count && <DifferenceCell line={countLine} counted={(line?.quantity ?? '').trim()} />}
                  {config.discount && (
                    <td className="pr-2">
                      <Input aria-label={`Free qty of line ${i + 1}`} inputMode="decimal" placeholder="0" aria-invalid={!!err('bonus_quantity') || undefined} {...reg(`lines.${i}.bonus_quantity`)} />
                      {err('bonus_quantity') && <p className="mt-1 text-xs text-destructive">{err('bonus_quantity')}</p>}
                    </td>
                  )}
                  {config.cost && (
                    <td className="pr-2">
                      <Input aria-label={`Unit cost of line ${i + 1}`} inputMode="decimal" placeholder={config.costPlaceholder ?? '0.00'} aria-invalid={!!err('unit_cost') || undefined} disabled={config.signed && !config.count && negative} {...reg(`lines.${i}.unit_cost`)} />
                      {err('unit_cost') && <p className="mt-1 text-xs text-destructive">{err('unit_cost')}</p>}
                      {packUnits && (
                        <Input
                          aria-label={`Pack cost of line ${i + 1}`}
                          className="mt-1 h-8"
                          inputMode="decimal"
                          placeholder="Per pack"
                          {...reg(`lines.${i}.pack_cost`, { onChange: (e: { target: { value: string } }) => fillFromPacks({ cost: e.target.value }) })}
                        />
                      )}
                    </td>
                  )}
                  {config.discount && (
                    <td className="pr-2">
                      <Input aria-label={`Discount % of line ${i + 1}`} inputMode="decimal" placeholder="0" aria-invalid={!!err('discount_percent') || undefined} {...reg(`lines.${i}.discount_percent`)} />
                      {err('discount_percent') && <p className="mt-1 text-xs text-destructive">{err('discount_percent')}</p>}
                    </td>
                  )}
                  {config.tax && (
                    <td className="pr-2">
                      <Input aria-label={`Tax rate of line ${i + 1}`} inputMode="decimal" placeholder={variant?.tax_rate ?? '0'} {...reg(`lines.${i}.tax_rate`)} />
                      {err('tax_rate') && <p className="mt-1 text-xs text-destructive">{err('tax_rate')}</p>}
                    </td>
                  )}
                  {config.batch && (
                    <td className="pr-2">
                      {!variant?.track_batches ? (
                        <span className="block py-1.5 text-xs text-muted-foreground">—</span>
                      ) : batchMode === 'out' ? (
                        <Controller
                          control={c}
                          name={`lines.${i}.batch_id`}
                          render={({ field: f }) => <BatchPicker variantId={variant.id} storeId={config.storeId} value={f.value} onChange={f.onChange} invalid={!!err('batch_id')} />}
                        />
                      ) : (
                        <div className="grid grid-cols-2 gap-1">
                          <Input aria-label={`Batch number of line ${i + 1}`} placeholder="Batch no." aria-invalid={!!err('batch_number') || undefined} {...reg(`lines.${i}.batch_number`)} />
                          <Input aria-label={`Expiry of line ${i + 1}`} type="date" {...reg(`lines.${i}.expires_on`)} />
                        </div>
                      )}
                      {(err('batch_number') || err('batch_id')) && <p className="mt-1 text-xs text-destructive">{err('batch_number') ?? err('batch_id')}</p>}
                    </td>
                  )}
                  <td>
                    {!config.fixedProducts || fields.length > 1 ? (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${i + 1}`} disabled={fields.length === 1} onClick={() => remove(i)}>
                        <Trash2Icon />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {typeof (errs.lines as { message?: string } | undefined)?.message === 'string' && (
        <p className="text-sm text-destructive">{(errs.lines as { message?: string }).message}</p>
      )}
      {!config.fixedProducts && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => append(emptyLine())}>
          <PlusIcon data-icon="inline-start" /> Add line
        </Button>
      )}
      {config.cost && config.currency && <p className="text-xs text-muted-foreground">Totals are calculated by the server when you save ({config.currency}).</p>}
    </div>
  )
}

