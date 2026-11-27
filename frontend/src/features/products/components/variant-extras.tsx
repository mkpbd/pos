import { Controller, useFieldArray, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { VariantGridValues } from '@/features/products/variant-grid'

type Props = {
  index: number
  /** The variant's label, e.g. "Red / M". */
  label: string
  control: Control<VariantGridValues>
  register: UseFormRegister<VariantGridValues>
  errors: FieldErrors<VariantGridValues>
  branches: { id: string; name: string }[]
}

type RowErrors = Record<string, Record<string, { message?: string } | undefined>[] | undefined>

function FieldError({ message }: { message: string | undefined }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null
}

/**
 * ST2c: one variant's pack barcodes (a carton scans as its units), quantity breaks (a lower unit
 * price from a quantity on) and branch prices, part of the variant grid's form.
 */
export function VariantExtras({ index, label, control, register, errors, branches }: Props) {
  const packs = useFieldArray({ control, name: `variants.${index}.packs` })
  const tiers = useFieldArray({ control, name: `variants.${index}.price_tiers` })
  const prices = useFieldArray({ control, name: `variants.${index}.branch_prices` })
  const row = (errors.variants?.[index] ?? {}) as unknown as RowErrors
  const err = (list: string, j: number, field: string) => row[list]?.[j]?.[field]?.message

  return (
    <div className="grid gap-4 p-2 md:grid-cols-3" role="group" aria-label={`Packs and prices of ${label}`}>
      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold">Pack barcodes</h4>
        <p className="text-xs text-muted-foreground">Scanning a pack sells or buys all its units, e.g. a carton of 24.</p>
        {packs.fields.map((f, j) => (
          <div key={f.id} className="grid grid-cols-[minmax(0,1.4fr)_4rem_minmax(0,1fr)_auto] items-start gap-1">
            <div>
              <Input aria-label={`Pack barcode ${j + 1}`} placeholder="Barcode" className="h-8 font-mono text-xs" aria-invalid={err('packs', j, 'barcode') ? true : undefined} {...register(`variants.${index}.packs.${j}.barcode`)} />
              <FieldError message={err('packs', j, 'barcode')} />
            </div>
            <div>
              <Input aria-label={`Units in pack ${j + 1}`} placeholder="Units" inputMode="decimal" className="h-8 text-right" aria-invalid={err('packs', j, 'units') ? true : undefined} {...register(`variants.${index}.packs.${j}.units`)} />
              <FieldError message={err('packs', j, 'units')} />
            </div>
            <div>
              <Input aria-label={`Name of pack ${j + 1}`} placeholder="e.g. Carton" className="h-8" aria-invalid={err('packs', j, 'pack_name') ? true : undefined} {...register(`variants.${index}.packs.${j}.pack_name`)} />
              <FieldError message={err('packs', j, 'pack_name')} />
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove pack ${j + 1}`} onClick={() => packs.remove(j)}><Trash2Icon /></Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="xs" className="self-start" disabled={packs.fields.length >= 10} onClick={() => packs.append({ barcode: '', units: '', pack_name: '' })}>
          <PlusIcon data-icon="inline-start" /> Add pack
        </Button>
      </section>

      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold">Quantity breaks</h4>
        <p className="text-xs text-muted-foreground">From this many units on, each unit costs this price.</p>
        {tiers.fields.map((f, j) => (
          <div key={f.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-1">
            <div>
              <Input aria-label={`Tier quantity ${j + 1}`} placeholder="From qty" inputMode="decimal" className="h-8 text-right" aria-invalid={err('price_tiers', j, 'min_quantity') ? true : undefined} {...register(`variants.${index}.price_tiers.${j}.min_quantity`)} />
              <FieldError message={err('price_tiers', j, 'min_quantity')} />
            </div>
            <div>
              <Input aria-label={`Tier price ${j + 1}`} placeholder="Unit price" inputMode="decimal" className="h-8 text-right" aria-invalid={err('price_tiers', j, 'price') ? true : undefined} {...register(`variants.${index}.price_tiers.${j}.price`)} />
              <FieldError message={err('price_tiers', j, 'price')} />
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove tier ${j + 1}`} onClick={() => tiers.remove(j)}><Trash2Icon /></Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="xs" className="self-start" disabled={tiers.fields.length >= 20} onClick={() => tiers.append({ min_quantity: '', price: '' })}>
          <PlusIcon data-icon="inline-start" /> Add quantity break
        </Button>
      </section>

      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold">Branch prices</h4>
        <p className="text-xs text-muted-foreground">Replaces the selling price at that branch’s tills.</p>
        {prices.fields.map((f, j) => (
          <div key={f.id} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-start gap-1">
            <div>
              <Controller control={control} name={`variants.${index}.branch_prices.${j}.branch_id`} render={({ field }) => (
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <SelectTrigger size="sm" className="w-full" aria-label={`Branch of price ${j + 1}`} aria-invalid={err('branch_prices', j, 'branch_id') ? true : undefined}>
                    <SelectValue placeholder="Branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    {field.value && !branches.some((b) => b.id === field.value) && <SelectItem value={field.value}>Inactive branch</SelectItem>}
                  </SelectContent>
                </Select>
              )} />
              <FieldError message={err('branch_prices', j, 'branch_id')} />
            </div>
            <div>
              <Input aria-label={`Branch price ${j + 1}`} placeholder="Price" inputMode="decimal" className="h-8 text-right" aria-invalid={err('branch_prices', j, 'price') ? true : undefined} {...register(`variants.${index}.branch_prices.${j}.price`)} />
              <FieldError message={err('branch_prices', j, 'price')} />
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove branch ${j + 1}`} onClick={() => prices.remove(j)}><Trash2Icon /></Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="xs" className="self-start" disabled={branches.length === 0} onClick={() => prices.append({ branch_id: '', price: '' })}>
          <PlusIcon data-icon="inline-start" /> Add branch price
        </Button>
      </section>
    </div>
  )
}
