import { Controller, useFieldArray, useWatch, type Control, type FieldErrors, type UseFormRegister, type UseFormSetValue } from 'react-hook-form'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { emptyLine, type LinesForm } from '@/components/common/line-values'
import { VariantPicker } from '@/components/common/variant-picker'
import { useBatchesQuery } from '@/features/inventory/api'

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
              <th className="w-28 font-medium">Quantity</th>
              {config.cost && <th className="w-32 font-medium">Unit cost{config.cost === 'optional' && ' (opt.)'}</th>}
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
              const batchMode = config.batch === 'signed' ? (negative ? 'out' : 'in') : config.batch
              const err = (f: string) => lineError(errs, i, f)

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
                              // Pre-fill the last known cost; the user can overwrite it.
                              if (config.cost && !line?.unit_cost && option.purchase_price) set(`lines.${i}.unit_cost`, option.purchase_price)
                            }}
                          />
                        )}
                      />
                    )}
                    {(err('variant') || err('variant_id')) && <p className="mt-1 text-xs text-destructive">{err('variant') ?? err('variant_id')}</p>}
                  </td>
                  <td className="pr-2">
                    <Input
                      aria-label={`Quantity of line ${i + 1}`}
                      inputMode="decimal"
                      placeholder={config.signed ? '+/−' : '0'}
                      aria-invalid={!!err('quantity') || undefined}
                      {...reg(`lines.${i}.quantity`)}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {variant?.unit_code}{line?.max_quantity && ` · max ${line.max_quantity}`}
                    </p>
                    {err('quantity') && <p className="text-xs text-destructive">{err('quantity')}</p>}
                  </td>
                  {config.cost && (
                    <td className="pr-2">
                      <Input aria-label={`Unit cost of line ${i + 1}`} inputMode="decimal" placeholder="0.00" aria-invalid={!!err('unit_cost') || undefined} disabled={config.signed && negative} {...reg(`lines.${i}.unit_cost`)} />
                      {err('unit_cost') && <p className="mt-1 text-xs text-destructive">{err('unit_cost')}</p>}
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

