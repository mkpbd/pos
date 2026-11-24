import type { CSSProperties } from 'react'
import { BarcodeSvg } from '@/features/labels/barcode/barcode-svg'
import { detectBarcodeFormat, type BarcodeFormat } from '@/features/labels/barcode/barcode'
import { labelLayout, type LabelFields, type LabelLayout, type LabelTemplate } from '@/features/labels/templates'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'

/** What one printed label needs. */
export type PrintLabel = {
  key: string
  product_name: string
  variant_name: string | null
  sku: string
  barcode: string | null
  barcode_format: BarcodeFormat | null
  price: string
  currency: string
  batch_number?: string | null
  expires_on?: string | null
}

const mm = (n: number) => `${Math.round(n * 100) / 100}mm`

const oneLine: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

function Label({ label, template, fields, layout, shopName, outline }: { label: PrintLabel; template: LabelTemplate; fields: LabelFields; layout: LabelLayout; shopName: string; outline: boolean }) {
  // Without a barcode the SKU is printed as Code 128 (the till finds products by SKU too).
  const code = label.barcode ?? label.sku
  const format = label.barcode ? (label.barcode_format ?? detectBarcodeFormat(label.barcode)) : 'code128'
  // The SKU line is left out when the barcode already spells the SKU under the bars.
  const skuShown = !label.barcode && fields.digits
  const meta = [fields.sku && !skuShown ? label.sku : null, fields.batch && label.batch_number ? `Batch ${label.batch_number}` : null, fields.batch && label.expires_on ? `Exp ${label.expires_on}` : null]
    .filter(Boolean)
    .join(' · ')
  const shelf = template.group === 'shelf'

  return (
    <div
      className={cn('label flex flex-col items-center overflow-hidden bg-white text-center text-black', outline && 'outline outline-dashed outline-neutral-300')}
      style={{ width: mm(template.label.width), height: mm(template.label.height), padding: mm(template.padding), lineHeight: 1.15, boxSizing: 'border-box' }}
    >
      {layout.shop > 0 && <div className="w-full" style={{ ...oneLine, fontSize: mm(layout.shop) }}>{shopName}</div>}
      {layout.product > 0 && (
        <div
          className="w-full font-semibold"
          style={layout.productLines > 1
            ? { fontSize: mm(layout.product), display: '-webkit-box', WebkitLineClamp: layout.productLines, WebkitBoxOrient: 'vertical', overflow: 'hidden', maxHeight: mm(layout.product * layout.productLines * 1.15) }
            : { ...oneLine, fontSize: mm(layout.product) }}
        >
          {label.product_name}
        </div>
      )}
      {layout.variant > 0 && <div className="w-full" style={{ ...oneLine, fontSize: mm(layout.variant), minHeight: mm(layout.variant * 1.15) }}>{label.variant_name ?? ''}</div>}
      {layout.price > 0 && <div className={cn('w-full font-bold', shelf && 'tracking-tight')} style={{ ...oneLine, fontSize: mm(layout.price) }}>{formatMoney(label.price, label.currency)}</div>}
      <div className="mt-auto flex w-full justify-center">
        <BarcodeSvg value={code} format={format} widthMm={layout.barcodeWidth} heightMm={layout.barcodeHeight} showText={fields.digits} />
      </div>
      {layout.meta > 0 && <div className="w-full" style={{ ...oneLine, fontSize: mm(layout.meta) }}>{meta}</div>}
    </div>
  )
}

type SheetProps = {
  labels: PrintLabel[]
  template: LabelTemplate
  fields: LabelFields
  shopName: string
  /** Dashed label outlines (screen preview only). */
  outline?: boolean
  /** Accessible name of the page. */
  ariaLabel?: string
}

/** One page of labels at true size: the label grid placed from the page margins. */
export function LabelPage({ labels, template, fields, shopName, outline = false, ariaLabel }: SheetProps) {
  const layout = labelLayout(template, fields)
  return (
    <div
      className="label-page bg-white"
      role={ariaLabel ? 'group' : undefined}
      aria-label={ariaLabel}
      style={{
        width: mm(template.page.width),
        height: mm(template.page.height),
        paddingTop: mm(template.margin.top),
        paddingLeft: mm(template.margin.left),
        boxSizing: 'border-box',
        display: 'grid',
        gridTemplateColumns: `repeat(${template.columns}, ${mm(template.label.width)})`,
        gridAutoRows: mm(template.label.height),
        columnGap: mm(template.gap.x),
        rowGap: mm(template.gap.y),
        alignContent: 'start',
        overflow: 'hidden',
      }}
    >
      {labels.map((label, i) => (
        <Label key={`${label.key}-${i}`} label={label} template={template} fields={fields} layout={layout} shopName={shopName} outline={outline} />
      ))}
    </div>
  )
}
