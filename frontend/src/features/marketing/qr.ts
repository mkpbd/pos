/**
 * A small QR code encoder (ISO/IEC 18004) for short links: byte mode (UTF-8), versions 1–10,
 * error correction level M by default. No dependency — the matrix is drawn as SVG by the caller.
 * Follows the reference algorithm (Project Nayuki's QR Code generator, MIT) step for step.
 */

export type QrLevel = 'L' | 'M' | 'Q' | 'H'

export type QrCode = {
  version: number
  size: number
  mask: number
  /** `modules[y][x]`: true = dark. */
  modules: boolean[][]
}

const MAX_VERSION = 10

/** Format-information bits of each level (L=01, M=00, Q=11, H=10). */
const FORMAT_BITS: Record<QrLevel, number> = { L: 1, M: 0, Q: 3, H: 2 }

/** Index = version (0 unused). */
const ECC_PER_BLOCK: Record<QrLevel, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
}
const BLOCKS: Record<QrLevel, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
}

/** Modules available for data and error correction in a version. */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2
    result -= (25 * align - 10) * align - 55
    if (version >= 7) result -= 36
  }
  return result
}

export function dataCodewords(version: number, level: QrLevel): number {
  return Math.floor(rawDataModules(version) / 8) - (ECC_PER_BLOCK[level][version] as number) * (BLOCKS[level][version] as number)
}

/** Centres of the alignment patterns of a version. */
export function alignmentPositions(version: number): number[] {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2
  const size = version * 4 + 17
  const result = [6]
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos)
  return result
}

// ── Reed–Solomon over GF(2^8), polynomial 0x11D ─────────────────────────────

function gfMultiply(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function rsDivisor(degree: number): number[] {
  const result: number[] = Array.from({ length: degree - 1 }, () => 0)
  result.push(1)
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j] as number, root)
      if (j + 1 < result.length) result[j] = (result[j] as number) ^ (result[j + 1] as number)
    }
    root = gfMultiply(root, 0x02)
  }
  return result
}

/** Error-correction codewords of one block (exported for the known-vector test). */
export function rsRemainder(data: number[], degree: number): number[] {
  const divisor = rsDivisor(degree)
  const result: number[] = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    divisor.forEach((coef, i) => {
      result[i] = (result[i] as number) ^ gfMultiply(coef, factor)
    })
  }
  return result
}

/** The 15 format bits (level + mask, BCH-protected and masked with 0x5412). */
export function formatBits(level: QrLevel, mask: number): number {
  const data = (FORMAT_BITS[level] << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}

/** The 18 version bits (versions 7 and up). */
export function versionBits(version: number): number {
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (version << 12) | rem
}

const bit = (value: number, i: number) => ((value >>> i) & 1) !== 0

// ── Data codewords ───────────────────────────────────────────────────────────

function encodeData(bytes: Uint8Array, version: number, level: QrLevel): number[] {
  const bits: number[] = []
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  append(0b0100, 4) // byte mode
  append(bytes.length, version <= 9 ? 8 : 16)
  bytes.forEach((b) => append(b, 8))
  const capacity = dataCodewords(version, level) * 8
  append(0, Math.min(4, capacity - bits.length))
  append(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) append(pad, 8)

  const result: number[] = []
  for (let i = 0; i < bits.length; i += 8) result.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0))
  return result
}

function interleave(data: number[], version: number, level: QrLevel): number[] {
  const numBlocks = BLOCKS[level][version] as number
  const eccLen = ECC_PER_BLOCK[level][version] as number
  const raw = Math.floor(rawDataModules(version) / 8)
  const numShort = numBlocks - (raw % numBlocks)
  const shortLen = Math.floor(raw / numBlocks)

  const blocks: number[][] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, eccLen)
    if (i < numShort) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const result: number[] = []
  for (let i = 0; i < (blocks[0] as number[]).length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= numShort) result.push(block[i] as number)
    })
  }
  return result
}

// ── Matrix ───────────────────────────────────────────────────────────────────

class Matrix {
  readonly modules: boolean[][]
  readonly isFunction: boolean[][]
  readonly size: number
  constructor(size: number) {
    this.size = size
    this.modules = Array.from({ length: size }, () => Array.from({ length: size }, () => false))
    this.isFunction = Array.from({ length: size }, () => Array.from({ length: size }, () => false))
  }
  set(x: number, y: number, dark: boolean) {
    ;(this.modules[y] as boolean[])[x] = dark
    ;(this.isFunction[y] as boolean[])[x] = true
  }
}

