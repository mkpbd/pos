import { describe, expect, it } from 'vitest'
import { productDetail } from '../test-fixtures'
import { chipImageOf, galleryImagesFor, photosOf, photoValueOf, sizeOptionIndex } from './option-photos'

const images = [
  { id: 'red-1', url: '/r1.png', alt: 'Red front' },
  { id: 'red-2', url: '/r2.png', alt: 'Red back' },
  { id: 'blue-1', url: '/b1.png', alt: 'Blue front' },
  { id: 'label', url: '/l.png', alt: 'Label' },
]

const product = productDetail({
  images,
  photo_option: 'Colour',
  options: [
    {
      name: 'Colour',
      slug: 'colour',
      display: 'image',
      values: [
        { value: 'Red', swatch_hex: '#ff0000', image: { id: 'red-1', url: '/r1.png', alt: 'Red front' }, image_ids: ['red-2', 'red-1', 'gone'] },
        { value: 'Blue', swatch_hex: '#0000ff', image: null, image_ids: ['blue-1'] },
        { value: 'Green', swatch_hex: null, image: null, image_ids: [] },
      ],
    },
    { name: 'Size', slug: 'size', display: 'button', values: [{ value: 'M', swatch_hex: null, image: null, image_ids: [] }] },
  ],
})

describe('photos per option value', () => {
  it('reads the photo option value of a selection', () => {
    expect(photoValueOf(product, { Colour: 'Red', Size: 'M' })).toBe('Red')
    expect(photoValueOf({ photo_option: null }, { Colour: 'Red' })).toBeUndefined()
    expect(photoValueOf({}, { Colour: 'Red' })).toBeUndefined()
  })

  it("lists a value's photos in its order and skips unknown ids", () => {
    expect(photosOf(product, 'Red').map((i) => i.id)).toEqual(['red-2', 'red-1'])
    expect(photosOf(product, 'Green')).toEqual([])
    expect(photosOf(product, undefined)).toEqual([])
  })

  it("shows the chosen value's photos, every image for values without photos or with All photos", () => {
    expect(galleryImagesFor(product, { Colour: 'Blue' }, false)).toEqual({ images: [images[2]], filtered: true })
    expect(galleryImagesFor(product, { Colour: 'Blue' }, true)).toEqual({ images, filtered: false })
    expect(galleryImagesFor(product, { Colour: 'Green' }, false)).toEqual({ images, filtered: false })
    // A product without a photo option keeps every image (pre-P1a payloads).
    const plain = productDetail()
    expect(galleryImagesFor(plain, { Colour: 'Red' }, false).images).toBe(plain.images)
  })

  it("takes a chip photo from the value's image, else its first photo", () => {
    const [red, blue, green] = product.options[0]!.values
    expect(chipImageOf(product, red!)).toEqual({ url: '/r1.png', alt: 'Red front' })
    expect(chipImageOf(product, blue!)?.url).toBe('/b1.png')
    expect(chipImageOf(product, green!)).toBeNull()
  })

  it('finds the size option by slug or name, in English or Bangla', () => {
    expect(sizeOptionIndex(product.options)).toBe(1)
    expect(sizeOptionIndex([{ name: 'রং', slug: null }, { name: 'সাইজ', slug: null }])).toBe(1)
    expect(sizeOptionIndex([{ name: 'Shoe size', slug: 'shoe-size' }])).toBe(0)
    expect(sizeOptionIndex([{ name: 'Flavour', slug: 'flavour' }])).toBe(-1)
  })
})
