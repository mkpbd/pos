import { describe, expect, it } from 'vitest'
import { documentNeedsRaster, drawBlocks, drawerKick, PAPER_DOTS, renderDocument, wrapMeasured, type PrintBlock } from '@/lib/escpos/document'
import type { Canvas2DLike, CanvasLike, CreateCanvas } from '@/lib/escpos/raster'

const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0))
const LF = 0x0a

/** A canvas that records what is drawn; text is 12 dots per character and every pixel black. */
function fakeCanvas() {
  const drawn: { text: string; x: number; y: number; align: string; font: string }[] = []
  const sizes: { width: number; height: number }[] = []
  const create: CreateCanvas = (width, height) => {
    sizes.push({ width, height })
    const ctx: Canvas2DLike = {
      font: '', fillStyle: '#000', textAlign: 'left', textBaseline: 'alphabetic',
      fillRect: () => {},
      fillText(text, x, y) { drawn.push({ text, x, y, align: this.textAlign, font: this.font }) },
      measureText: (text) => ({ width: Array.from(text).length * 12 }),
      getImageData: (_x, _y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 0)) }),
    }
    const canvas: CanvasLike = { width, height, getContext: () => ctx }
    return canvas
  }
  return { create, drawn, sizes }
}

const receipt: PrintBlock[] = [
  { kind: 'text', text: 'Shop', align: 'center', bold: true, large: true },
  { kind: 'rule' },
  { kind: 'columns', left: 'TOTAL', right: '50.00', bold: true },
  { kind: 'qr', data: 'https://s.test/r/1' },
]

describe('renderDocument', () => {
  it('prints a Latin receipt in text mode: init, code page, styles, columns, QR, cut', () => {
    const out = Array.from(renderDocument(receipt, { width: 32, codePage: 'cp1252', raster: 'auto', cut: true }))
    const qr = 'https://s.test/r/1'
    expect(out).toEqual([
      0x1b, 0x40, 0x1b, 0x74, 16,
      0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x1d, 0x21, 0x11, ...ascii('Shop'), LF, 0x1d, 0x21, 0x00, 0x1b, 0x45, 0, 0x1b, 0x61, 0,
      ...ascii('-'.repeat(32)), LF,
      0x1b, 0x45, 1, ...ascii(`TOTAL${' '.repeat(22)}50.00`), LF, 0x1b, 0x45, 0,
      0x1b, 0x61, 1,
      0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00,
      0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6,
      0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 49,
      0x1d, 0x28, 0x6b, qr.length + 3, 0, 0x31, 0x50, 0x30, ...ascii(qr),
      0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30,
      LF, 0x1b, 0x61, 0,
      0x1d, 0x56, 0x42, 0x00,
    ])
  })

  it('kicks the drawer once before the copies, and feeds instead of cutting when asked', () => {
    const blocks: PrintBlock[] = [{ kind: 'text', text: 'Hi' }]
    expect(Array.from(renderDocument(blocks, { width: 48, codePage: 'cp437', raster: 'auto', cut: false, copies: 2, drawerPin: 5 }))).toEqual([
      0x1b, 0x40, 0x1b, 0x74, 0, 0x1b, 0x70, 1, 25, 250,
      ...ascii('Hi'), LF, 0x1b, 0x64, 4,
      ...ascii('Hi'), LF, 0x1b, 0x64, 4,
    ])
    expect(Array.from(drawerKick(2))).toEqual([0x1b, 0x40, 0x1b, 0x70, 0, 25, 250])
  })

  it('wraps double-size text at half the width', () => {
    const out = renderDocument([{ kind: 'text', text: 'ABCDEFGHIJKLMNOPQRS', large: true }], { width: 32, codePage: 'cp1252', raster: 'auto', cut: false })
    const text = String.fromCharCode(...out)
    expect(text).toContain('ABCDEFGHIJKLMNOP\nQRS\n')
  })

  it('prints Bangla as a picture by itself (QR codes stay native)', () => {
    const canvas = fakeCanvas()
    const blocks: PrintBlock[] = [
      { kind: 'text', text: 'আমার দোকান', align: 'center', bold: true },
      { kind: 'columns', left: 'মোট', right: '50.00' },
      { kind: 'qr', data: 'Q' },
      { kind: 'text', text: 'ধন্যবাদ' },
    ]
    expect(documentNeedsRaster(blocks, 'cp1252')).toBe(true)
    const out = Array.from(renderDocument(blocks, { width: 48, codePage: 'cp1252', raster: 'auto', cut: true, createCanvas: canvas.create }))

    // Two pictures 576 dots (72 bytes) wide: the first two blocks (2 lines × 30 dots), then the last (1 line).
    expect(out.slice(0, 5)).toEqual([0x1b, 0x40, 0x1b, 0x74, 16])
    expect(out.slice(5, 13)).toEqual([0x1d, 0x76, 0x30, 0x00, 72, 0, 60, 0])
    expect(out.slice(13, 13 + 72 * 60).every((b) => b === 0xff)).toBe(true)
    const afterFirst = 13 + 72 * 60
    expect(out.slice(afterFirst, afterFirst + 3)).toEqual([0x1b, 0x61, 1])
    const second = out.indexOf(0x76, afterFirst) - 1
    expect(out.slice(second, second + 8)).toEqual([0x1d, 0x76, 0x30, 0x00, 72, 0, 30, 0])
    expect(out.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00])

    expect(canvas.drawn.map((d) => [d.text, d.x, d.align])).toEqual([
      ['আমার দোকান', 288, 'center'],
      ['মোট', 0, 'left'],
      ['50.00', 576, 'right'],
      ['ধন্যবাদ', 0, 'left'],
    ])
    expect(canvas.drawn[0]?.font).toMatch(/^bold 20px .*Noto Sans Bengali/)
  })

  it('always prints a picture when chosen, and fails clearly without a canvas', () => {
    const canvas = fakeCanvas()
    const out = renderDocument([{ kind: 'text', text: 'Hello' }], { width: 32, codePage: 'cp1252', raster: 'always', cut: false, createCanvas: canvas.create })
    expect(Array.from(out.slice(5, 13))).toEqual([0x1d, 0x76, 0x30, 0x00, 48, 0, 30, 0])
    expect(canvas.sizes.at(-1)).toEqual({ width: PAPER_DOTS[32], height: 30 })

    const noCanvas: CreateCanvas = (width, height) => ({ width, height, getContext: () => null })
    expect(() => renderDocument([{ kind: 'text', text: 'Hello' }], { width: 32, codePage: 'cp1252', raster: 'always', cut: false, createCanvas: noCanvas })).toThrow(/cannot draw/)
  })

  it('lays out columns and rules on the canvas', () => {
    const canvas = fakeCanvas()
    const picture = drawBlocks([{ kind: 'rule' }, { kind: 'feed', lines: 1 }, { kind: 'columns', left: 'A very long product name here', right: '1,000.00' }], 384 / 2, canvas.create)
    // 192 dots = 16 characters: the label wraps in the 7 left beside the amount.
    expect(picture.widthBytes).toBe(24)
    expect(picture.height).toBe(16 + 30 + 30 * 5)
    expect(wrapMeasured('A very long product name here', 84, (t) => t.length * 12)).toEqual(['A very', 'long', 'product', 'name', 'here'])
  })
})
