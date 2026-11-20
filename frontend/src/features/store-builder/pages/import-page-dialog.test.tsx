import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import type { DocumentSummary } from '../api'
import { keyKindOf, readExportFile, replaceableDocuments, type ExportPreview } from './import-api'
import { IMPORT_WORDS } from './import-words'

/*
 * B16 §4: "Import a page…" on the Pages list — the file is read first (kind, title, shop), then it
 * comes in as a new campaign page or over the draft of a page of the same kind; the answer is a
 * report in plain words. Nothing is published.
 */

const manager = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage'] })
const viewer = () => makeCurrentUser({ permissions: ['storefront.view'] })

const summary = (id: string, kind: DocumentSummary['kind'], key: string, title: string, extra: Partial<DocumentSummary> = {}): DocumentSummary => ({
  id, kind, key, title, schema_version: 1, draft_revision: 7, has_unpublished_changes: false, draft_updated_at: '2026-11-14T08:00:00+00:00', published: null, path: null, preview_url: null, ...extra,
})

const DOCS: DocumentSummary[] = [
  summary('d-home', 'page', 'home', 'Home', { path: '/' }),
  summary('d-eid', 'page', 'landing:eid', 'Eid offers', { path: '/p/eid' }),
  summary('d-header', 'header', 'header', 'Header'),
  summary('d-shop', 'page', 'template:shop', 'Shop page'),
  summary('d-cat', 'page', 'template:category', 'Category page'),
  summary('d-zone', 'zone', 'zone:product.after', 'Below details'),
  summary('d-zone-v', 'zone', 'zone:product.after@category:0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab', 'Below details (Saree)'),
  summary('d-zone-top', 'zone', 'zone:listing.top', 'Above the grid'),
  summary('d-global', 'global', 'global:abc', 'Trust strip', { context: 'page' }),
  summary('d-global-h', 'global', 'global:def', 'Header strip', { context: 'header' }),
]

const copy = (document: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  format: 'pos-builder-page',
  version: 1,
  exported_at: '2026-11-15T10:00:00Z',
  source: { store: 'Green Basket' },
  document: { kind: 'page', key_kind: 'landing', key: 'landing:winter', title: 'Winter sale', schema_version: 1, context: null, content: { sections: [] }, ...document },
  media: [{ ref: 'm1' }, { ref: 'm2' }],
  references: { products: [{ ref: 'p1', sku: 'S-1', slug: 'saree', name: 'Red saree' }] },
  ...extra,
})

const fileOf = (data: unknown, name = 'winter-sale.json') => new File([typeof data === 'string' ? data : JSON.stringify(data)], name, { type: 'application/json' })

const preview = (over: Partial<ExportPreview>): ExportPreview => ({ title: 'x', keyKind: 'landing', key: null, context: null, store: null, exportedAt: null, media: 0, products: 0, ...over })

beforeEach(() => window.localStorage.clear())

describe('page copy files', () => {
  it('reads what a copy holds and refuses other files in plain words', async () => {
    expect(await readExportFile(fileOf(copy({})))).toEqual({
      preview: { title: 'Winter sale', keyKind: 'landing', key: 'landing:winter', context: null, store: 'Green Basket', exportedAt: '2026-11-15T10:00:00Z', media: 2, products: 1 },
    })
    expect(await readExportFile(fileOf('{not json'))).toEqual({ problem: 'notJson' })
    expect(await readExportFile(fileOf({ format: 'something-else', document: {} }))).toEqual({ problem: 'notCopy' })
    expect(await readExportFile(fileOf(copy({}, { version: 2 })))).toEqual({ problem: 'newerVersion' })
    expect(await readExportFile(fileOf(copy({ kind: 'theme', key_kind: 'theme' })))).toEqual({ problem: 'theme' })
    expect(await readExportFile(fileOf(copy({ key_kind: 'spaceship' })))).toEqual({ problem: 'notCopy' })
    const big = fileOf('{}')
    Object.defineProperty(big, 'size', { value: 31 * 1024 * 1024 })
    expect(await readExportFile(big)).toEqual({ problem: 'tooLarge' })
  })

  it('offers only documents of the same kind (same store page, zone and global context) to replace', () => {
    expect(DOCS.map(keyKindOf)).toEqual(['page', 'landing', 'header', 'template', 'template', 'zone', 'zone', 'zone', 'global', 'global'])
    const ids = (p: ExportPreview) => replaceableDocuments(DOCS, p).map((d) => d.id)
    expect(ids(preview({ keyKind: 'landing' }))).toEqual(['d-eid'])
    expect(ids(preview({ keyKind: 'page' }))).toEqual(['d-home'])
    expect(ids(preview({ keyKind: 'template', key: 'template:shop' }))).toEqual(['d-shop'])
    expect(ids(preview({ keyKind: 'zone', key: 'zone:product.after@product:0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab' }))).toEqual(['d-zone', 'd-zone-v'])
    expect(ids(preview({ keyKind: 'global', context: 'header' }))).toEqual(['d-global-h'])
    expect(ids(preview({ keyKind: 'popup' }))).toEqual([])
  })

  it('has every word in Bangla too', () => {
    expect(Object.keys(IMPORT_WORDS.bn).sort()).toEqual(Object.keys(IMPORT_WORDS.en).sort())
  })
})