function drawFunctionPatterns(m: Matrix, version: number) {
  const size = m.size
  for (let i = 0; i < size; i++) {
    m.set(6, i, i % 2 === 0)
    m.set(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) m.set(x, y, dist !== 2 && dist !== 4)
      }
    }
  }
  const align = alignmentPositions(version)
  const last = align.length - 1
  align.forEach((ax, i) => {
    align.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) m.set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    })
  })
  drawFormat(m, 'M', 0) // reserves the areas; redrawn with the real mask later
  if (version >= 7) {
    const bits = versionBits(version)
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      m.set(a, b, bit(bits, i))
      m.set(b, a, bit(bits, i))
    }
  }
}

function drawFormat(m: Matrix, level: QrLevel, mask: number) {
  const bits = formatBits(level, mask)
  const size = m.size
  for (let i = 0; i <= 5; i++) m.set(8, i, bit(bits, i))
  m.set(8, 7, bit(bits, 6))
  m.set(8, 8, bit(bits, 7))
  m.set(7, 8, bit(bits, 8))
  for (let i = 9; i < 15; i++) m.set(14 - i, 8, bit(bits, i))
  for (let i = 0; i < 8; i++) m.set(size - 1 - i, 8, bit(bits, i))
  for (let i = 8; i < 15; i++) m.set(8, size - 15 + i, bit(bits, i))
  m.set(8, size - 8, true)
}

function drawCodewords(m: Matrix, codewords: number[]) {
  const size = m.size
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!(m.isFunction[y] as boolean[])[x] && i < codewords.length * 8) {
          ;(m.modules[y] as boolean[])[x] = bit(codewords[i >>> 3] as number, 7 - (i & 7))
          i++
        }
      }
    }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

function applyMask(m: Matrix, mask: number) {
  const test = MASKS[mask] as (x: number, y: number) => boolean
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (!(m.isFunction[y] as boolean[])[x] && test(x, y)) (m.modules[y] as boolean[])[x] = !(m.modules[y] as boolean[])[x]
    }
  }
}

/** The standard's four penalty rules; the lowest-scoring mask is used. */
export function penalty(modules: boolean[][]): number {
  const size = modules.length
  const at = (x: number, y: number) => (modules[y] as boolean[])[x] as boolean
  let score = 0
  const lines: boolean[][] = []
  for (let i = 0; i < size; i++) {
    lines.push(modules[i] as boolean[])
    lines.push(Array.from({ length: size }, (_, k) => at(i, k)))
  }
  const finderA = [true, false, true, true, true, false, true, false, false, false, false]
  const finderB = [false, false, false, false, true, false, true, true, true, false, true]
  for (const line of lines) {
    let run = 1
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++
      else {
        if (run >= 5) score += 3 + (run - 5)
        run = 1
      }
    }
    for (let i = 0; i + 11 <= size; i++) {
      if (finderA.every((v, k) => line[i + k] === v) || finderB.every((v, k) => line[i + k] === v)) score += 40
    }
  }
  let dark = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (at(x, y)) dark++
      if (x + 1 < size && y + 1 < size) {
        const c = at(x, y)
        if (at(x + 1, y) === c && at(x, y + 1) === c && at(x + 1, y + 1) === c) score += 3
      }
    }
  }
  const total = size * size
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  return score
}

/**
 * Encodes text (UTF-8) in the smallest version that fits; `mask` forces a mask pattern (tests).
 * Throws when the text is too long for version 10 (213 bytes at level M).
 */
export function encodeQr(text: string, level: QrLevel = 'M', mask?: number): QrCode {
  const bytes = new TextEncoder().encode(text)
  let version = 1
  while (version <= MAX_VERSION && 4 + (version <= 9 ? 8 : 16) + bytes.length * 8 > dataCodewords(version, level) * 8) version++
  if (version > MAX_VERSION) throw new Error('Text too long for a QR code')

  const codewords = interleave(encodeData(bytes, version, level), version, level)
  const build = (maskIndex: number) => {
    const m = new Matrix(version * 4 + 17)
    drawFunctionPatterns(m, version)
    drawCodewords(m, codewords)
    applyMask(m, maskIndex)
    drawFormat(m, level, maskIndex)
    return m
  }

  let best = mask ?? 0
  if (mask === undefined) {
    let bestScore = Infinity
    for (let k = 0; k < 8; k++) {
      const score = penalty(build(k).modules)
      if (score < bestScore) {
        bestScore = score
        best = k
      }
    }
  }
  const m = build(best)
  return { version, size: m.size, mask: best, modules: m.modules }
}

/** SVG path data of the dark modules, offset by the quiet zone (in module units). */
export function qrPath(code: QrCode, margin = 4): string {
  const parts: string[] = []
  code.modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + margin},${y + margin}h1v1h-1z`)
    })
  })
  return parts.join('')
}

/** A standalone SVG document (black on white, 4-module quiet zone) for downloading. */
export function qrSvg(text: string, pixelsPerModule = 8): string {
  const code = encodeQr(text)
  const dim = code.size + 8
  const px = dim * pixelsPerModule
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#ffffff"/><path fill="#000000" d="${qrPath(code)}"/></svg>\n`
}
