import { describe, expect, it } from 'vitest'
import { barcodeGeometry, buildSymbol, detectBarcodeFormat, MAX_MODULE_MM } from '@/features/labels/barcode/barcode'
import { CODE128, CODE128_PATTERNS, code128Values, encodeCode128 } from '@/features/labels/barcode/code128'
import { EAN_G, EAN_L, EAN_R, encodeEan13, encodeEan8, encodeUpcA, gs1CheckDigit, withCheckDigit } from '@/features/labels/barcode/ean'
import { barWidths, moduleRuns, widthsToModules } from '@/features/labels/barcode/symbol'

const ones = (pattern: string) => [...pattern].filter((m) => m === '1').length

describe('GS1 check digits', () => {
  it.each([
    ['400638133393', 1], // EAN-13 4006381333931
    ['590123412345', 7], // EAN-13 5901234123457
    ['9638507', 4], // EAN-8 96385074
    ['03600029145', 2], // UPC-A 036000291452
    ['20000000000', 4], // in-store EAN-13 prefix 20…: 0 + 2·3 = 6 → 4
  ])('%s → %i', (data, check) => {
    expect(gs1CheckDigit(data)).toBe(check)
  })

  it('adds a missing check digit and rejects a wrong one', () => {
    expect(withCheckDigit('400638133393', 13)).toBe('4006381333931')
    expect(withCheckDigit('4006381333931', 13)).toBe('4006381333931')
    expect(withCheckDigit('4006381333932', 13)).toBeNull()
    expect(withCheckDigit('40063813339', 13)).toBeNull()
    expect(withCheckDigit('40063813339A', 13)).toBeNull()
  })
})

describe('EAN / UPC digit sets', () => {
  it('has odd parity in set A, even in sets B and C; C is A inverted, B is C reversed', () => {
    for (let d = 0; d < 10; d++) {
      expect(EAN_L[d]).toHaveLength(7)
      expect(ones(EAN_L[d]!) % 2).toBe(1)
      expect(ones(EAN_G[d]!) % 2).toBe(0)
      expect(ones(EAN_R[d]!) % 2).toBe(0)
      // Every digit is two bars and two spaces.
      expect(moduleRuns(EAN_L[d]!)).toHaveLength(4)
      expect(EAN_L[d]![0]).toBe('0')
      expect(EAN_R[d]![0]).toBe('1')
    }
    expect(EAN_R[0]).toBe('1110010')
    expect(EAN_G[0]).toBe('0100111')
  })
})

describe('EAN-13', () => {
  it('encodes 4006381333931 (parity LGLLGG from the leading 4)', () => {
    const symbol = encodeEan13('4006381333931')!
    const expected =
      '101' +
      // 0 L, 0 G, 6 L, 3 L, 8 G, 1 G
      '0001101' + '0100111' + '0101111' + '0111101' + '0001001' + '0110011' +
      '01010' +
      // 3 3 3 9 3 1 in set C
      '1000010' + '1000010' + '1000010' + '1110100' + '1000010' + '1100110' +
      '101'
    expect(symbol.modules).toBe(expected)
    expect(symbol.modules).toHaveLength(95)
    expect(symbol.quietLeft).toBe(11)
    expect(symbol.quietRight).toBe(7)
    expect(symbol.guards).toEqual([[0, 3], [45, 50], [92, 95]])
    expect(symbol.text.map((t) => t.value).join('')).toBe('4006381333931')
    // The leading digit sits in the left quiet zone.
    expect(symbol.text[0]!.x).toBeLessThan(0)
  })

  it('adds the check digit to 12 digits and refuses a wrong one', () => {
    expect(encodeEan13('400638133393')!.modules).toBe(encodeEan13('4006381333931')!.modules)
    expect(encodeEan13('4006381333930')).toBeNull()
    expect(encodeEan13('12345')).toBeNull()
  })

  it('draws 30 bars (start 2, 6 × 2, centre 2, 6 × 2, end 2)', () => {
    expect(moduleRuns(encodeEan13('2000000000015')!.modules).filter((r) => r.dark)).toHaveLength(30)
  })
})

describe('EAN-8', () => {
  it('encodes 96385074', () => {
    const symbol = encodeEan8('96385074')!
    expect(symbol.modules).toBe('101' + '0001011' + '0101111' + '0111101' + '0110111' + '01010' + '1001110' + '1110010' + '1000100' + '1011100' + '101')
    expect(symbol.modules).toHaveLength(67)
    expect(symbol.guards).toEqual([[0, 3], [31, 36], [64, 67]])
    expect(encodeEan8('9638507')!.modules).toBe(symbol.modules)
    expect(encodeEan8('96385075')).toBeNull()
  })
})

describe('UPC-A', () => {
  it('encodes 036000291452 with long bars for the first and last digit', () => {
    const symbol = encodeUpcA('036000291452')!
    expect(symbol.modules).toBe(
      '101' + '0001101' + '0111101' + '0101111' + '0001101' + '0001101' + '0001101' +
      '01010' + '1101100' + '1110100' + '1100110' + '1011100' + '1001110' + '1101100' + '101',
    )
    expect(symbol.guards).toEqual([[0, 10], [45, 50], [85, 95]])
    // UPC-A is EAN-13 with a leading 0.
    expect(symbol.modules).toBe(encodeEan13('0036000291452')!.modules)
    expect(symbol.text.map((t) => t.value).join('')).toBe('036000291452')
  })
})

