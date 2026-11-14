import { useState } from 'react'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { mockApi, ok, renderWithQuery } from '@/test/utils'
import { Inspector, withSeo, type BuilderContent, type ElementsMetadata, type InspectorCommand, type InspectorProps } from './index'
import { breadcrumb, hasSeo, readSeo, storeDomain, toSeo, truncate } from './seo-panel-model'

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }
const UUID = '0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab'
const EMPTY: BuilderContent = { schema_version: 1, sections: [] }

function setup(options: { content?: BuilderContent; locales?: string[]; kind?: InspectorProps['document']['kind']; key?: string; path?: string | null; errors?: InspectorProps['errors'] } = {}) {
  const commands: InspectorCommand[] = []
  const contents: BuilderContent[] = []
  function Harness() {
    const [content, setContent] = useState<BuilderContent>(options.content ?? EMPTY)
    return (
      <Inspector
        content={content}
        node={null}
        document={{ id: 'd-1', kind: options.kind ?? 'page', key: options.key ?? 'landing:eid-sale', title: 'Eid sale', path: options.path === undefined ? '/p/eid-sale' : options.path, published: null, storeUrl: 'https://www.mango-shop.com.bd' }}
        registry={registry}
        locales={options.locales ?? ['en']}
        errors={options.errors ?? []}
        onChange={vi.fn()}
        onCommand={(cmd) => {
          commands.push(cmd)
          if (cmd.type === 'set-seo') {
            setContent((c) => {
              const next = withSeo(c, cmd.seo)
              contents.push(next)
              return next
            })
          }
        }}
      />
    )
  }
  const user = userEvent.setup()
  renderWithQuery(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  )
  return { user, commands, last: () => contents.at(-1) }
}

describe('Search & sharing model', () => {
  it('reads and writes the server shape: blank texts null, translations always present, nothing set = no seo', () => {
    expect(readSeo({})).toEqual({ title: '', description: '', image: null, noindex: false, bnTitle: '', bnDescription: '' })
    expect(toSeo(readSeo({}))).toBeNull()
    expect(toSeo({ title: 'Eid', description: '  ', image: UUID, noindex: true, bnTitle: 'ঈদ', bnDescription: '' })).toEqual({
      title: 'Eid', description: null, image: { media_id: UUID }, noindex: true, translations: { bn: { title: 'ঈদ' } },
    })
    expect(toSeo({ ...readSeo({}), noindex: true })).toEqual({ title: null, description: null, image: null, noindex: true, translations: {} })
    const seo = { title: 'T', description: null, image: null, noindex: false, translations: { bn: { description: 'বিবরণ' } } }
    expect(readSeo({ seo })).toMatchObject({ title: 'T', description: '', bnDescription: 'বিবরণ' })
  })

  it('withSeo sets seo after schema_version, removes it on null and keeps the same object when nothing changes', () => {
    const seo = toSeo({ title: 'A', description: '', image: null, noindex: false, bnTitle: '', bnDescription: '' })
    const next = withSeo(EMPTY, seo)
    expect(Object.keys(next)).toEqual(['schema_version', 'seo', 'sections'])
    expect(withSeo(next, { ...seo })).toBe(next)
    expect(withSeo(next, { ...seo, title: 'B' })).toEqual({ schema_version: 1, seo: { ...seo, title: 'B' }, sections: [] })
    expect(withSeo(next, null)).toEqual(EMPTY)
    expect(withSeo(EMPTY, null)).toBe(EMPTY)
  })

  it('previews: domain, address line, Google-like truncation; only pages and CMS designs have SEO', () => {
    expect(storeDomain('https://www.mango-shop.com.bd/')).toBe('mango-shop.com.bd')
    expect(storeDomain(null)).toBe('your-shop.com')
    expect(breadcrumb('shop.com', '/p/eid-sale')).toBe('shop.com › p › eid-sale')
    expect(breadcrumb('shop.com', '/')).toBe('shop.com')
    expect(truncate('short', 60)).toBe('short')
    const cut = truncate('Fresh mangoes from Rajshahi delivered to your door every morning in Dhaka', 40)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.length).toBeLessThanOrEqual(41)
    expect(hasSeo({ kind: 'page', key: 'home' })).toBe(true)
    expect(hasSeo({ kind: 'page', key: 'landing:x' })).toBe(true)
    expect(hasSeo({ kind: 'page', key: 'cms:abc' })).toBe(true)
    for (const kind of ['header', 'footer', 'zone', 'popup'] as const) expect(hasSeo({ kind, key: 'x' })).toBe(false)
  })
})

