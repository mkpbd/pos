import { describe, expect, it, vi } from 'vitest'
import { applyListingError, listingFormSchema, newBadge, toListingFormValues, toListingInput, type ListingFormValues } from '@/features/online-catalog/listing-form'
import { moveItem } from '@/features/online-catalog/move'
import { webStatus } from '@/features/online-catalog/taxonomy-form'
import { listingResponse } from '@/features/online-catalog/test-data'
import { ApiError } from '@/lib/api/client'

vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: vi.fn(), success: vi.fn() }) }
})

describe('online listing form', () => {
  it('maps the API document to form values and back without losing anything', () => {
    const values = toListingFormValues(listingResponse({ translations: { bn: { name: 'আমের জুস', seo_title: null } } }))
    expect(values.translations.bn).toEqual({ name: 'আমের জুস', short_description: '', description_html: '', seo_title: '', seo_description: '' })
    expect(values.variants).toEqual([
      { variant_id: 'v-1', selling_price: '120.00', compare_at_price: '', image_id: null },
      { variant_id: 'v-2', selling_price: '150.00', compare_at_price: '180.00', image_id: 'img-2' },
    ])

    const { listing, related } = toListingInput({ ...values, seo_title: '  ', short_description: ' Fresh. ', translations: { bn: { ...values.translations.bn, short_description: ' তাজা। ' } } })
    expect(listing).toEqual({
      slug: 'mango-juice', is_published: true, published_at: null, unpublished_at: null, is_featured: false, is_new_until: null,
      short_description: 'Fresh.', description_html: '<p>Sweet</p>', specifications: [{ label: 'Volume', value: '1 litre' }], seo_title: null, seo_description: null,
      sort_weight: 0,
      variants: [{ variant_id: 'v-1', compare_at_price: null, image_id: null }, { variant_id: 'v-2', compare_at_price: '180.00', image_id: 'img-2' }],
      // Every translatable field is sent; "" removes a translation.
      translations: { bn: { name: 'আমের জুস', short_description: 'তাজা।', description_html: '', seo_title: '', seo_description: '' } },
    })
    expect(related).toEqual({ related: ['p-9'], frequently_bought: [] })
  })

  it('omits an empty slug so the server suggests one', () => {
    const values = { ...toListingFormValues(listingResponse()), slug: '' }
    expect(toListingInput(values).listing).not.toHaveProperty('slug')
  })

  it('rejects a compare-at price that is not above the selling price and a schedule that ends first', () => {
    const values: ListingFormValues = {
      ...toListingFormValues(listingResponse()),
      published_at: '2026-11-02T10:00',
      unpublished_at: '2026-11-01T10:00',
    }
    values.variants[0]!.compare_at_price = '120'
    const result = listingFormSchema.safeParse(values)
    expect(result.success).toBe(false)
    const paths = result.error?.issues.map((i) => i.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['unpublished_at', 'variants.0.compare_at_price']))
  })

  it('rejects bad slugs and too many characters in SEO fields', () => {
    const values = { ...toListingFormValues(listingResponse()), slug: 'Mango Juice', seo_title: 'x'.repeat(71) }
    const paths = listingFormSchema.safeParse(values).error?.issues.map((i) => i.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['slug', 'seo_title']))
  })

  it('P1b: maps the video and badges both ways only when the API offers them', () => {
    // Not offered (older API): nothing is added to the form or the request.
    const plain = toListingFormValues(listingResponse())
    expect(plain).not.toHaveProperty('video_url')
    expect(plain).not.toHaveProperty('badges')
    expect(toListingInput(plain).listing).not.toHaveProperty('video_url')
    expect(toListingInput(plain).listing).not.toHaveProperty('badges')

    const values = toListingFormValues(listingResponse({
      video_url: null,
      badges: [
        { text: 'Handmade', tone: 'dark', translations: { bn: { text: 'হাতে তৈরি' } } },
        { text: 'Gift', tone: 'mystery' as never, translations: { bn: {} } },
      ],
    }))
    expect(values.video_url).toBe('')
    expect(values.badges).toEqual([
      { text: 'Handmade', tone: 'dark', translations: { bn: { text: 'হাতে তৈরি' } } },
      // An unknown tone from a newer server reads as info.
      { text: 'Gift', tone: 'info', translations: { bn: { text: '' } } },
    ])

    const { listing } = toListingInput({ ...values, video_url: ' https://youtu.be/dQw4w9WgXcQ ', badges: [{ text: ' Free gift ', tone: 'sale', translations: { bn: { text: ' উপহার ' } } }] })
    expect(listing.video_url).toBe('https://youtu.be/dQw4w9WgXcQ')
    expect(listing.badges).toEqual([{ text: 'Free gift', tone: 'sale', translations: { bn: { text: 'উপহার' } } }])
    // An emptied link removes the video; no badges clears them.
    expect(toListingInput({ ...values, video_url: '  ', badges: [] }).listing).toMatchObject({ video_url: null, badges: [] })
  })

  it('P1b: accepts only YouTube and Vimeo links and short badge texts', () => {
    const base = toListingFormValues(listingResponse({ video_url: null, badges: [] }))
    const paths = (patch: Partial<ListingFormValues>) => listingFormSchema.safeParse({ ...base, ...patch }).error?.issues.map((i) => i.path.join('.')) ?? []

    for (const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://vimeo.com/76979871', '']) {
      expect(paths({ video_url: url })).toEqual([])
    }
    for (const url of ['https://example.com/clip.mp4', 'youtube.com/watch?v=dQw4w9WgXcQ', 'https://vimeo.com/channels/staff']) {
      expect(paths({ video_url: url })).toEqual(['video_url'])
    }
    expect(paths({ badges: [{ text: ' ', tone: 'new', translations: { bn: { text: '' } } }] })).toEqual(['badges.0.text'])
    expect(paths({ badges: [{ text: 'x'.repeat(25), tone: 'new', translations: { bn: { text: 'ক'.repeat(25) } } }] })).toEqual(['badges.0.text', 'badges.0.translations.bn.text'])
    const badge = { text: 'A', tone: 'new' as const, translations: { bn: { text: '' } } }
    expect(paths({ badges: [badge, badge, badge] })).toEqual(['badges'])
  })

  it('P1b: a new badge takes the first colour the product does not use yet', () => {
    expect(newBadge([]).tone).toBe('info')
    expect(newBadge([{ tone: 'info' }]).tone).toBe('dark')
    expect(newBadge([{ tone: 'info' }, { tone: 'dark' }]).tone).toBe('sale')
  })

  it('puts business errors on the right field', () => {
    const setError = vi.fn()
    applyListingError(new ApiError(422, 'COMPARE_AT_NOT_ABOVE_PRICE', 'Must be above 150.00.', { variant_id: 'v-2' }), setError, ['v-1', 'v-2'])
    expect(setError).toHaveBeenLastCalledWith('variants.1.compare_at_price', { type: 'server', message: 'Must be above 150.00.' })

    applyListingError(new ApiError(422, 'PRODUCT_NOT_SELLABLE', 'Archived products cannot be published.'), setError, [])
    expect(setError).toHaveBeenLastCalledWith('is_published', { type: 'server', message: 'Archived products cannot be published.' })

    applyListingError(new ApiError(422, 'VALIDATION_FAILED', 'Invalid.', { 'specifications.0.label': ['Too long.'] }), setError, [])
    expect(setError).toHaveBeenLastCalledWith('specifications.0.label', { type: 'server', message: 'Too long.' })

    // P1b keys land on their rows.
    applyListingError(new ApiError(422, 'VALIDATION_FAILED', 'Invalid.', { video_url: ['Not a video.'], 'badges.1.tone': ['Pick a colour.'] }), setError, [])
    expect(setError).toHaveBeenCalledWith('video_url', { type: 'server', message: 'Not a video.' })
    expect(setError).toHaveBeenLastCalledWith('badges.1.tone', { type: 'server', message: 'Pick a colour.' })
  })
})

describe('helpers', () => {
  it('moves items within bounds', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
  })

  it('derives the web status of a category or brand', () => {
    expect(webStatus({ is_active: true, listing: null }).label).toBe('Not listed')
    expect(webStatus({ is_active: true, listing: { slug: 'a', is_visible: false } }).label).toBe('Hidden')
    expect(webStatus({ is_active: false, listing: { slug: 'a', is_visible: true } }).label).toBe('Inactive')
    expect(webStatus({ is_active: true, listing: { slug: 'a', is_visible: true } }).label).toBe('Visible')
  })
})
