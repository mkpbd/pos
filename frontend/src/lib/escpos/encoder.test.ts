import { describe, expect, it } from 'vitest'
import { encodeText, needsRaster, normalizeText, upperHalf } from '@/lib/escpos/code-pages'
import { columnLines, EscPosEncoder, RASTER_BAND_ROWS, wrapText } from '@/lib/escpos/encoder'
import { packRaster } from '@/lib/escpos/raster'

const bytes = (e: EscPosEncoder) => Array.from(e.encode())
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0))

describe('EscPosEncoder', () => {
  it('writes the basic commands as exact bytes', () => {
    expect(bytes(new EscPosEncoder().initialize())).toEqual([0x1b, 0x40])
    expect(bytes(new EscPosEncoder().codePage('cp437'))).toEqual([0x1b, 0x74, 0])
    expect(bytes(new EscPosEncoder().codePage('cp1252'))).toEqual([0x1b, 0x74, 16])
    expect(bytes(new EscPosEncoder().bold(true).bold(false))).toEqual([0x1b, 0x45, 1, 0x1b, 0x45, 0])
    expect(bytes(new EscPosEncoder().size(2, 2).size(1, 1).size(2, 1))).toEqual([0x1d, 0x21, 0x11, 0x1d, 0x21, 0x00, 0x1d, 0x21, 0x10])
    expect(bytes(new EscPosEncoder().align('left').align('center').align('right'))).toEqual([0x1b, 0x61, 0, 0x1b, 0x61, 1, 0x1b, 0x61, 2])
    expect(bytes(new EscPosEncoder().line('Hi').newline(2))).toEqual([0x48, 0x69, 0x0a, 0x0a, 0x0a])
    expect(bytes(new EscPosEncoder().feed(3))).toEqual([0x1b, 0x64, 3])
    expect(bytes(new EscPosEncoder().rule(4))).toEqual([...ascii('----'), 0x0a])
  })

  it('cuts with GS V 66 0 and kicks the drawer with ESC p on pin 2 or pin 5', () => {
    expect(bytes(new EscPosEncoder().cut())).toEqual([0x1d, 0x56, 0x42, 0x00])
    expect(bytes(new EscPosEncoder().drawer())).toEqual([0x1b, 0x70, 0, 25, 250])
    expect(bytes(new EscPosEncoder().drawer(2))).toEqual([0x1b, 0x70, 0, 25, 250])
    expect(bytes(new EscPosEncoder().drawer(5))).toEqual([0x1b, 0x70, 1, 25, 250])
  })

  it('prints a QR code with the printer’s own GS ( k commands', () => {
    const data = 'https://shop.test/receipt/abc'
    expect(bytes(new EscPosEncoder().qr(data))).toEqual([
      0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00, // model 2
      0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6, // module size
      0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 49, // error correction M
      0x1d, 0x28, 0x6b, data.length + 3, 0, 0x31, 0x50, 0x30, ...ascii(data), // store
      0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30, // print
    ])
    const long = 'x'.repeat(300)
    const stored = bytes(new EscPosEncoder().qr(long, { size: 4, errorCorrection: 'H' }))
    expect(stored.slice(17, 25)).toEqual([0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 51])
    expect(stored.slice(25, 30)).toEqual([0x1d, 0x28, 0x6b, (303 & 0xff), 303 >> 8])
  })

  it('encodes text in the code page, with stand-ins for punctuation it lacks', () => {
    expect(encodeText('Café €5', 'cp1252')).toEqual([...ascii('Caf'), 0xe9, 0x20, 0x80, 0x35])
    expect(encodeText('Café €5', 'cp437')).toEqual([...ascii('Caf'), 0x82, 0x20, ...ascii('EUR5')])
    // Em dash, times, bullet and the narrow no-break space browsers put in times.
    expect(encodeText('Shirt — XL 2×', 'cp1252')).toEqual([...ascii('Shirt '), 0x97, ...ascii(' XL 2'), 0xd7])
    expect(encodeText('Shirt — XL 2×', 'cp437')).toEqual(ascii('Shirt - XL 2x'))
    expect(encodeText('••••1234 6:00 PM', 'cp437')).toEqual(ascii('****1234 6:00 PM'))
    expect(encodeText('a\tb\u0007', 'cp1252')).toEqual(ascii('a b'))
    expect(normalizeText('৳ 50 — ok', 'cp437')).toBe('Tk 50 - ok')
    expect(upperHalf('cp437')).toHaveLength(128)
    expect(upperHalf('cp1252')).toHaveLength(128)
  })

  it('needs a picture only for characters no code page holds', () => {
    expect(needsRaster('Mango Juice — 1 L × 2 • Café 6:00 PM', 'cp1252')).toBe(false)
    expect(needsRaster('Mango Juice — 1 L × 2', 'cp437')).toBe(false)
    expect(needsRaster('আমের জুস', 'cp1252')).toBe(true)
    expect(needsRaster('Juice 😀', 'cp437')).toBe(true)
  })
})