type Sent = Record<string, FormDataEntryValue>

function mockScreen(reply: (form: FormData) => ReturnType<typeof ok>) {
  const sent: Sent[] = []
  mockApi({
    'GET /auth/me': ok(manager()),
    'GET /storefront/builder/documents': ok(DOCS),
    'POST /storefront/builder/import': (init) => {
      const form = init.body as FormData
      sent.push(Object.fromEntries(form.entries()))
      return reply(form)
    },
    'GET /storefront/builder/documents/d-new': ok({ ...summary('d-new', 'page', 'landing:winter-sale', 'Winter sale'), content: { schema_version: 1, sections: [] } }),
    'GET /storefront/builder/elements': ok({ types: [], limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: {}, store_url: null, locales: ['en'] }),
  })
  return sent
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Import a page…' }))
  return screen.findByRole('dialog', { name: 'Import a page' })
}

describe('Import a page…', () => {
  it('imports a copy as a new campaign page and reports what came over, then opens the editor', async () => {
    const user = userEvent.setup()
    const sent = mockScreen(() => ({
      status: 201,
      ...ok({
        created_document: summary('d-new', 'page', 'landing:winter-sale', 'Winter sale', { path: '/p/winter-sale' }),
        mapped: { media: 2, products: 3, categories: 1, brands: 0, banners: 0, menus: 0, blog_categories: 0, promotions: 0 },
        missing: [{ type: 'product', name: 'Blue saree' }, { type: 'brand', name: 'Aarong' }, { type: 'promotion', name: null }],
        dropped_elements: [{ type: 'campaign_timer', count: 2 }, { type: 'heading', count: 0 }],
      }),
    }))
    const { router } = renderRoutes(routes, '/storefront/pages')
    const dialog = await openDialog(user)
    // Without a file nothing is sent.
    await user.click(within(dialog).getByRole('button', { name: 'Import' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose a file first.')
    expect(sent).toEqual([])

    await user.upload(within(dialog).getByLabelText('Page copy file (.json)'), fileOf(copy({})))
    const fileSummary = await within(dialog).findByTestId('import-file-summary')
    expect(fileSummary).toHaveTextContent('Campaign page: “Winter sale”')
    expect(fileSummary).toHaveTextContent('From Green Basket')
    expect(fileSummary).toHaveTextContent('2 pictures · 1 product')
    expect(within(dialog).getByRole('radio', { name: /As a new campaign page/ })).toBeChecked()
    expect(within(dialog).getByLabelText('Page name')).toHaveValue('Winter sale')
    expect(within(dialog).getByText('/p/winter-sale')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Import' }))
    const report = await within(dialog).findByTestId('import-report')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.file).toBeInstanceOf(File)
    expect({ ...sent[0], file: undefined }).toEqual({ file: undefined, target: 'new', title: 'Winter sale', key: 'landing:winter-sale' })
    expect(within(report).getByRole('status')).toHaveTextContent('“Winter sale” is ready as a draft')
    expect(within(report).getByRole('status')).toHaveTextContent('Nothing is published.')
    expect(within(report).getByTestId('import-mapped').textContent).toBe(
      ['2 pictures, in your media library', '3 products found in this shop', '1 category found'].join(''),
    )
    expect(within(report).getByTestId('import-missing')).toHaveTextContent('Product: Blue saree')
    expect(within(report).getByTestId('import-missing')).toHaveTextContent('Brand: Aarong')
    expect(within(report).getByTestId('import-missing')).toHaveTextContent('Promotion: (no name)')
    const dropped = within(report).getByTestId('import-dropped')
    expect(within(dropped).getAllByRole('listitem')).toHaveLength(1)
    expect(dropped).toHaveTextContent(/× 2/)

    await user.click(within(report).getByRole('button', { name: 'Open in the editor' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/storefront/builder/d-new'))
  })

  it('replaces the draft of a page of the same kind with its revision; a header copy cannot become a new page', async () => {
    const user = userEvent.setup()
    let answer: 'conflict' | 'locked' | 'ok' = 'conflict'
    const sent = mockScreen(() => {
      if (answer === 'conflict') return fail(409, 'DRAFT_CONFLICT', 'Stale')
      if (answer === 'locked') return fail(423, 'DOCUMENT_LOCKED', 'Locked', { user: { id: 'u-2', name: 'Rima' } })
      return ok({ created_document: summary('d-header', 'header', 'header', 'Header'), mapped: {}, missing: [], dropped_elements: [] })
    })
    renderRoutes(routes, '/storefront/pages')
    const dialog = await openDialog(user)
    await user.upload(within(dialog).getByLabelText('Page copy file (.json)'), fileOf(copy({ kind: 'header', key_kind: 'header', key: 'header', title: 'Header' })))
    expect(await within(dialog).findByRole('radio', { name: /As a new campaign page/ })).toBeDisabled()
    expect(within(dialog).getByRole('radio', { name: /Over the draft of a page you have/ })).toBeChecked()
    expect(within(dialog).queryByLabelText('Page name')).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'Import' }))
    expect(within(dialog).getByText('Choose the page whose draft should be replaced.')).toBeInTheDocument()
    expect(sent).toEqual([])

    await user.click(within(dialog).getByRole('combobox', { name: 'Page to replace' }))
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Header'])
    await user.click(options[0]!)
    expect(within(dialog).getByTestId('import-replace-warning')).toHaveTextContent('The current draft of “Header” is replaced')

    await user.click(within(dialog).getByRole('button', { name: 'Import' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Someone changed that page while you were choosing.')
    expect({ ...sent[0], file: undefined }).toEqual({ file: undefined, target: 'replace', document_id: 'd-header', revision: '7' })

    answer = 'locked'
    await user.click(within(dialog).getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Rima is editing that page right now.'))

    answer = 'ok'
    await user.click(within(dialog).getByRole('button', { name: 'Import' }))
    const report = await within(dialog).findByTestId('import-report')
    expect(within(report).getByRole('status')).toHaveTextContent('The draft of “Header” was replaced')
    expect(report).toHaveTextContent('The page has only text and design: nothing needed to be matched.')
    expect(report).toHaveTextContent('Everything in the copy was brought over.')
  })

  it('explains a file that is not a page copy, and the server’s refusal with its reason', async () => {
    const user = userEvent.setup()
    const sent = mockScreen(() => fail(422, 'IMPORT_INVALID', 'Invalid', { reason: 'The content has no sections list.' }))
    renderRoutes(routes, '/storefront/pages')
    const dialog = await openDialog(user)
    const input = within(dialog).getByLabelText('Page copy file (.json)')
    await user.upload(input, fileOf({ hello: 'world' }, 'photo.json'))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This isn’t a page copy.')
    await user.click(within(dialog).getByRole('button', { name: 'Import' }))
    expect(sent).toEqual([])

    await user.upload(input, fileOf(copy({})))
    await within(dialog).findByTestId('import-file-summary')
    await user.click(within(dialog).getByRole('button', { name: 'Import' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('This file can’t be imported.')
    expect(alert).toHaveTextContent('What the shop said: The content has no sections list.')
  })

  it('speaks Bangla with the screen and is not offered without storefront.manage', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('pos.storeBuilder.pagesLang', 'bn')
    mockScreen(() => fail(500, 'SERVER_ERROR'))
    const first = renderRoutes(routes, '/storefront/pages')
    await user.click(await screen.findByRole('button', { name: 'একটি পেজ আনুন…' }))
    const dialog = await screen.findByRole('dialog', { name: 'একটি পেজ আনুন' })
    await user.upload(within(dialog).getByLabelText('পেজ কপির ফাইল (.json)'), fileOf(copy({})))
    expect(await within(dialog).findByTestId('import-file-summary')).toHaveTextContent('২টি ছবি')
    first.unmount()

    window.localStorage.clear()
    mockApi({ 'GET /auth/me': ok(viewer()), 'GET /storefront/builder/documents': ok(DOCS) })
    renderRoutes(routes, '/storefront/pages')
    await screen.findByRole('heading', { name: 'Page builder' })
    await screen.findAllByText('Eid offers')
    expect(screen.queryByRole('button', { name: 'Import a page…' })).toBeNull()
  })
})
