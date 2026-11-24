import { barcodeGeometry, buildSymbol, type BarcodeFormat } from '@/features/labels/barcode/barcode'

type Props = {
  value: string
  format: BarcodeFormat
  /** Box the barcode must fit, in mm (true size on screen and paper). */
  widthMm: number
  heightMm: number
  /** Human-readable digits under the bars. */
  showText?: boolean
}

/**
 * A barcode drawn as SVG at a real size in millimetres. EAN / UPC codes that do not fit their
 * format (or have a wrong check digit) are drawn as Code 128 so they still scan as typed.
 */
export function BarcodeSvg({ value, format, widthMm, heightMm, showText = true }: Props) {
  const built = buildSymbol(value, format)
  if (!built || widthMm <= 0 || heightMm <= 0) {
    return <span className="text-[2mm] text-neutral-500">Cannot draw this barcode</span>
  }
  const g = barcodeGeometry(built.symbol, widthMm, heightMm, showText)

  return (
    <svg
      role="img"
      aria-label={`Barcode ${value}`}
      data-format={built.format}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${g.viewWidth} ${Math.round(g.viewHeight * 1000) / 1000}`}
      width={`${Math.round(g.widthMm * 100) / 100}mm`}
      height={`${heightMm}mm`}
      shapeRendering="crispEdges"
      className="block shrink-0"
    >
      <rect width={g.viewWidth} height={g.viewHeight} fill="#fff" />
      <path d={g.path} fill="#000" />
      {g.text.map((t, i) => (
        <text key={i} x={t.x} y={g.textY} fontSize={g.fontSize} textAnchor="middle" fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" fill="#000">
          {t.value}
        </text>
      ))}
    </svg>
  )
}
