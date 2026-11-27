import type { Product } from '@/features/products/api'

/** A sellable variant as needed by document line editors. */
export type VariantOption = {
  id: string
  label: string
  sku: string
  unit_code: string | null
  allow_decimal: boolean
  track_stock: boolean
  track_batches: boolean
  /** ST2d: one serial number per unit on stock and purchase documents. */
  track_serials?: boolean
  /** Only present for users who may see costs. */
  purchase_price?: string
  tax_rate: string | null
  /** ST2c: pack barcodes (carton, box) with their units, for the lines editor's "Pack" helper. */
  packs?: { barcode: string; units: string; pack_name: string | null }[]
}

export function toVariantOptions(products: Product[]): VariantOption[] {
  return products.flatMap((p) =>
    p.variants
      .filter((v) => v.is_active)
      .map((v) => ({
        id: v.id,
        label: v.name || Object.keys(v.option_values).length ? `${p.name} — ${v.name || Object.values(v.option_values).join(' / ')}` : p.name,
        sku: v.sku,
        unit_code: p.unit?.code ?? null,
        allow_decimal: p.unit?.allow_decimal ?? false,
        track_stock: p.type === 'standard' && p.track_stock,
        track_batches: p.track_batches,
        track_serials: p.track_serials,
        purchase_price: v.purchase_price,
        tax_rate: p.tax_rate?.rate ?? null,
        ...(v.packs?.length ? { packs: v.packs } : {}),
      })),
  )
}
