import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField } from '@/components/common/form-field'
import { VariantPicker } from '@/components/common/variant-picker'
import type { VariantOption } from '@/components/common/variant-options'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SupplierSelect } from '@/features/purchasing/components/supplier-select'
import { useSaveSupplierProductMutation, variantDisplayName, variantUnit, type CatalogVariant, type SupplierProduct } from '@/features/supply-chain/api'
import { isPositiveQuantity, normalizeQuantity, QUANTITY_PATTERN } from '@/features/supply-chain/quantities'
import { handleFormError } from '@/lib/forms'
import { compareDecimal, decimalPattern, formatMoney, trimDecimal } from '@/lib/money'

const COST = decimalPattern(4)

const schema = z
  .object({
    supplier_id: z.string().min(1, 'Choose a supplier.'),
    variant: z.custom<VariantOption | null>().refine((v: VariantOption | null): boolean => v !== null, 'Choose a product.'),
    supplier_sku: z.string().trim().max(64, 'At most 64 characters.'),
    unit_cost: z.string().trim().regex(COST, 'Cost with up to 4 decimals.'),
    pack_size: z.string().trim().regex(QUANTITY_PATTERN, 'A quantity with up to 3 decimals.'),
    min_order_qty: z.string().trim().refine((v) => v === '' || isPositiveQuantity(v), 'Empty, or a positive quantity.'),
    lead_time_days: z.string().trim().regex(/^\d{1,3}$/, 'Whole days, 0–365.').refine((v) => Number(v) <= 365, 'Whole days, 0–365.'),
    is_preferred: z.boolean(),
    is_active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    // Pack size ≥ 1 (the API's rule).
    if (QUANTITY_PATTERN.test(v.pack_size.trim()) && compareDecimal(v.pack_size.trim(), '1') < 0) ctx.addIssue({ code: 'custom', path: ['pack_size'], message: 'At least 1.' })
  })
type Values = z.infer<typeof schema>

const FIELDS = ['supplier_id', 'supplier_sku', 'unit_cost', 'pack_size', 'min_order_qty', 'lead_time_days', 'is_preferred', 'is_active'] as const

function toVariantOption(v: CatalogVariant): VariantOption {
  return {
    id: v.id,
    label: variantDisplayName(v),
    sku: v.sku,
    unit_code: variantUnit(v) || null,
    allow_decimal: v.allow_decimal ?? true,
    track_stock: true,
    track_batches: false,
    tax_rate: null,
  }
}

function toValues(row: SupplierProduct | null, supplierId?: string, variant?: CatalogVariant): Values {
  const v = row?.variant ?? variant ?? null
  return {
    supplier_id: row?.supplier?.id ?? supplierId ?? '',
    variant: v ? toVariantOption(v) : null,
    supplier_sku: row?.supplier_sku ?? '',
    unit_cost: row ? trimDecimal(row.unit_cost) : '',
    pack_size: row ? normalizeQuantity(row.pack_size) : '1',
    min_order_qty: row?.min_order_qty ? normalizeQuantity(row.min_order_qty) : '',
    lead_time_days: String(row?.lead_time_days ?? 7),
    is_preferred: row?.is_preferred ?? false,
    is_active: row?.is_active ?? true,
  }
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Row being edited, or null to add one. */
  row: SupplierProduct | null
  /** Fixed supplier (supplier page) — hides the supplier select. */
  supplierId?: string
  supplierName?: string
  /** Fixed variant (product page) — hides the product picker. */
  variant?: CatalogVariant
}

