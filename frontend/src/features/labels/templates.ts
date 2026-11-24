/**
 * Label stock: page and label sizes in millimetres, as printed on the packet. Sheet templates
 * match common A4 label sheets; roll templates print one label per page for thermal printers.
 */
export type LabelTemplateId = 'a4-3x8' | 'a4-4x10' | 'a4-5x13' | 'shelf-3x7' | 'roll-38x25' | 'roll-50x25' | 'roll-50x30'

export type LabelTemplate = {
  id: LabelTemplateId
  name: string
  group: 'sheet' | 'roll' | 'shelf'
  page: { width: number; height: number }
  /** Top and left page margin (the label grid is placed from here). */
  margin: { top: number; left: number }
  label: { width: number; height: number }
  /** Space between columns and between rows. */
  gap: { x: number; y: number }
  columns: number
  rows: number
  /** Inner padding of a label. */
  padding: number
}

const A4 = { width: 210, height: 297 }
const roll = (id: LabelTemplateId, width: number, height: number): LabelTemplate => ({
  id,
  name: `Thermal roll ${width} × ${height} mm`,
  group: 'roll',
  page: { width, height },
  margin: { top: 0, left: 0 },
  label: { width, height },
  gap: { x: 0, y: 0 },
  columns: 1,
  rows: 1,
  padding: 1.2,
})

export const LABEL_TEMPLATES: LabelTemplate[] = [
  { id: 'a4-3x8', name: 'A4 sheet, 24 labels (70 × 37 mm)', group: 'sheet', page: A4, margin: { top: 0.5, left: 0 }, label: { width: 70, height: 37 }, gap: { x: 0, y: 0 }, columns: 3, rows: 8, padding: 2.5 },
  { id: 'a4-4x10', name: 'A4 sheet, 40 labels (48.5 × 25.4 mm)', group: 'sheet', page: A4, margin: { top: 21.5, left: 8 }, label: { width: 48.5, height: 25.4 }, gap: { x: 0, y: 0 }, columns: 4, rows: 10, padding: 1.5 },
  { id: 'a4-5x13', name: 'A4 sheet, 65 labels (38.1 × 21.2 mm)', group: 'sheet', page: A4, margin: { top: 10.7, left: 4.75 }, label: { width: 38.1, height: 21.2 }, gap: { x: 2.5, y: 0 }, columns: 5, rows: 13, padding: 1.2 },
  roll('roll-38x25', 38, 25),
  roll('roll-50x25', 50, 25),
  roll('roll-50x30', 50, 30),
  { id: 'shelf-3x7', name: 'Shelf labels, A4 sheet of 21 (63.5 × 38.1 mm)', group: 'shelf', page: A4, margin: { top: 15.15, left: 7.25 }, label: { width: 63.5, height: 38.1 }, gap: { x: 2.5, y: 0 }, columns: 3, rows: 7, padding: 2.5 },
]

export const TEMPLATE_GROUPS: { group: LabelTemplate['group']; label: string }[] = [
  { group: 'sheet', label: 'A4 label sheets' },
  { group: 'roll', label: 'Thermal label printer' },
  { group: 'shelf', label: 'Shelf labels' },
]

export const DEFAULT_TEMPLATE_ID: LabelTemplateId = 'a4-3x8'

export function templateById(id: string | null | undefined): LabelTemplate {
  return LABEL_TEMPLATES.find((t) => t.id === id) ?? LABEL_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID)!
}

export const perPage = (t: LabelTemplate) => t.columns * t.rows

/** What a label shows. */
export type LabelFields = { shop: boolean; product: boolean; variant: boolean; price: boolean; sku: boolean; digits: boolean; batch: boolean }

export const DEFAULT_FIELDS: LabelFields = { shop: false, product: true, variant: true, price: true, sku: false, digits: true, batch: false }

export const FIELD_LABELS: Record<keyof LabelFields, string> = {
  shop: 'Shop name',
  product: 'Product name',
  variant: 'Variant',
  price: 'Price',
  sku: 'SKU',
  digits: 'Barcode digits',
  batch: 'Batch and expiry',
}

/** The most labels one print job may hold (the labels endpoint returns at most this many too). */
export const MAX_LABELS = 2000

export type LabelLayout = {
  /** Font sizes in mm (0 = hidden). */
  shop: number
  product: number
  /** Lines the product name may wrap to. */
  productLines: number
  variant: number
  price: number
  meta: number
  /** Box left for the barcode, in mm. */
  barcodeWidth: number
  barcodeHeight: number
}

const LINE = 1.15

/**
 * Font sizes and the barcode box for a template and the chosen fields. The text lines take
 * what they need from the top; the barcode gets the rest of the label (but never less than
 * 4 mm — very small labels with every field on simply crop the last text line).
 */
export function labelLayout(t: LabelTemplate, fields: LabelFields): LabelLayout {
  const innerW = t.label.width - 2 * t.padding
  const innerH = t.label.height - 2 * t.padding
  const shelf = t.group === 'shelf'
  const base = shelf ? 3.6 : t.label.height >= 35 ? 3 : t.label.height >= 28 ? 2.7 : t.label.height >= 24 ? 2.4 : 2.1
  const layout: LabelLayout = {
    shop: fields.shop ? base * 0.8 : 0,
    product: fields.product ? base : 0,
    productLines: fields.product ? (shelf || t.label.height >= 30 ? 2 : 1) : 0,
    variant: fields.variant ? base * 0.9 : 0,
    price: fields.price ? (shelf ? 9 : base * 1.25) : 0,
    meta: fields.sku || fields.batch ? base * 0.8 : 0,
    barcodeWidth: innerW,
    barcodeHeight: 0,
  }
  const textHeight = () => (layout.shop + layout.product * layout.productLines + layout.variant + layout.price + layout.meta) * LINE
  let room = innerH - textHeight() - 1
  // Shelf labels lead with the price; their barcode stays modest, but the price gives way
  // (down to 5 mm) so the barcode keeps about 8 mm when every field is on.
  if (shelf && layout.price > 0 && room < 8) {
    layout.price = Math.max(5, layout.price - (8 - room) / LINE)
    room = innerH - textHeight() - 1
  }
  layout.barcodeHeight = Math.max(4, shelf ? Math.min(room, 10) : room)
  if (shelf) layout.barcodeWidth = Math.min(innerW, 40)
  return layout
}

/** One printed label per unit of quantity, capped at MAX_LABELS. */
export function expandLabels<T extends { quantity: number }>(items: T[], max = MAX_LABELS): T[] {
  const out: T[] = []
  for (const item of items) {
    for (let i = 0; i < item.quantity && out.length < max; i++) out.push(item)
    if (out.length >= max) break
  }
  return out
}

export function totalLabels(items: { quantity: number }[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, item.quantity), 0)
}

/** Labels split into pages of the template's size. */
export function paginate<T>(labels: T[], t: LabelTemplate): T[][] {
  const size = perPage(t)
  const pages: T[][] = []
  for (let i = 0; i < labels.length; i += size) pages.push(labels.slice(i, i + size))
  return pages
}

/** `@page` rule for the template (the print stylesheet sets margins to 0 and places labels itself). */
export function pageRule(t: LabelTemplate): string {
  return `@page { size: ${t.page.width}mm ${t.page.height}mm; margin: 0; }`
}