describe('Code 128', () => {
  it('has 107 distinct patterns of 11 modules (stop 13) with an even bar total', () => {
    expect(CODE128_PATTERNS).toHaveLength(107)
    expect(new Set(CODE128_PATTERNS).size).toBe(107)
    CODE128_PATTERNS.forEach((pattern, value) => {
      const widths = [...pattern].map(Number)
      expect(widths.reduce((a, b) => a + b, 0), `value ${value}`).toBe(value === CODE128.STOP ? 13 : 11)
      const bars = widths.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0)
      expect(bars % 2, `value ${value}`).toBe(0)
      expect(widths.every((w) => w >= 1 && w <= 4)).toBe(true)
    })
    expect(CODE128_PATTERNS[CODE128.START_B]).toBe('211214')
    expect(CODE128_PATTERNS[CODE128.START_C]).toBe('211232')
    expect(CODE128_PATTERNS[CODE128.STOP]).toBe('2331112')
  })

  it('encodes PJJ123C in set B with check value 55', () => {
    // 104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7 = 879; 879 mod 103 = 55.
    expect(code128Values('PJJ123C')).toEqual([104, 48, 42, 42, 17, 18, 19, 35, 55, 106])
  })

  it('uses set C for an even run of digits', () => {
    // (105 + 12 + 34·2 + 56·3 + 78·4) mod 103 = 665 mod 103 = 47.
    expect(code128Values('12345678')).toEqual([105, 12, 34, 56, 78, 47, 106])
    expect(code128Values('12')).toEqual([105, 12, (105 + 12) % 103, 106])
  })

  it('keeps the first digit of an odd leading run in set B', () => {
    const values = code128Values('12345')!
    expect(values.slice(0, 5)).toEqual([104, 17, 99, 23, 45])
  })

  it('switches to set C for a trailing run of 4+ digits and back to B after a middle run of 6+', () => {
    expect(code128Values('ABC1234567890')!.slice(0, -2)).toEqual([104, 33, 34, 35, 99, 12, 34, 56, 78, 90])
    expect(code128Values('A123456B')!.slice(0, -2)).toEqual([104, 33, 99, 12, 34, 56, 100, 34])
    // Short runs stay in B.
    expect(code128Values('SKU-123')!.slice(0, -2)).toEqual([104, 51, 43, 53, 13, 17, 18, 19])
  })

  it('rejects text outside printable ASCII', () => {
    expect(code128Values('')).toBeNull()
    expect(code128Values('চা')).toBeNull()
    expect(code128Values('A\tB')).toBeNull()
  })

  it('draws start, data, check and stop with the right bar widths', () => {
    const symbol = encodeCode128('12')!
    expect(barWidths(symbol.modules)).toBe('211232' + '112232' + '122231' + '2331112')
    expect(symbol.modules).toHaveLength(11 * 3 + 13)
    expect(symbol.modules.startsWith('11010011100')).toBe(true)
    expect(symbol.modules.endsWith('1100011101011')).toBe(true)
    expect(symbol.quietLeft).toBe(10)
  })
})

describe('symbol helpers', () => {
  it('turns widths into modules and back', () => {
    expect(widthsToModules('211232')).toBe('11010011100')
    expect(barWidths('11010011100')).toBe('211232')
  })
})

describe('format choice and layout', () => {
  it('detects retail formats by length and check digit', () => {
    expect(detectBarcodeFormat('4006381333931')).toBe('ean13')
    expect(detectBarcodeFormat('036000291452')).toBe('upca')
    expect(detectBarcodeFormat('96385074')).toBe('ean8')
    expect(detectBarcodeFormat('4006381333932')).toBe('code128')
    expect(detectBarcodeFormat('JUICE-1L')).toBe('code128')
  })

  it('falls back to Code 128 when a code does not fit its format', () => {
    expect(buildSymbol('4006381333931', 'ean13')!.format).toBe('ean13')
    expect(buildSymbol('4006381333932', 'ean13')!.format).toBe('code128')
    expect(buildSymbol('400638133393', 'ean13')!.format).toBe('code128')
    expect(buildSymbol('চা', 'code128')).toBeNull()
  })

  it('fits the box, caps the module width and lengthens guard bars into the digit band', () => {
    const symbol = encodeEan13('4006381333931')!
    const wide = barcodeGeometry(symbol, 100, 20, true)
    expect(wide.widthMm).toBeCloseTo(113 * MAX_MODULE_MM)
    const narrow = barcodeGeometry(symbol, 30, 12, true)
    expect(narrow.widthMm).toBeCloseTo(30)
    expect(narrow.viewWidth).toBe(113)
    // 30 bars, offset by the 11-module quiet zone; the first (guard) bar is longer than a data bar.
    const bars = [...narrow.path.matchAll(/M([\d.]+) 0h(\d+)v([\d.]+)/g)].map((m) => ({ x: Number(m[1]), w: Number(m[2]), h: Number(m[3]) }))
    expect(bars).toHaveLength(30)
    expect(bars[0]!.x).toBe(11)
    expect(bars[0]!.h).toBeGreaterThan(bars[2]!.h)
    expect(narrow.text).toHaveLength(13)
    // Digits too small to read (under 1.5 mm) are dropped; the bars take the height.
    expect(barcodeGeometry(symbol, 30, 4, true).text).toHaveLength(0)
    const plain = barcodeGeometry(symbol, 30, 12, false)
    expect(plain.text).toHaveLength(0)
    expect(new Set([...plain.path.matchAll(/v([\d.]+)/g)].map((m) => m[1])).size).toBe(1)
  })
})