describe('Page settings → Search & sharing', () => {
  it('edits the title and description with counters; the Google and social previews follow live', async () => {
    const { user, commands, last } = setup()
    const panel = screen.getByTestId('seo-panel')
    expect(within(panel).getByRole('heading', { name: 'Search & sharing' })).toBeInTheDocument()
    // Empty: the page title shows in the previews.
    expect(screen.getByTestId('seo-google-title')).toHaveTextContent('Eid sale')
    expect(within(screen.getByTestId('seo-google-preview')).getByText('mango-shop.com.bd › p › eid-sale')).toBeInTheDocument()
    expect(within(screen.getByTestId('seo-social-preview')).getByText('mango-shop.com.bd')).toBeInTheDocument()

    const title = within(panel).getByLabelText('Title')
    expect(title).toHaveAttribute('maxlength', '70')
    await user.type(title, 'Eid Mubarak sale')
    expect(last()?.seo).toEqual({ title: 'Eid Mubarak sale', description: null, image: null, noindex: false, translations: {} })
    expect(commands.filter((c) => c.type === 'set-seo').every((c) => c.type === 'set-seo' && c.coalesceKey === 'seo:title')).toBe(true)
    expect(screen.getByTestId('seo-google-title')).toHaveTextContent('Eid Mubarak sale')
    expect(screen.getByTestId('seo-social-title')).toHaveTextContent('Eid Mubarak sale')
    expect(within(panel).getAllByTestId('seo-counter')[0]).toHaveTextContent('16/70')

    const long = 'Panjabis, sarees and sweets for Eid with free delivery in Dhaka. Order before the 25th of Ramadan and pay cash on delivery anywhere in the country, no advance needed.'
    await user.type(within(panel).getByLabelText('Description'), long)
    expect(last()?.seo?.description).toBe(long.slice(0, 160))
    expect(screen.getByTestId('seo-google-description').textContent?.endsWith('…')).toBe(true)
    expect(within(panel).getByText(/Google may cut the end off/)).toBeInTheDocument()

    // Clearing every field removes the settings.
    await user.clear(within(panel).getByLabelText('Title'))
    await user.clear(within(panel).getByLabelText('Description'))
    expect(last()).not.toHaveProperty('seo')
  })

  it('Bangla fields and a Bangla preview when the store has Bangla', async () => {
    const { user, last } = setup({ locales: ['en', 'bn'], content: { ...EMPTY, seo: { title: 'Eid sale', description: null, image: null, noindex: false, translations: {} } } as unknown as BuilderContent })
    const bangla = screen.getByTestId('seo-bangla')
    await user.type(within(bangla).getByLabelText('Title in Bangla'), 'ঈদ সেল')
    expect(last()?.seo?.translations).toEqual({ bn: { title: 'ঈদ সেল' } })
    expect(within(bangla).getByLabelText('Title in Bangla')).toHaveAttribute('lang', 'bn')
    expect(screen.getByTestId('seo-google-title')).toHaveTextContent('Eid sale')
    await user.click(screen.getByRole('radio', { name: 'Bangla' }))
    expect(screen.getByTestId('seo-google-title')).toHaveTextContent('ঈদ সেল')
  })

  it('noindex switch and the chosen picture in the social card', async () => {
    mockApi({ 'GET /media': ok([{ id: UUID, url: '/m/eid.jpg', srcset: '', width: 1200, height: 630, alt: 'Eid', original_name: 'eid.jpg', mime_type: 'image/jpeg', size: 1, created_at: null }], { pagination: { current_page: 1, per_page: 100, total: 1, last_page: 1 } }) })
    const { user, last } = setup({ content: { ...EMPTY, seo: { title: null, description: null, image: { media_id: UUID }, noindex: false, translations: {} } } as unknown as BuilderContent })
    expect(await screen.findByTestId('seo-social-image')).toHaveAttribute('src', '/m/eid.jpg')
    await user.click(screen.getByRole('switch', { name: 'Hide this page from search engines' }))
    expect(last()?.seo).toEqual({ title: null, description: null, image: { media_id: UUID }, noindex: true, translations: {} })
    expect(screen.getByTestId('seo-noindex-note')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(last()?.seo?.image).toBeNull()
    expect(within(screen.getByTestId('seo-social-preview')).getByText(/No picture chosen/)).toBeInTheDocument()
  })

  it('shows server problems on the field', () => {
    setup({ errors: [{ path: 'seo.title', message: 'The title can have at most 70 characters.' }] })
    expect(within(screen.getByTestId('seo-panel')).getByText('The title can have at most 70 characters.')).toBeInTheDocument()
    expect(within(screen.getByTestId('seo-panel')).getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true')
  })

  it('is offered on the home page and CMS designs, not on the header, footer, areas or popups', () => {
    setup({ kind: 'header', key: 'header', path: null })
    expect(screen.queryByTestId('seo-panel')).not.toBeInTheDocument()
  })
})
