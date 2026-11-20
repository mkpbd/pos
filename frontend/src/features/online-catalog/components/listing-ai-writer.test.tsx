import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import type { BrandListingResponse, WebBrandRow } from '@/features/online-catalog/api'
import { asHtml, describeAiWriteError, htmlLines, isBlank, listingAiOn, normalizeAnswer } from '@/features/online-catalog/ai-writer'
import { listingResponse } from '@/features/online-catalog/test-data'
import { ApiError } from '@/lib/api/client'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

vi.mock('@/features/content/components/rich-text-editor', () => ({
  RichTextEditor: ({ id, label, value, onChange }: { id?: string; label: string; value: string; onChange: (html: string) => void }) => (
    <textarea id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const MANAGER = ['storefront.view', 'storefront.manage', 'online_catalog.view', 'online_catalog.manage', 'media.manage', 'products.view']
const staff = ({ ai = true, permissions = MANAGER }: { ai?: boolean; permissions?: string[] } = {}) => makeCurrentUser({ permissions, ai_enabled: ai })
const body = (init: RequestInit) => JSON.parse(String(init.body)) as Record<string, unknown>

const answer = {
  subject: 'product',
  id: 'p-1',
  suggestions: {
    en: { short_description: 'Cold-pressed mango juice from Rajshahi.', description: '<p>Made from ripe mangoes.</p><ul><li>No added sugar</li><li>1 litre bottle</li></ul>' },
    bn: { short_description: 'রাজশাহীর আমের জুস।', description: '<p>পাকা আম থেকে তৈরি।</p>' },
  },
  missing_info: ['storage instructions', 'shelf life'],
  current: { en: { short_description: 'Fresh.', description: '<p>Sweet</p>' }, bn: { short_description: null, description: null } },
}

describe('Write with AI on the product listing', () => {
  it('writes, shows current next to suggested, fills the form in one change and undoes it', async () => {
    const user = userEvent.setup()
    const requests: Record<string, unknown>[] = []
    let saved: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(staff()),
      'GET /online-catalog/products/p-1': ok(listingResponse()),
      'POST /online-catalog/ai/write': (init) => {
        requests.push(body(init))
        return ok(answer)
      },
      'PUT /online-catalog/products/p-1': (init) => {
        saved = body(init)
        return ok(listingResponse())
      },
      'PUT /online-catalog/products/p-1/related': ok({ related: [], frequently_bought: [] }),
    })
    renderRoutes(routes, '/products/p-1/online-store')

    const opener = await screen.findByRole('button', { name: 'Write with AI: descriptions' })
    expect(screen.getByRole('button', { name: 'Write with AI: search engine texts' })).toBeInTheDocument()
    await user.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Write with AI' })
    expect(dialog).toHaveAccessibleDescription(/nothing is saved until you save the listing/)
    // The block's texts are ticked; the SEO ones are not.
    expect(within(dialog).getByRole('checkbox', { name: 'Short description' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Web description' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'SEO title' })).not.toBeChecked()
    await user.click(within(dialog).getByRole('radio', { name: 'Both' }))
    await user.click(within(dialog).getByRole('radio', { name: 'Festive' }))
    expect(within(dialog).getByText(/Eid, Puja/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: 'Short' }))
    await user.type(within(dialog).getByLabelText('Notes for the AI'), '  Made in Rajshahi ')
    await user.click(within(dialog).getByRole('button', { name: 'Write' }))

    const review = await within(dialog).findByTestId('listing-ai-review')
    expect(requests[0]).toEqual({ subject: 'product', id: 'p-1', fields: ['short_description', 'description'], languages: ['en', 'bn'], tone: 'festive', length: 'short', notes: 'Made in Rajshahi' })
    expect(within(review).getByText('4 suggestions. Tick the ones to use; empty fields are ticked for you.')).toBeInTheDocument()
    // Filled English fields start unticked; the empty Bangla ones ticked.
    const english = within(review).getByRole('region', { name: 'English' })
    expect(within(english).getByRole('checkbox', { name: 'Use for Short description (English)' })).not.toBeChecked()
    expect(within(english).getByText('Fresh.')).toBeInTheDocument()
    expect(within(english).getByText('• No added sugar')).toBeInTheDocument()
    const bangla = within(review).getByRole('region', { name: 'বাংলা (Bangla)' })
    expect(within(bangla).getByRole('checkbox', { name: 'Use for Short description (Bangla)' })).toBeChecked()
    expect(within(bangla).getByRole('checkbox', { name: 'Use for Web description (Bangla)' })).toBeChecked()
    expect(within(bangla).getAllByText('Empty')).toHaveLength(2)
    const missing = within(review).getByRole('region', { name: 'Things to add' })
    expect(within(missing).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['storage instructions', 'shelf life'])

    await user.click(within(english).getByRole('checkbox', { name: 'Use for Short description (English)' }))
    await user.click(within(bangla).getByRole('checkbox', { name: 'Use for Web description (Bangla)' }))
    await user.click(within(dialog).getByRole('button', { name: 'Use selected (2)' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
    const form = screen.getByRole('form', { name: 'Online listing' })
    expect(within(form).getByLabelText('Short description')).toHaveValue('Cold-pressed mango juice from Rajshahi.')
    expect(within(form).getByLabelText('Web description')).toHaveValue('<p>Sweet</p>')
    // The Bangla section opens with the AI's text.
    expect(within(form).getByLabelText('Short description in Bangla')).toHaveValue('রাজশাহীর আমের জুস।')
    expect(within(form).getByTestId('ai-writer-applied')).toHaveTextContent('AI texts added to 2 fields. Not saved yet: check them, then save the listing.')

    await user.click(within(form).getByRole('button', { name: 'Undo' }))
    expect(within(form).getByLabelText('Short description')).toHaveValue('Fresh.')
    expect(within(form).getByLabelText('Short description in Bangla')).toHaveValue('')
    expect(within(form).getByText('Undone. The earlier texts are back.')).toBeInTheDocument()
    expect(saved).toBeUndefined()

    // Write again (SEO block) and save: the AI texts go out with the normal listing save.
    mockApi({
      'GET /auth/me': ok(staff()),
      'GET /online-catalog/products/p-1': ok(listingResponse()),
      'POST /online-catalog/ai/write': (init) => {
        requests.push(body(init))
        return ok({ suggestions: { en: { seo_title: 'Mango juice 1L | Corner Shop', seo_description: 'Cold-pressed mango juice.' } }, missing_info: [], current: {} })
      },
      'PUT /online-catalog/products/p-1': (init) => {
        saved = body(init)
        return ok(listingResponse({ seo_title: 'Mango juice 1L | Corner Shop', seo_description: 'Cold-pressed mango juice.' }))
      },
      'PUT /online-catalog/products/p-1/related': ok({ related: [], frequently_bought: [] }),
    })
    await user.click(screen.getByRole('button', { name: 'Write with AI: search engine texts' }))
    const seoDialog = await screen.findByRole('dialog', { name: 'Write with AI' })
    await user.click(within(seoDialog).getByRole('button', { name: 'Write' }))
    expect(await within(seoDialog).findByText('28/70 characters')).toBeInTheDocument()
    expect(requests[1]).toMatchObject({ fields: ['seo_title', 'seo_description'], languages: ['en'], tone: 'friendly', length: 'medium' })
    expect(requests[1]).not.toHaveProperty('notes')
    await user.click(within(seoDialog).getByRole('button', { name: 'Use selected (2)' }))
    await user.click(screen.getByRole('button', { name: 'Save online listing' }))
    await waitFor(() => expect(saved).toMatchObject({ seo_title: 'Mango juice 1L | Corner Shop', seo_description: 'Cold-pressed mango juice.' }))
    // Saved: the "not saved yet" note goes away.
    await waitFor(() => expect(screen.queryByTestId('ai-writer-applied')).not.toBeInTheDocument())
  })

  it('is not offered when AI is off or without online_catalog.manage', async () => {
    mockApi({ 'GET /auth/me': ok(staff({ ai: false })), 'GET /online-catalog/products/p-1': ok(listingResponse()) })
    const { unmount } = renderRoutes(routes, '/products/p-1/online-store')
    expect(await screen.findByRole('button', { name: 'Save online listing' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Write with AI/ })).not.toBeInTheDocument()
    unmount()

    mockApi({ 'GET /auth/me': ok(makeCurrentUser({ permissions: MANAGER })), 'GET /online-catalog/products/p-1': ok(listingResponse()) })
    const second = renderRoutes(routes, '/products/p-1/online-store')
    expect(await screen.findByRole('button', { name: 'Save online listing' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Write with AI/ })).not.toBeInTheDocument()
    second.unmount()

    mockApi({ 'GET /auth/me': ok(staff({ permissions: ['online_catalog.view', 'products.view'] })), 'GET /online-catalog/products/p-1': ok(listingResponse()) })
    renderRoutes(routes, '/products/p-1/online-store')
    expect(await screen.findByRole('form', { name: 'Online listing' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Write with AI/ })).not.toBeInTheDocument()
  })

  it('explains errors in plain words and offers Try again only when it can help', async () => {
    const user = userEvent.setup()
    let reason = 'budget_exceeded'
    mockApi({
      'GET /auth/me': ok(staff()),
      'GET /online-catalog/products/p-1': ok(listingResponse()),
      'POST /online-catalog/ai/write': () => fail(422, 'AI_UNAVAILABLE', 'AI is not available.', { reason }),
    })
    renderRoutes(routes, '/products/p-1/online-store')
    await user.click(await screen.findByRole('button', { name: 'Write with AI: descriptions' }))
    let dialog = await screen.findByRole('dialog', { name: 'Write with AI' })
    await user.click(within(dialog).getByRole('button', { name: 'Write' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('AI allowance used up')
    expect(alert).toHaveTextContent('Organization → AI')
    expect(within(dialog).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    reason = 'refused'
    await user.click(screen.getByRole('button', { name: 'Write with AI: descriptions' }))
    dialog = await screen.findByRole('dialog', { name: 'Write with AI' })
    await user.click(within(dialog).getByRole('button', { name: 'Write' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The AI wouldn’t write this')
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }))
    expect(within(dialog).getByLabelText('Notes for the AI')).toBeInTheDocument()
  })

  it('cannot write with no text chosen', async () => {
    const user = userEvent.setup()
    mockApi({ 'GET /auth/me': ok(staff()), 'GET /online-catalog/products/p-1': ok(listingResponse()) })
    renderRoutes(routes, '/products/p-1/online-store')
    await user.click(await screen.findByRole('button', { name: 'Write with AI: descriptions' }))
    const dialog = await screen.findByRole('dialog', { name: 'Write with AI' })
    await user.click(within(dialog).getByRole('checkbox', { name: 'Short description' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Web description' }))
    expect(within(dialog).getByRole('button', { name: 'Write' })).toBeDisabled()
  })
})

describe('Write with AI on the brand listing', () => {
  it('fills the plain-text description and SEO texts in the listing dialog', async () => {
    const user = userEvent.setup()
    const brands: WebBrandRow[] = [{ id: 'b-1', name: 'Pran', is_active: true, listing: null }]
    const pran: BrandListingResponse = {
      brand: { id: 'b-1', name: 'Pran', is_active: true },
      listing: { exists: false, slug: 'pran', is_visible: true, logo_media_id: null, description: null, seo_title: 'Pran', seo_description: null },
      url: '/brand/pran',
    }
    let request: Record<string, unknown> | undefined
    let saved: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(staff()),
      'GET /online-catalog/brands': ok(brands),
      'GET /online-catalog/brands/b-1': ok(pran),
      'POST /online-catalog/ai/write': (init) => {
        request = body(init)
        return ok({ subject: 'brand', id: 'b-1', suggestions: { en: { description: 'Pran makes juices and snacks.\n\nSold all over Bangladesh.', seo_title: 'Pran juices and snacks', seo_description: 'Shop Pran.' } }, missing_info: [], current: {} })
      },
      'PUT /online-catalog/brands/b-1': (init) => {
        saved = body(init)
        return ok({ ...pran, listing: { ...pran.listing, exists: true } })
      },
    })
    renderRoutes(routes, '/storefront/brands')

    await user.click(await screen.findByRole('button', { name: 'Edit web listing of Pran' }))
    const listing = await screen.findByRole('dialog', { name: 'Web listing: Pran' })
    await user.click(within(listing).getByRole('button', { name: 'Write with AI' }))
    const dialog = await screen.findByRole('dialog', { name: 'Write with AI' })
    expect(within(dialog).getAllByRole('checkbox').filter((c) => c.getAttribute('aria-checked') === 'true')).toHaveLength(3)
    await user.click(within(dialog).getByRole('button', { name: 'Write' }))
    await within(dialog).findByTestId('listing-ai-review')
    expect(request).toMatchObject({ subject: 'brand', id: 'b-1', fields: ['description', 'seo_title', 'seo_description'] })
    // The SEO title already has a text: unticked; the counters show both lengths.
    expect(within(dialog).getByRole('checkbox', { name: 'Use for SEO title (English)' })).not.toBeChecked()
    expect(within(dialog).getByText('4/70 characters')).toBeInTheDocument()
    expect(within(dialog).getByText('22/70 characters')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Use selected (2)' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Write with AI' })).not.toBeInTheDocument())

    expect(within(listing).getByLabelText('Description')).toHaveValue('Pran makes juices and snacks.\n\nSold all over Bangladesh.')
    expect(within(listing).getByLabelText('SEO title')).toHaveValue('Pran')
    await user.click(within(listing).getByRole('button', { name: 'Save listing' }))
    await waitFor(() => expect(saved).toMatchObject({ description: 'Pran makes juices and snacks.\n\nSold all over Bangladesh.', seo_title: 'Pran', seo_description: 'Shop Pran.' }))
  })
})

describe('listing AI writer helpers', () => {
  it('reads the answer leniently', () => {
    const input = { fields: ['description', 'seo_title'] as const, languages: ['en', 'bn'] as const }
    expect(
      normalizeAnswer(
        { suggestions: { en: { description_html: '<p>Hi</p>', seo_title: '  ', extra: 'x' }, bn: 'oops', de: { seo_title: 'x' } }, missing_info: ['a', 3, ' b ', 'c', 'd', 'e', 'f'] },
        { fields: [...input.fields], languages: [...input.languages] },
      ),
    ).toEqual({ suggestions: { en: { description: '<p>Hi</p>' } }, missingInfo: ['a', 'b', 'c', 'd', 'e'] })
    expect(normalizeAnswer(null, { fields: ['seo_title'], languages: ['en'] })).toEqual({ suggestions: {}, missingInfo: [] })
  })

  it('turns plain text into safe paragraphs and HTML into review lines', () => {
    expect(asHtml('One <b>\nline\n\nTwo')).toBe('<p>One &lt;b&gt;<br>line</p><p>Two</p>')
    expect(asHtml('<p>Kept</p>')).toBe('<p>Kept</p>')
    expect(htmlLines('<p>A</p><ul><li>B</li><li> C </li></ul>')).toEqual(['A', '• B', '• C'])
    expect(isBlank('<p></p>', true)).toBe(true)
    expect(isBlank(' ', false)).toBe(true)
    expect(isBlank('x', false)).toBe(false)
  })

  it('needs ai_enabled to be true', () => {
    expect(listingAiOn(makeCurrentUser({ ai_enabled: true }))).toBe(true)
    expect(listingAiOn(makeCurrentUser({ ai_enabled: false }))).toBe(false)
    expect(listingAiOn(makeCurrentUser())).toBe(false)
    expect(listingAiOn(null)).toBe(false)
  })

  it('names every reason in plain words', () => {
    const err = (reason: string) => describeAiWriteError(new ApiError(422, 'AI_UNAVAILABLE', 'x', { reason }))
    expect(err('disabled')).toMatchObject({ title: 'AI writing is off', final: true })
    expect(err('budget_exceeded').final).toBe(true)
    for (const reason of ['unavailable', 'refused', 'empty', 'invalid']) expect(err(reason).final).toBe(false)
    expect(describeAiWriteError(new ApiError(422, 'NOTHING_TO_WRITE', 'x')).title).toBe('Nothing to write')
    expect(describeAiWriteError(new ApiError(429, 'TOO_MANY_REQUESTS', 'x')).title).toBe('Too many requests')
    expect(describeAiWriteError(new ApiError(404, 'NOT_FOUND', 'x')).final).toBe(true)
    expect(describeAiWriteError(new Error('offline')).final).toBe(false)
  })
})
