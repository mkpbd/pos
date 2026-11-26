import { CODE_PAGE_NUMBER, encodeText, type CodePage } from '@/lib/escpos/code-pages'
import type { PackedRaster } from '@/lib/escpos/raster'

export type Align = 'left' | 'center' | 'right'

/** Which drawer connector pin the kick pulses: pin 2 (most drawers) or pin 5 (a second drawer). */
export type DrawerPin = 2 | 5

export type QrOptions = {
  /** Module size in dots (1–16). */
  size?: number
  /** Error correction: L 7 %, M 15 %, Q 25 %, H 30 %. */
  errorCorrection?: 'L' | 'M' | 'Q' | 'H'
}

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

const ALIGN: Record<Align, number> = { left: 0, center: 1, right: 2 }
const QR_ECC = { L: 48, M: 49, Q: 50, H: 51 } as const

/** Rows per `GS v 0` command: printers with small buffers choke on one huge image. */
export const RASTER_BAND_ROWS = 256

/**
 * A minimal ESC/POS command builder (Epson-compatible thermal printers). Each method appends the
 * command's bytes; `encode()` returns them. Written here, not taken from a package (POS1d).
 */
export class EscPosEncoder {
  private bytes: number[] = []
  private page: CodePage

  constructor(codePage: CodePage = 'cp1252') {
    this.page = codePage
  }

  /** ESC @ — resets the printer to its defaults (clears bold, size, alignment). */
  initialize(): this {
    return this.raw([ESC, 0x40])
  }

  /** ESC t n — selects the character code table text is encoded in. */
  codePage(page: CodePage): this {
    this.page = page
    return this.raw([ESC, 0x74, CODE_PAGE_NUMBER[page]])
  }

  /** Text in the current code page (no line feed). */
  text(value: string): this {
    return this.raw(encodeText(value, this.page))
  }

  /** Text followed by a line feed. */
  line(value = ''): this {
    return this.text(value).newline()
  }

  /** LF, `count` times. */
  newline(count = 1): this {
    for (let i = 0; i < count; i++) this.bytes.push(LF)
    return this
  }

  /** ESC d n — prints the buffer and feeds `lines` lines. */
  feed(lines: number): this {
    return this.raw([ESC, 0x64, clamp(lines, 0, 255)])
  }

  /** ESC E n — emphasized (bold) on / off. */
  bold(on: boolean): this {
    return this.raw([ESC, 0x45, on ? 1 : 0])
  }

  /** GS ! n — character width and height multipliers (1–8 each); 1 × 1 is normal. */
  size(width: number, height: number): this {
    return this.raw([GS, 0x21, ((clamp(width, 1, 8) - 1) << 4) | (clamp(height, 1, 8) - 1)])
  }

  /** ESC a n — justification of the following lines. */
  align(value: Align): this {
    return this.raw([ESC, 0x61, ALIGN[value]])
  }

  /** A full-width line of `char` (default "-"). */
  rule(width: number, char = '-'): this {
    return this.line(char.repeat(width))
  }

  /** Left text and right text on one line of `width` characters (see `columnLines`). */
  columns(left: string, right: string, width: number): this {
    for (const l of columnLines(left, right, width)) this.line(l)
    return this
  }

  /** A QR code of `data` with the printer's own generator (GS ( k: model 2, size, ECC, store, print). */
  qr(data: string, options: QrOptions = {}): this {
    const payload = Array.from(new TextEncoder().encode(data))
    const length = payload.length + 3
    return this
      .raw([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00])
      .raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, clamp(options.size ?? 6, 1, 16)])
      .raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, QR_ECC[options.errorCorrection ?? 'M']])
      .raw([GS, 0x28, 0x6b, length & 0xff, (length >> 8) & 0xff, 0x31, 0x50, 0x30, ...payload])
      .raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30])
  }

  /** GS V 66 0 — feeds to the cutter and cuts (partial cut where the printer has one). */
  cut(): this {
    return this.raw([GS, 0x56, 0x42, 0x00])
  }

  /** ESC p m 25 250 — pulses the drawer kick connector (m 0 = pin 2, 1 = pin 5; 50 ms on, 500 ms off). */
  drawer(pin: DrawerPin = 2): this {
    return this.raw([ESC, 0x70, pin === 5 ? 1 : 0, 25, 250])
  }

  /**
   * GS v 0 — a 1-bit picture (see `packRaster`), in bands of at most `RASTER_BAND_ROWS` rows.
   * Each band: GS v 0 m xL xH yL yH, then the rows (bytes left to right, top bit leftmost).
   */
  raster(image: PackedRaster): this {
    for (let top = 0; top < image.height; top += RASTER_BAND_ROWS) {
      const rows = Math.min(RASTER_BAND_ROWS, image.height - top)
      this.raw([GS, 0x76, 0x30, 0x00, image.widthBytes & 0xff, image.widthBytes >> 8, rows & 0xff, rows >> 8])
      const start = top * image.widthBytes
      for (let i = start; i < start + rows * image.widthBytes; i++) this.bytes.push(image.data[i] ?? 0)
    }
    return this
  }

  /** Appends bytes as they are. */
  raw(bytes: ArrayLike<number>): this {
    for (let i = 0; i < bytes.length; i++) this.bytes.push((bytes[i] ?? 0) & 0xff)
    return this
  }

  encode(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

/**
 * Breaks `text` into lines of at most `width` characters, at spaces where possible
 * (a word longer than the line is split). Existing line breaks are kept.
 */
export function wrapText(text: string, width: number): string[] {
  const max = Math.max(1, width)
  const out: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    // Leading spaces (an indented "  discount" row) are kept on the first line.
    const indent = /^ */.exec(paragraph)?.[0] ?? ''
    let current = indent.length < max ? indent : ''
    let fresh = true
    for (const word of paragraph.slice(indent.length).split(' ')) {
      if (word === '') continue
      let chars = Array.from(word)
      while (chars.length > 0) {
        const used = Array.from(current).length
        const gap = fresh ? 0 : 1
        if (used + gap + chars.length <= max) {
          current += (fresh ? '' : ' ') + chars.join('')
          fresh = false
          chars = []
        } else if (fresh) {
          // A word longer than the line: split it.
          const room = Math.max(1, max - used)
          out.push(current + chars.slice(0, room).join(''))
          chars = chars.slice(room)
          current = ''
        } else {
          out.push(current)
          current = ''
          fresh = true
        }
      }
    }
    out.push(fresh && current.trim() === '' ? '' : current)
  }
  return out
}

/**
 * Left text with a right-aligned amount on lines of `width` characters: the left text wraps in
 * the room the amount leaves, and the amount sits at the end of its last line (or alone on a
 * line when it does not fit next to it).
 */
export function columnLines(left: string, right: string, width: number): string[] {
  const rightLength = Array.from(right).length
  if (rightLength === 0) return wrapText(left, width)
  if (rightLength >= width) return [...(left.trim() ? wrapText(left, width) : []), right]
  const lines = left.trim() === '' ? [''] : wrapText(left, width - rightLength - 1)
  const last = lines[lines.length - 1] as string
  const lastLength = Array.from(last).length
  const head = lines.slice(0, -1)
  if (lastLength + 1 + rightLength <= width) return [...head, last + ' '.repeat(width - lastLength - rightLength) + right]
  return [...head, last, ' '.repeat(width - rightLength) + right]
}
