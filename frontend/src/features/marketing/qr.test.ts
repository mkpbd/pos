import { describe, expect, it } from 'vitest'
import { alignmentPositions, dataCodewords, encodeQr, formatBits, qrPath, qrSvg, rsRemainder, versionBits, type QrCode } from '@/features/marketing/qr'

/**
 * Reads a code back the way a scanner does (format bits, unmask, zigzag, de-interleave) — enough
 * to prove the bytes in the symbol are the bytes we put in, with valid error correction.
 */
function readBack(code: QrCode): { mask: number; bytes: number[] } {
  const { size, modules } = code
  const at = (x: number, y: number) => (modules[y] as boolean[])[x] as boolean
  // Format bits, first copy (around the top-left finder).
  let bits = 0
  const coords: [number, number][] = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]
  coords.forEach(([x, y], i) => {
    if (at(x, y)) bits |= 1 << i
  })
  const mask = ((bits ^ 0x5412) >>> 10) & 7
  expect(formatBits('M', mask)).toBe(bits)

  // Function-module map, rebuilt independently of the encoder's internals.
  const fn = Array.from({ length: size }, () => Array.from({ length: size }, () => false))
  const mark = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < size && y < size) (fn[y] as boolean[])[x] = true
  }
  for (let i = 0; i < size; i++) {
    mark(6, i)
    mark(i, 6)
  }
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) mark(x, y)
  for (let y = 0; y < 9; y++) for (let x = size - 8; x < size; x++) mark(x, y)
  for (let y = size - 8; y < size; y++) for (let x = 0; x < 9; x++) mark(x, y)
  const align = alignmentPositions(code.version)
  for (const ax of align) {
    for (const ay of align) {
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6)) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(ax + dx, ay + dy)
    }
  }
  if (code.version >= 7) for (let i = 0; i < 6; i++) for (let j = size - 11; j < size - 8; j++) { mark(i, j); mark(j, i) }

  const maskFn = [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_x: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ][mask]!
  const stream: number[] = []
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert
        if (!fn[y]![x]) stream.push(at(x, y) !== maskFn(x, y) ? 1 : 0)
      }
    }
  }
  const codewords: number[] = []
  for (let i = 0; i + 8 <= stream.length; i += 8) codewords.push(stream.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))

  // Level M block structure for versions 1–10.
  const blocks = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5][code.version]!
  const ecc = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26][code.version]!
  const dataTotal = dataCodewords(code.version, 'M')
  const shortData = Math.floor(dataTotal / blocks)
  const longCount = dataTotal % blocks
  const sizes = Array.from({ length: blocks }, (_, i) => shortData + (i >= blocks - longCount ? 1 : 0))
  const dataBlocks = sizes.map(() => [] as number[])
  let k = 0
  for (let i = 0; i < shortData + 1; i++) sizes.forEach((s, b) => { if (i < s) dataBlocks[b]!.push(codewords[k++]!) })
  const eccBlocks = sizes.map(() => [] as number[])
  for (let i = 0; i < ecc; i++) sizes.forEach((_, b) => eccBlocks[b]!.push(codewords[k++]!))
  dataBlocks.forEach((d, b) => expect(rsRemainder(d, ecc)).toEqual(eccBlocks[b]))

  const data = dataBlocks.flat()
  const bitsOf = data.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1))
  const read = (from: number, len: number) => bitsOf.slice(from, from + len).reduce((a, b) => (a << 1) | b, 0)
  expect(read(0, 4)).toBe(0b0100)
  const countBits = code.version <= 9 ? 8 : 16
  const length = read(4, countBits)
  const bytes = Array.from({ length }, (_, i) => read(4 + countBits + i * 8, 8))
  return { mask, bytes }
}

describe('QR encoder', () => {
  it('computes Reed–Solomon codewords of the standard example (HELLO WORLD, 1-M)', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]
    expect(rsRemainder(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23])
  })

  it('produces the published format and version bit strings', () => {
    const bin = (v: number, n: number) => v.toString(2).padStart(n, '0')
    expect(bin(formatBits('L', 0), 15)).toBe('111011111000100')
    expect(bin(formatBits('L', 1), 15)).toBe('111001011110011')
    expect(bin(formatBits('M', 0), 15)).toBe('101010000010010')
    expect(bin(formatBits('M', 1), 15)).toBe('101000100100101')
    expect(bin(formatBits('Q', 0), 15)).toBe('011010101011111')
    expect(bin(formatBits('H', 0), 15)).toBe('001011010001001')
    expect(bin(versionBits(7), 18)).toBe('000111110010010100')
  })

  it('places alignment patterns where the standard puts them', () => {
    expect(alignmentPositions(1)).toEqual([])
    expect(alignmentPositions(2)).toEqual([6, 18])
    expect(alignmentPositions(7)).toEqual([6, 22, 38])
    expect(alignmentPositions(10)).toEqual([6, 28, 50])
  })

  it('has the capacities of the standard at level M', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => dataCodewords(v, 'M'))).toEqual([16, 28, 44, 64, 86, 108, 124, 154, 182, 216])
  })

  it.each([
    'https://shop.test/go/eid',
    'https://berry-kids.example.com/go/eid-sale-2026',
    'https://berry-kids.example.com/go/facebook-eid-offer-2026?utm_source=facebook&utm_medium=paid&utm_campaign=eid-sale',
    `https://a-long-store-name.example.com.bd/go/${'x'.repeat(120)}`,
  ])('encodes %s so that it reads back exactly', (text) => {
    const code = encodeQr(text)
    expect(code.size).toBe(code.version * 4 + 17)
    const { mask, bytes } = readBack(code)
    expect(mask).toBe(code.mask)
    expect(new TextDecoder().decode(new Uint8Array(bytes))).toBe(text)
  })

  it('reads back with every mask, and draws finders, timing and the dark module', () => {
    for (let mask = 0; mask < 8; mask++) {
      const code = encodeQr('https://shop.test/go/winter', 'M', mask)
      expect(readBack(code).bytes.length).toBe('https://shop.test/go/winter'.length)
      const m = code.modules
      expect(m[0]!.slice(0, 7)).toEqual([true, true, true, true, true, true, true])
      expect(m[1]!.slice(0, 7)).toEqual([true, false, false, false, false, false, true])
      expect(m[6]!.slice(8, 13)).toEqual([true, false, true, false, true])
      expect(m[code.size - 8]![8]).toBe(true)
    }
  })

  it('refuses text longer than version 10 holds', () => {
    expect(() => encodeQr('x'.repeat(300))).toThrow()
  })

  it('draws an SVG with a quiet zone', () => {
    const code = encodeQr('https://shop.test/go/eid')
    expect(qrPath(code)).toMatch(/^M4,4h1v1h-1z/)
    const svg = qrSvg('https://shop.test/go/eid')
    expect(svg).toContain(`viewBox="0 0 ${code.size + 8} ${code.size + 8}"`)
    expect(svg).toContain('fill="#ffffff"')
  })
})
