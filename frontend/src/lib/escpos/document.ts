import { needsRaster, normalizeText, type CodePage } from '@/lib/escpos/code-pages'
import { EscPosEncoder, wrapText, type Align, type DrawerPin } from '@/lib/escpos/encoder'
import { createDomCanvas, packRaster, type Canvas2DLike, type CreateCanvas, type PackedRaster } from '@/lib/escpos/raster'

/**
 * A printer-neutral receipt: the till builds one from a sale or slip, and it is printed either as
 * ESC/POS text (fast, crisp) or drawn on a canvas and sent as a picture (any script: Bangla, logos).
 */
export type PrintBlock =
  | { kind: 'text'; text: string; align?: Align; bold?: boolean; large?: boolean }
  | { kind: 'columns'; left: string; right: string; bold?: boolean }
  | { kind: 'rule' }
  | { kind: 'qr'; data: string }
  | { kind: 'feed'; lines: number }

/** Characters per line: 58 mm paper 32, 80 mm paper 48 (42 on printers with a narrower print area). */
export type PaperWidth = 32 | 42 | 48

/** Printable width in dots (203 dpi heads) for each paper width. */
export const PAPER_DOTS: Record<PaperWidth, number> = { 32: 384, 42: 512, 48: 576 }

export type RasterMode = 'auto' | 'always'

export type RenderOptions = {
  width: PaperWidth
  codePage: CodePage
  /** `auto`: text mode unless some text needs a picture; `always`: always a picture. */
  raster: RasterMode
  cut: boolean
  /** Copies of the receipt (each cut); the drawer kicks once, before the first. */
  copies?: number
  /** Kick the drawer on this pin before printing; null / undefined = no kick. */
  drawerPin?: DrawerPin | null
  createCanvas?: CreateCanvas
}

/** Lines fed after the last line when the paper is torn off by hand (no cutter). */
const TEAR_FEED = 4

/** Whether the document would be printed as a picture in `auto` mode. */
export function documentNeedsRaster(blocks: PrintBlock[], codePage: CodePage): boolean {
  return blocks.some((b) => {
    switch (b.kind) {
      case 'text':
        return needsRaster(b.text, codePage)
      case 'columns':
        return needsRaster(b.left, codePage) || needsRaster(b.right, codePage)
      default:
        return false
    }
  })
}

/** The full print job: initialise, optional drawer kick, the copies, each cut (or fed for tearing). */
export function renderDocument(blocks: PrintBlock[], options: RenderOptions): Uint8Array {
  const e = new EscPosEncoder(options.codePage).initialize().codePage(options.codePage)
  if (options.drawerPin) e.drawer(options.drawerPin)
  const copies = Math.max(1, Math.min(5, options.copies ?? 1))
  const raster = options.raster === 'always' || documentNeedsRaster(blocks, options.codePage)
  const pictures = raster ? rasterSegments(blocks, options.width, options.createCanvas ?? createDomCanvas) : null

  for (let copy = 0; copy < copies; copy++) {
    if (pictures) {
      for (const part of pictures) {
        if ('qr' in part) qrBlock(e, part.qr)
        else e.raster(part)
      }
    } else {
      for (const block of blocks) textBlock(e, block, options.width, options.codePage)
    }
    if (options.cut) e.cut()
    else e.feed(TEAR_FEED)
  }
  return e.encode()
}

/** Just the drawer kick (no paper moves): ESC @ then ESC p. */
export function drawerKick(pin: DrawerPin): Uint8Array {
  return new EscPosEncoder().initialize().drawer(pin).encode()
}

function textBlock(e: EscPosEncoder, block: PrintBlock, width: PaperWidth, page: CodePage): void {
  switch (block.kind) {
    case 'text': {
      const align = block.align ?? 'left'
      if (align !== 'left') e.align(align)
      if (block.bold) e.bold(true)
      if (block.large) e.size(2, 2)
      for (const l of wrapText(normalizeText(block.text, page), block.large ? Math.floor(width / 2) : width)) e.line(l)
      if (block.large) e.size(1, 1)
      if (block.bold) e.bold(false)
      if (align !== 'left') e.align('left')
      return
    }
    case 'columns':
      if (block.bold) e.bold(true)
      e.columns(normalizeText(block.left, page), normalizeText(block.right, page), width)
      if (block.bold) e.bold(false)
      return
    case 'rule':
      e.rule(width)
      return
    case 'qr':
      qrBlock(e, block.data)
      return
    case 'feed':
      e.feed(block.lines)
      return
  }
}

function qrBlock(e: EscPosEncoder, data: string): void {
  e.align('center').qr(data).newline().align('left')
}

/* ---------------------------------------------------------------- raster */

/** Drawing metrics in dots: a 20 px font is 12 dots per character, so 32 / 42 / 48 columns fit. */
const FONT_PX = 20
const LINE_DOTS = 30
const LARGE_PX = 40
const LARGE_LINE_DOTS = 54
const RULE_DOTS = 16
const FONT_FAMILY = '"Courier New", Courier, "Noto Sans Bengali", "Nirmala UI", Vrinda, monospace'
/** Anti-aliased edges darker than this print; a little above mid-grey keeps thin strokes. */
const THRESHOLD = 160

