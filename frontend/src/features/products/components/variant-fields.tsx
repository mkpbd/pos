import type { ReactNode } from 'react'
import { Controller, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import type { ProductFormValues } from '@/features/products/product-form'

type Props = {
  index: number
  register: UseFormRegister<ProductFormValues>
  control: Control<ProductFormValues>
  errors: FieldErrors<ProductFormValues>
}

function err(errors: FieldErrors<ProductFormValues>, index: number, field: string): string | undefined {
  const row = errors.variants?.[index] as Record<string, { message?: string } | Record<string, { message?: string }>> | undefined
  const value = row?.[field]
  if (!value) return undefined
  if ('message' in value && typeof value.message === 'string') return value.message
  // Nested barcode errors ("barcodes.0") from the server.
  return Object.values(value).find((v): v is { message?: string } => typeof v === 'object' && v !== null && 'message' in v)?.message
}

function Cell({ error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

/** Inputs of one variant row (used in the single-variant form and the variants table). */
export function VariantFields({ index, register, control, errors }: Props) {
  const p = `variants.${index}` as const

  return (
    <>
      <Cell label="SKU" error={err(errors, index, 'sku')}>
        <Input aria-label="SKU" placeholder="Auto" className="font-mono" {...register(`${p}.sku`)} />
      </Cell>
      <Cell label="Cost price" error={err(errors, index, 'purchase_price')}>
        <Input aria-label="Cost price" inputMode="decimal" placeholder="0.00" {...register(`${p}.purchase_price`)} />
      </Cell>
      <Cell label="Selling price" error={err(errors, index, 'selling_price')}>
        <Input aria-label="Selling price" inputMode="decimal" placeholder="0.00" {...register(`${p}.selling_price`)} />
      </Cell>
      <Cell label="Wholesale price" error={err(errors, index, 'wholesale_price')}>
        <Input aria-label="Wholesale price" inputMode="decimal" placeholder="Optional" {...register(`${p}.wholesale_price`)} />
      </Cell>
      <Cell label="Reorder level" error={err(errors, index, 'reorder_level')}>
        <Input aria-label="Reorder level" inputMode="decimal" placeholder="0" {...register(`${p}.reorder_level`)} />
      </Cell>
      <Cell label="Barcodes" error={err(errors, index, 'barcodes')}>
        <Input aria-label="Barcodes" placeholder="Scan or type, comma separated" className="font-mono" {...register(`${p}.barcodes`)} />
      </Cell>
      <Controller
        control={control}
        name={`${p}.is_active`}
        render={({ field }) => <Switch aria-label="Variant active" checked={field.value} onCheckedChange={field.onChange} className="self-center" />}
      />
    </>
  )
}
