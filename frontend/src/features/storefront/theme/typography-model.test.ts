import { describe, expect, it } from 'vitest'
import type { StoreFont } from '@/features/storefront/api'
import { ApiError } from '@/lib/api/client'
import { automaticBanglaFont, checkFontUpload, effectiveBanglaFont, fontDeleteError, fontGroups, fontName, fontUploadError, usageText } from './typography-model'

const UUID = '0193ab12-cd34-7000-8000-000000000001'
const font: StoreFont = {
  id: UUID,
  key: `custom:${UUID}`,
  name: 'Shonar',
  family: 'sf-custom-0193ab12cd34',
  url: '/storage/fonts/org/x.woff2',
  format: 'woff2',
  weight_min: 400,
  weight_max: 700,
  size: 120_000,
  used_by: [],
  roles: [],
  created_at: null,
}

const woff2 = (size = 1000, name = 'shonar.woff2') => new File([new Uint8Array(size)], name, { type: 'font/woff2' })

describe('font pickers', () => {
  it('main pickers offer English fonts, fonts that also write Bangla, then the store’s own', () => {
    const heading = fontGroups('heading', [font])
    expect(heading.map((g) => g.label)).toEqual(['For English', 'For English and Bangla', 'Your fonts'])
    expect(heading[0]!.options.map((o) => o.value)).toEqual(['baloo', 'poppins', 'playfair', 'jost', 'system'])
    expect(heading[1]!.options.map((o) => o.value)).toEqual(['hind-siliguri', 'noto-sans-bengali', 'anek-bangla', 'tiro-bangla', 'baloo-da-2'])
    expect(heading[1]!.options[0]!.hint).toMatch(/writes Bangla too/)
    expect(heading[2]!.options[0]).toMatchObject({ value: `custom:${UUID}`, label: 'Shonar', custom: true })
    expect(heading[2]!.options[0]!.stack).toContain('sf-custom-0193ab12cd34')
    expect(fontGroups('body')[0]!.options.map((o) => o.value)).toEqual(['poppins', 'jost', 'system'])
    expect(fontGroups('bangla_body').map((g) => g.label)).toEqual(['Bangla fonts'])
  })

  it('names fonts in plain words', () => {
    expect(fontName('tiro-bangla')).toBe('Tiro Bangla')
    expect(fontName(`custom:${UUID}`, [font])).toBe('Shonar')
    expect(fontName(`custom:${UUID}`, [])).toMatch(/deleted/)
  })

  it('Automatic Bangla fonts follow a main font that writes Bangla, else Hind Siliguri / Baloo Da 2', () => {
    const latin = { heading_font: 'playfair', body_font: 'poppins' }
    expect(automaticBanglaFont('bangla_heading', latin)).toBe('baloo-da-2')
    expect(automaticBanglaFont('bangla_body', latin)).toBe('hind-siliguri')
    expect(automaticBanglaFont('bangla_body', { heading_font: 'baloo', body_font: 'anek-bangla' })).toBe('anek-bangla')
    expect(effectiveBanglaFont('bangla_body', { ...latin, bangla_body_font: 'tiro-bangla' })).toBe('tiro-bangla')
    // An uploaded font only counts while the store still has it.
    expect(effectiveBanglaFont('bangla_body', { ...latin, bangla_body_font: `custom:${UUID}` }, [font])).toBe(`custom:${UUID}`)
    expect(effectiveBanglaFont('bangla_body', { ...latin, bangla_body_font: `custom:${UUID}` }, [])).toBe('hind-siliguri')
  })
})

describe('uploaded fonts', () => {
  const limits = { count: 1, limit: 4, maxBytes: 512_000 }

  it('checks name, file type and size, weights and the limit before uploading', () => {
    expect(checkFontUpload({ name: 'Shonar 2', file: woff2(), weight_min: 400, weight_max: 700 }, limits, [font])).toEqual({})
    expect(checkFontUpload({ name: ' ', file: null, weight_min: 400, weight_max: 400 }, limits)).toEqual({ name: expect.stringMatching(/Give the font a name/), file: 'Choose a .woff2 font file.' })
    expect(checkFontUpload({ name: 'shonar', file: woff2(10, 'a.ttf'), weight_min: 700, weight_max: 400 }, limits, [font])).toEqual({
      name: 'You already have a font with this name.',
      file: expect.stringMatching(/Only WOFF2/),
      weight_max: expect.stringMatching(/can’t be lighter/),
    })
    expect(checkFontUpload({ name: 'Big', file: woff2(600_000), weight_min: 400, weight_max: 400 }, limits).file).toMatch(/The file is 586 KB; a font can be at most 500 KB/)
    expect(checkFontUpload({ name: 'Five', file: woff2(), weight_min: 400, weight_max: 400 }, { ...limits, count: 4 }).form).toMatch(/You have 4 fonts/)
  })

  it('turns server refusals into plain words', () => {
    expect(fontUploadError(new ApiError(422, 'INVALID_FONT', 'x'))).toEqual({ file: expect.stringMatching(/isn’t a WOFF2 font/) })
    expect(fontUploadError(new ApiError(422, 'FONT_LIMIT_REACHED', 'x', { limit: 4 }))).toEqual({ form: expect.stringMatching(/already has 4 fonts/) })
    expect(fontUploadError(new ApiError(422, 'FONT_DUPLICATE', 'x', { font_id: UUID }))).toEqual({ file: 'This font file is already uploaded.' })
    expect(fontUploadError(new ApiError(422, 'VALIDATION_FAILED', 'x', { name: ['The name has already been taken.'] }))).toEqual({ name: 'The name has already been taken.' })
    expect(fontDeleteError(new ApiError(409, 'FONT_IN_USE', 'x', { used_by: ['theme_draft'], roles: ['heading', 'bangla_body'] }))).toBe('Used for headings and Bangla text (draft). Choose another font there first, then delete it.')
  })

  it('says where a font is used', () => {
    expect(usageText(font)).toBeNull()
    expect(usageText({ used_by: ['live_theme', 'theme_draft'], roles: ['body'] })).toBe('Used for body text (live store and draft)')
    expect(usageText({ used_by: ['live_theme'], roles: ['heading', 'body', 'bangla_heading'] })).toBe('Used for headings, body text and Bangla headings (live store)')
  })
})