/** Add or edit one supplier catalog row: what a supplier sells a variant for, in which packs. */
export function SupplierProductDialog({ open, onOpenChange, row, supplierId, supplierName, variant }: Props) {
  const save = useSaveSupplierProductMutation()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(row, supplierId, variant) })
  const { errors } = form.formState

  useEffect(() => {
    if (open) form.reset(toValues(row, supplierId, variant))
  }, [open, row, supplierId, variant, form])

  const onSubmit = form.handleSubmit((v) =>
    save.mutate(
      {
        id: row?.id,
        input: {
          ...(row ? {} : { supplier_id: v.supplier_id, variant_id: v.variant?.id ?? '' }),
          supplier_sku: v.supplier_sku.trim() || null,
          unit_cost: v.unit_cost.trim(),
          pack_size: v.pack_size.trim(),
          min_order_qty: v.min_order_qty.trim() || null,
          lead_time_days: Number(v.lead_time_days),
          is_preferred: v.is_preferred,
          is_active: v.is_active,
        },
      },
      {
        onSuccess: (saved) => {
          toast.success(`${variantDisplayName(saved.variant ?? row?.variant ?? variant)} saved to the catalog of ${saved.supplier?.name ?? supplierName ?? 'the supplier'}.`)
          onOpenChange(false)
        },
        onError: (error) => {
          // variant_id errors (e.g. already in this supplier's catalog) belong to the product picker.
          const details = (error as { fieldErrors?: Record<string, string[]> }).fieldErrors ?? {}
          const variantError = details.variant_id?.[0]
          if (variantError) form.setError('variant', { type: 'server', message: variantError })
          handleFormError(error, form.setError, FIELDS)
        },
      },
    ),
  )

  const editing = !!row
  const title = editing ? `Edit ${variantDisplayName(row.variant)}` : supplierName ? `Add product to ${supplierName}` : 'Add supplier'
  const fixedVariant = row?.variant ?? variant

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Cost is per base unit; reorder quantities round up to whole packs.</DialogDescription>
        </DialogHeader>
        <form id="supplier-product-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          {!supplierId && !editing && (
            <FormField label="Supplier" error={errors.supplier_id?.message} className="sm:col-span-2">
              <Controller control={form.control} name="supplier_id" render={({ field }) => <SupplierSelect value={field.value || null} onChange={field.onChange} invalid={!!errors.supplier_id} />} />
            </FormField>
          )}
          {editing || variant ? (
            <div className="text-sm sm:col-span-2">
              <span className="text-muted-foreground">Product</span>
              <div className="font-medium">{variantDisplayName(fixedVariant)}</div>
              <div className="font-mono text-xs text-muted-foreground">{fixedVariant?.sku}{editing && row.supplier && ` · ${row.supplier.name}`}</div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label id="catalog-product-label">Product</Label>
              <Controller
                control={form.control}
                name="variant"
                render={({ field }) => <VariantPicker value={field.value} onChange={field.onChange} invalid={!!errors.variant} aria-label="Product" />}
              />
              {errors.variant?.message && <p className="text-sm text-destructive">{errors.variant.message}</p>}
            </div>
          )}
          <FormField label="Unit cost" error={errors.unit_cost?.message}><Input inputMode="decimal" placeholder="0.00" {...form.register('unit_cost')} /></FormField>
          <FormField label="Supplier SKU" error={errors.supplier_sku?.message}><Input className="font-mono" placeholder="Optional" {...form.register('supplier_sku')} /></FormField>
          <FormField label="Pack size" error={errors.pack_size?.message} hint="Units per pack, e.g. 24 for a carton.">
            <Input inputMode="decimal" {...form.register('pack_size')} />
          </FormField>
          <FormField label="Minimum order" error={errors.min_order_qty?.message} hint="Units; empty for none.">
            <Input inputMode="decimal" placeholder="None" {...form.register('min_order_qty')} />
          </FormField>
          <FormField label="Lead time (days)" error={errors.lead_time_days?.message}><Input inputMode="numeric" {...form.register('lead_time_days')} /></FormField>
          {editing && (
            <div className="text-sm">
              <span className="text-muted-foreground">Last purchase cost</span>
              <div className="font-mono">{row.last_purchase_cost ? formatMoney(row.last_purchase_cost, undefined, 2) : '—'}</div>
              {row.last_purchased_at && <div className="text-xs text-muted-foreground">on {row.last_purchased_at.slice(0, 10)}</div>}
            </div>
          )}
          <Controller control={form.control} name="is_preferred" render={({ field }) => (
            <div className="flex items-center gap-2">
              <Switch id="catalog-preferred" checked={field.value} onCheckedChange={field.onChange} />
              <Label htmlFor="catalog-preferred">Preferred supplier for this product</Label>
            </div>
          )} />
          <Controller control={form.control} name="is_active" render={({ field }) => (
            <div className="flex items-center gap-2">
              <Switch id="catalog-active" checked={field.value} onCheckedChange={field.onChange} />
              <Label htmlFor="catalog-active">Active</Label>
            </div>
          )} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="supplier-product-form" disabled={save.isPending}>
            {save.isPending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            {editing ? 'Save changes' : 'Add to catalog'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
