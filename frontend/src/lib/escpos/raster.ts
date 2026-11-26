/** A 1-bit picture ready for `GS v 0`: rows of `widthBytes` bytes, the top bit of each byte leftmost. */
export type PackedRaster = { widthBytes: number; height: number; data: Uint8Array }

/** RGBA pixels as a canvas gives them (`ImageData`). */
export type Pixels = { width: number; height: number; data: ArrayLike<number> }

/**
 * Packs RGBA pixels into printer dots: a pixel prints (bit 1) when it is darker than `threshold`
 * (0–255 luminance) and not transparent. The width is padded with white up to a whole byte.
 */
export function packRaster(image: Pixels, threshold = 128): PackedRaster {
  const widthBytes = Math.ceil(image.width / 8)
  const data = new Uint8Array(widthBytes * image.height)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4
      const r = image.data[i] ?? 255
      const g = image.data[i + 1] ?? 255
      const b = image.data[i + 2] ?? 255
      const a = image.data[i + 3] ?? 255
      // Rec. 601 luma in integers; transparent pixels are paper.
      const luma = (r * 299 + g * 587 + b * 114) / 1000
      if (a >= 128 && luma < threshold) {
        const at = y * widthBytes + (x >> 3)
        data[at] = (data[at] ?? 0) | (0x80 >> (x & 7))
      }
    }
  }
  return { widthBytes, height: image.height, data }
}

/** The bits of a 2D canvas the receipt drawing uses (an `HTMLCanvasElement` or a test fake). */
export type CanvasLike = {
  width: number
  height: number
  getContext(type: '2d'): Canvas2DLike | null
}

export type Canvas2DLike = {
  font: string
  fillStyle: string | CanvasGradient | CanvasPattern
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
  getImageData(x: number, y: number, w: number, h: number): Pixels
}

export type CreateCanvas = (width: number, height: number) => CanvasLike

/** A canvas in the page (raster printing needs a browser that can draw). */
export const createDomCanvas: CreateCanvas = (width, height) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas as unknown as CanvasLike
}