type DrawOp =
  | { op: 'text'; text: string; x: number; y: number; align: CanvasTextAlign; font: string }
  | { op: 'rect'; x: number; y: number; w: number; h: number }

const font = (bold: boolean | undefined, large: boolean | undefined) => `${bold ? 'bold ' : ''}${large ? LARGE_PX : FONT_PX}px ${FONT_FAMILY}`

/** Splits blocks at QR codes (the printer draws those itself) and draws each run of other blocks. */
function rasterSegments(blocks: PrintBlock[], width: PaperWidth, createCanvas: CreateCanvas): (PackedRaster | { qr: string })[] {
  const out: (PackedRaster | { qr: string })[] = []
  let run: PrintBlock[] = []
  const flush = () => {
    if (run.length > 0) out.push(drawBlocks(run, PAPER_DOTS[width], createCanvas))
    run = []
  }
  for (const block of blocks) {
    if (block.kind === 'qr') {
      flush()
      out.push({ qr: block.data })
    } else {
      run.push(block)
    }
  }
  flush()
  return out
}

function context(canvas: { getContext(type: '2d'): Canvas2DLike | null }): Canvas2DLike {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot draw the receipt for the printer.')
  return ctx
}

/** Lays the blocks out on a canvas `dots` wide, then packs it to printer dots. */
export function drawBlocks(blocks: PrintBlock[], dots: number, createCanvas: CreateCanvas = createDomCanvas): PackedRaster {
  const measure = context(createCanvas(dots, 1))
  const width = (text: string, f: string) => {
    measure.font = f
    return measure.measureText(text).width
  }
  const ops: DrawOp[] = []
  let y = 0

  for (const block of blocks) {
    switch (block.kind) {
      case 'text': {
        const f = font(block.bold, block.large)
        const step = block.large ? LARGE_LINE_DOTS : LINE_DOTS
        const align = block.align ?? 'left'
        const x = align === 'center' ? dots / 2 : align === 'right' ? dots : 0
        for (const l of wrapMeasured(block.text, dots, (t) => width(t, f))) {
          ops.push({ op: 'text', text: l, x, y, align, font: f })
          y += step
        }
        break
      }
      case 'columns': {
        const f = font(block.bold, false)
        const rightWidth = width(block.right, f)
        const gap = width(' ', f)
        const lines = block.left.trim() === '' ? [''] : wrapMeasured(block.left, Math.max(dots / 3, dots - rightWidth - gap), (t) => width(t, f))
        const lastFits = width(lines[lines.length - 1] ?? '', f) + gap + rightWidth <= dots
        lines.forEach((l, i) => {
          if (l) ops.push({ op: 'text', text: l, x: 0, y, align: 'left', font: f })
          if (i === lines.length - 1 && lastFits) ops.push({ op: 'text', text: block.right, x: dots, y, align: 'right', font: f })
          y += LINE_DOTS
        })
        if (!lastFits) {
          ops.push({ op: 'text', text: block.right, x: dots, y, align: 'right', font: f })
          y += LINE_DOTS
        }
        break
      }
      case 'rule':
        for (let x = 0; x < dots; x += 12) ops.push({ op: 'rect', x, y: y + RULE_DOTS / 2 - 1, w: 8, h: 2 })
        y += RULE_DOTS
        break
      case 'feed':
        y += block.lines * LINE_DOTS
        break
      case 'qr':
        break
    }
  }

  const height = Math.max(1, Math.ceil(y))
  const ctx = context(createCanvas(dots, height))
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, dots, height)
  ctx.fillStyle = '#000'
  ctx.textBaseline = 'top'
  for (const op of ops) {
    if (op.op === 'rect') {
      ctx.fillRect(op.x, op.y, op.w, op.h)
    } else {
      ctx.font = op.font
      ctx.textAlign = op.align
      // A few dots down so tall scripts (Bangla vowel signs) are not clipped at the top.
      ctx.fillText(op.text, op.x, op.y + 3)
    }
  }
  return packRaster(ctx.getImageData(0, 0, dots, height), THRESHOLD)
}

/** Word wrap by measured width (any script); a word wider than the line is split by characters. */
export function wrapMeasured(text: string, max: number, measure: (text: string) => number): string[] {
  const out: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    let current = ''
    for (const word of paragraph.split(' ')) {
      const candidate = current === '' ? word : `${current} ${word}`
      if (measure(candidate) <= max) {
        current = candidate
        continue
      }
      if (current !== '') out.push(current)
      current = ''
      let piece = ''
      for (const ch of Array.from(word)) {
        if (piece !== '' && measure(piece + ch) > max) {
          out.push(piece)
          piece = ''
        }
        piece += ch
      }
      current = piece
    }
    out.push(current)
  }
  return out
}