describe('text layout', () => {
  it('wraps at spaces, splits long words and keeps an indent', () => {
    expect(wrapText('The quick brown fox jumps', 10)).toEqual(['The quick', 'brown fox', 'jumps'])
    expect(wrapText('ABCDEFGHIJKL', 5)).toEqual(['ABCDE', 'FGHIJ', 'KL'])
    expect(wrapText('  S/N: 111, 222', 9)).toEqual(['  S/N:', '111, 222'])
    expect(wrapText('one\ntwo', 10)).toEqual(['one', 'two'])
    expect(wrapText('', 10)).toEqual([''])
  })

  it('puts the amount at the right edge for 32, 42 and 48 characters', () => {
    expect(columnLines('Subtotal', '1,250.00', 32)).toEqual([`Subtotal${' '.repeat(16)}1,250.00`])
    expect(columnLines('Subtotal', '1,250.00', 42)).toEqual([`Subtotal${' '.repeat(26)}1,250.00`])
    expect(columnLines('Subtotal', '1,250.00', 48)).toEqual([`Subtotal${' '.repeat(32)}1,250.00`])
    for (const width of [32, 42, 48]) expect(columnLines('TOTAL', 'BDT 75.00', width)[0]).toHaveLength(width)
  })

  it('wraps a long label beside the amount, or drops the amount to its own line', () => {
    expect(columnLines('Basmati rice premium quality 5 kg bag', '1,250.00', 32)).toEqual([
      'Basmati rice premium',
      `quality 5 kg bag${' '.repeat(8)}1,250.00`,
    ])
    expect(columnLines('Gift card ••••NPQR', '40.00', 20)).toEqual(['Gift card', `••••NPQR${' '.repeat(7)}40.00`])
    expect(columnLines('', '9.00', 10)).toEqual(['      9.00'])
  })
})

describe('raster', () => {
  it('packs RGBA pixels into 1-bit rows, leftmost pixel in the top bit, width padded to bytes', () => {
    // 10 × 2: row 0 = black at x 0, 7, 8; row 1 = black at x 9 (and a transparent black at x 1).
    const width = 10
    const height = 2
    const data = new Uint8ClampedArray(width * height * 4).fill(255)
    const black = (x: number, y: number, alpha = 255) => {
      const i = (y * width + x) * 4
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = alpha
    }
    black(0, 0); black(7, 0); black(8, 0); black(9, 1); black(1, 1, 0)
    // A mid grey (120) is darker than the default threshold (128); a light grey is not.
    data.set([120, 120, 120, 255], (1 * width + 2) * 4)
    data.set([200, 200, 200, 255], (1 * width + 3) * 4)

    const packed = packRaster({ width, height, data })
    expect(packed.widthBytes).toBe(2)
    expect(packed.height).toBe(2)
    expect(Array.from(packed.data)).toEqual([0b1000_0001, 0b1000_0000, 0b0010_0000, 0b0100_0000])
  })

  it('sends the picture as GS v 0 bands', () => {
    const packed = { widthBytes: 2, height: 3, data: Uint8Array.from([1, 2, 3, 4, 5, 6]) }
    expect(bytes(new EscPosEncoder().raster(packed))).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 3, 0, 1, 2, 3, 4, 5, 6])

    const tall = { widthBytes: 1, height: RASTER_BAND_ROWS + 2, data: new Uint8Array(RASTER_BAND_ROWS + 2).fill(0xff) }
    const out = bytes(new EscPosEncoder().raster(tall))
    expect(out.slice(0, 8)).toEqual([0x1d, 0x76, 0x30, 0x00, 1, 0, RASTER_BAND_ROWS & 0xff, RASTER_BAND_ROWS >> 8])
    expect(out.slice(8 + RASTER_BAND_ROWS, 16 + RASTER_BAND_ROWS)).toEqual([0x1d, 0x76, 0x30, 0x00, 1, 0, 2, 0])
    expect(out).toHaveLength(16 + RASTER_BAND_ROWS + 2)
  })
})
