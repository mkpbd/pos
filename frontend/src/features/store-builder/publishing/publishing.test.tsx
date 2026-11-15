import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'
import type { DocumentSummary } from '../api'
import { PublishDialog } from '../dialogs'
import { detail } from '../test-helpers'
import type { DocumentSchedule, ReviewSummary } from '../publishing-api'
import { changeItems, fieldLabel, valueText } from './changes'
import { checkScheduleInput, defaultScheduleInput, formatStoreTime } from './schedule-time'

/* B11: publish later, versions & named copies, compare, approval — editor and pages list. */

const PUBLISH = ['storefront.view', 'storefront.manage', 'storefront.publish']
const EDIT_ONLY = ['storefront.view', 'storefront.manage']

describe('publish later: store time', () => {
  // 2026-11-15 12:00 in Dhaka (UTC+6).
  const now = Date.parse('2026-11-15T06:00:00Z')

  it('defaults to tomorrow 09:00 store time and checks the range', () => {
    expect(defaultScheduleInput('Asia/Dhaka', now)).toBe('2026-11-16T09:00')
    expect(checkScheduleInput('2026-11-16T09:00', 'Asia/Dhaka', now)).toEqual({ ok: true, iso: '2026-11-16T09:00:00+06:00' })
    expect(checkScheduleInput('2026-11-15T11:00', 'Asia/Dhaka', now)).toEqual({ ok: false, error: 'Choose a time in the future, or publish now.' })
    expect(checkScheduleInput('2028-01-01T09:00', 'Asia/Dhaka', now)).toEqual({ ok: false, error: 'Choose a time within the next year.' })
    expect(checkScheduleInput('', 'Asia/Dhaka', now).ok).toBe(false)
    expect(formatStoreTime('2026-11-16T03:00:00Z', 'Asia/Dhaka')).toBe('Mon, 16 Nov 2026, 09:00')
    expect(formatStoreTime('2026-11-16T03:00:00Z', 'Asia/Dhaka', { short: true })).toBe('16 Nov, 09:00')
  })
})

describe('change list in plain words', () => {
  it('names fields and values for a shop owner', () => {
    expect(fieldLabel('props.primary.label')).toBe('Button text')
    expect(fieldLabel('props.link.url')).toBe('Link')
    expect(fieldLabel('translations.bn.text')).toBe('Text (Bangla)')
    expect(fieldLabel('props.button_style')).toBe('Button style')
    expect(valueText('<p>Fresh <b>sweets</b></p>')).toBe('“Fresh sweets”')
    expect(valueText(null)).toBe('(empty)')
    expect(valueText({ url: '/shop' })).toBe('“/shop”')
  })

  it('lists added, removed, changed and moved parts; styles are a flag only', () => {
    const items = changeItems(
      {
        added: [{ node_id: 'e_new', type: 'heading', label: 'Eid sale' }],
        removed: [{ node_id: 'e_old', type: 'image' }],
        changed: [{ node_id: 'e_btn', type: 'button', fields: [{ field: 'props.label', before: 'Shop now', after: 'Buy now' }, { field: 'style', before: null, after: null }] }],
        moved: ['s_1'],
      },
      (type) => ({ heading: 'Heading', image: 'Image', button: 'Button', section: 'Section' })[type] ?? type,
      (id) => (id === 's_1' ? { node_id: 's_1', type: 'section' } : null),
    )
    expect(items.map((i) => [i.kind, i.title])).toEqual([
      ['added', 'Heading “Eid sale”'],
      ['removed', 'Image'],
      ['changed', 'Button'],
      ['moved', 'Section'],
    ])
    expect(items[2]!.details).toEqual(['Button text: “Shop now” → “Buy now”', 'Design (colours, sizes, spacing) changed'])
  })
})

describe('publish dialog: now or later', () => {
  it('keeps "Publish" for now; "Publish later" takes a store-time date and refuses the past', async () => {
    const user = userEvent.setup()
    const onPublish = vi.fn()
    const onSchedule = vi.fn()
    render(<PublishDialog open onOpenChange={() => {}} pending={false} error={null} onPublish={onPublish} later={{ timeZone: 'Asia/Dhaka', current: null, onSchedule }} />)
    const dialog = screen.getByRole('dialog', { name: 'Publish this page?' })
    expect(within(dialog).getByRole('radio', { name: /Publish now/ })).toBeChecked()
    expect(within(dialog).getByRole('button', { name: 'Publish' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('radio', { name: /Publish later/ }))
    const input = within(dialog).getByLabelText('Date and time')
    expect(within(dialog).getByText(/In store time, Asia\/Dhaka/)).toBeInTheDocument()
    await user.clear(input)
    await user.type(input, '2020-01-01T09:00')
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose a time in the future, or publish now.')
    expect(onSchedule).not.toHaveBeenCalled()

    const next = `${new Date().getUTCFullYear() + 1}-01-02T09:00`
    await user.clear(input)
    await user.type(input, next)
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Eid banners')
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }))
    expect(onSchedule).toHaveBeenCalledWith(`${next}:00+06:00`, 'Eid banners')
    expect(onPublish).not.toHaveBeenCalled()
  })

  it('without "later" (no publish permission elsewhere) it is the plain publish dialog', () => {
    render(<PublishDialog open onOpenChange={() => {}} pending={false} error={null} onPublish={() => {}} />)
    expect(screen.queryByRole('radio')).toBeNull()
  })
})

/* ---------------------------------------------------------------- editor ------------------- */

const pending: DocumentSchedule = { id: 'sch-1', publish_at: '2026-12-01T03:00:00Z', status: 'pending', note: 'Eid', created_by: { id: 'u-1', name: 'Rahim Uddin' } }

function mockEditor(permissions: string[], extra: Parameters<typeof mockApi>[0] = {}, doc: Record<string, unknown> = {}) {
  const content = cloneSample()
  return mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions })),
    'GET /storefront/builder/documents/doc-1': ok({ ...detail(content, 3), ...doc }),
    'GET /storefront/builder/elements': ok({ types: ELEMENT_REGISTRY, limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: bootstrapFixture(), store_url: 'https://shop.test', locales: ['en'] }),
    'POST /storefront/builder/resolve': ok({ data: {}, media: {}, errors: {} }),
    'POST /storefront/builder/documents/doc-1/check': ok({ issues: [], counts: { error: 0, warning: 0, tip: 0 }, checked_at: '2026-11-15T08:00:00Z' }),
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'PUT /storefront/builder/documents/doc-1/draft': (init) => ok({ ...detail(content, (JSON.parse(String(init.body)) as { revision: number }).revision + 1) }),
    ...extra,
  })
}

const toolbar = () => screen.findByRole('banner', { name: 'Editor toolbar' })

describe('editor: publish later, approval and versions', () => {
  it('schedules the page, shows when it goes live, and cancels it', async () => {
    const user = userEvent.setup()
    let scheduled: { publish_at?: string; note?: string } | null = null
    let cancelled = false
    mockEditor(PUBLISH, {
      'POST /storefront/builder/documents/doc-1/schedule': (init) => {
        scheduled = JSON.parse(String(init.body)) as { publish_at: string }
        return ok({ ...detail(cloneSample(), 4), schedule: { ...pending, publish_at: scheduled.publish_at } })
      },
      'DELETE /storefront/builder/documents/doc-1/schedule': () => {
        cancelled = true
        return ok({ ...detail(cloneSample(), 4), schedule: null })
      },
    })
    renderRoutes(routes, '/storefront/builder/doc-1')
    await user.click(within(await toolbar()).getByRole('button', { name: 'Publish' }))
    const dialog = await screen.findByRole('dialog', { name: 'Publish this page?' })
    await user.click(within(dialog).getByRole('radio', { name: /Publish later/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }))
    await waitFor(() => expect(scheduled?.publish_at).toMatch(/T09:00:00\+06:00$/))

    const chip = await screen.findByTestId('schedule-chip')
    expect(chip).toHaveTextContent(/Goes live \d+ \w+, 09:00/)
    await user.click(chip)
    const details = await screen.findByTestId('schedule-details')
    await user.click(within(details).getByRole('button', { name: 'Cancel it' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Cancel the planned publish?' })
    await user.click(within(confirm).getByRole('button', { name: 'Cancel it' }))
    await waitFor(() => expect(cancelled).toBe(true))
    await waitFor(() => expect(screen.queryByTestId('schedule-chip')).toBeNull())
  })

  it('publishing now while a publish is planned cancels it unless unticked', async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    mockEditor(PUBLISH, {
      'POST /storefront/builder/documents/doc-1/publish': (init) => {
        bodies.push(JSON.parse(String(init.body)))
        return ok({ ...detail(cloneSample(), 4), published: { version_id: 'v-9', number: 9, published_at: '2026-11-15T08:00:00Z' }, schedule: null })
      },
    }, { schedule: pending })
    renderRoutes(routes, '/storefront/builder/doc-1')
    expect(await screen.findByTestId('schedule-chip')).toBeInTheDocument()
    await user.click(within(await toolbar()).getByRole('button', { name: 'Publish' }))
    const dialog = await screen.findByRole('dialog', { name: 'Publish this page?' })
    const box = within(dialog).getByRole('checkbox', { name: /Cancel it/ })
    expect(box).toBeChecked()
    expect(within(dialog).getByTestId('publish-pending-schedule')).toHaveTextContent('A publish is planned for Tue, 1 Dec 2026, 09:00.')
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(bodies).toEqual([{ cancel_schedule: true }]))
    await waitFor(() => expect(screen.queryByTestId('schedule-chip')).toBeNull())
  })

  it('a failed planned publish says why', async () => {
    const user = userEvent.setup()
    mockEditor(PUBLISH, {}, { schedule: { ...pending, status: 'failed', failure: { code: 'DOCUMENT_INVALID', message: 'The product “Red shoes” on the page was deleted.' } } })
    renderRoutes(routes, '/storefront/builder/doc-1')
    const chip = await screen.findByTestId('schedule-chip')
    expect(chip).toHaveTextContent('Didn’t go live')
    await user.click(chip)
    expect(await screen.findByTestId('schedule-details')).toHaveTextContent('The product “Red shoes” on the page was deleted.')
  })

  it('people who may not publish submit the page for review and see it waiting', async () => {
    const user = userEvent.setup()
    let body: unknown
    mockEditor(EDIT_ONLY, {
      'POST /storefront/builder/documents/doc-1/reviews': (init) => {
        body = JSON.parse(String(init.body))
        return ok({ id: 'rev-1', status: 'pending', note: 'Please publish before Friday', comment: null, submitted_by: { id: 'u-1', name: 'Rahim Uddin' }, submitted_at: '2026-11-15T08:00:00Z' })
      },
    }, { review: { id: 'rev-0', status: 'sent_back', note: null, comment: 'The banner price is wrong.', submitted_by: null, submitted_at: '2026-11-14T08:00:00Z', decided_by: { id: 'u-2', name: 'Nadia' } } })
    renderRoutes(routes, '/storefront/builder/doc-1')
    expect(await screen.findByTestId('review-chip')).toHaveTextContent('Sent back')
    await user.click(within(await toolbar()).getByRole('button', { name: 'Submit for review' }))
    const dialog = await screen.findByRole('dialog', { name: 'Submit this page for review?' })
    expect(within(dialog).getByTestId('sent-back-comment')).toHaveTextContent('The banner price is wrong.')
    await user.type(within(dialog).getByLabelText(/Message for the person who approves/), 'Please publish before Friday')
    await user.click(within(dialog).getByRole('button', { name: 'Submit for review' }))
    await waitFor(() => expect(body).toEqual({ note: 'Please publish before Friday' }))
    await waitFor(() => expect(screen.getByTestId('review-chip')).toHaveTextContent('Waiting for approval'))
  })

  it('version history lists named versions and saved copies; saves, renames and compares', async () => {
    const user = userEvent.setup()
    let checkpoint: unknown
    let renamed: unknown
    const versions = [
      { id: 'cp-1', kind: 'checkpoint', number: null, name: 'Before Eid', note: null, published_at: null, created_by: { id: 'u-1', name: 'Rahim' }, created_at: '2026-11-14T08:00:00Z' },
      { id: 'v-2', kind: 'version', number: 2, name: 'Eid sale', note: 'Eid banners', published_at: '2026-11-13T08:00:00Z', created_by: null, created_at: '2026-11-13T08:00:00Z', via: 'scheduled' },
      { id: 'v-1', kind: 'version', number: 1, name: null, note: null, published_at: '2026-11-12T08:00:00Z', created_by: null, created_at: '2026-11-12T08:00:00Z' },
    ]
    mockEditor(PUBLISH, {
      'GET /storefront/builder/documents/doc-1/versions': (_init, url) => (url.searchParams.get('include') === 'checkpoints' ? ok(versions) : fail(400, 'BAD')),
      'POST /storefront/builder/documents/doc-1/checkpoints': (init) => {
        checkpoint = JSON.parse(String(init.body))
        return ok({ ...versions[0], id: 'cp-2', name: 'Draft for Friday' })
      },
      'PATCH /storefront/builder/documents/doc-1/versions/v-1': (init) => {
        renamed = JSON.parse(String(init.body))
        return ok({ ...versions[2], name: 'First look' })
      },
      'GET /storefront/builder/documents/doc-1/versions/v-2/render': ok({ sections: [], data: {}, media: {} }),
      'GET /storefront/builder/documents/doc-1/compare': (_init, url) =>
        ok(url.searchParams.get('from') === 'v-2' && url.searchParams.get('to') === 'draft' ? { added: [{ id: 'e_h', type: 'heading', kind: 'element', parent_id: 'c_1', label: 'Made fresh every morning' }], removed: [], changed: [], moved: [] } : { added: [], removed: [], changed: [], moved: [] }),
    }, { published: { version_id: 'v-2', number: 2, published_at: '2026-11-13T08:00:00Z' } })
    renderRoutes(routes, '/storefront/builder/doc-1')
    await user.click(within(await toolbar()).getByRole('button', { name: 'More page actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /Version history/ }))
    const history = await screen.findByRole('dialog', { name: 'Version history' })

    const v2 = await within(history).findByTestId('version-2')
    expect(v2).toHaveTextContent('Eid sale')
    expect(v2).toHaveTextContent('Live')
    expect(v2).toHaveTextContent('Published on schedule')
    expect(within(history).getByTestId('checkpoint-cp-1')).toHaveTextContent('Saved copy · not published')

    // Save a named copy (the name is required).
    await user.click(within(history).getByRole('button', { name: 'Save a named copy' }))
    expect(within(history).getByRole('alert')).toHaveTextContent('Give the copy a name')
    await user.type(within(history).getByLabelText('Save a named copy of your draft'), 'Draft for Friday')
    await user.click(within(history).getByRole('button', { name: 'Save a named copy' }))
    await waitFor(() => expect(checkpoint).toEqual({ name: 'Draft for Friday' }))

    // Rename version 1.
    await user.click(within(history).getByRole('button', { name: 'Rename version 1' }))
    const name = within(history).getByLabelText('Name for version 1')
    await user.type(name, 'First look{Enter}')
    await waitFor(() => expect(renamed).toEqual({ name: 'First look' }))

    // Compare version 2 with the draft: two read-only canvases and the change list.
    await user.click(within(history).getByRole('button', { name: 'Compare version 2 with your draft' }))
    const compare = await screen.findByTestId('compare-dialog')
    expect(within(compare).getAllByTitle(/read-only preview/)).toHaveLength(2)
    const changes = within(compare).getByTestId('change-list')
    expect(await within(changes).findByText('Heading “Made fresh every morning”')).toBeInTheDocument()
    expect(within(compare).getByRole('button', { name: 'Restore “Before” to the draft' })).toBeInTheDocument()
  })
})

/* ---------------------------------------------------------------- pages list --------------- */

const home: DocumentSummary = {
  id: 'd-home', kind: 'page', key: 'home', title: 'Home', schema_version: 1, draft_revision: 4, has_unpublished_changes: true,
  draft_updated_at: '2026-11-11T08:00:00+00:00', published: { version_id: 'v-3', number: 3, published_at: '2026-11-10T08:00:00+00:00' },
  path: '/', preview_url: 'https://shop.test/?preview=draft', schedule: pending,
}
const landing: DocumentSummary = {
  ...home, id: 'd-eid', key: 'landing:eid-sale', title: 'Eid sale', published: null, path: '/p/eid-sale', schedule: null,
  review: { id: 'rev-1', status: 'pending', note: 'Ready for Friday', comment: null, submitted_by: { id: 'u-3', name: 'Karim' }, submitted_at: '2026-11-15T07:00:00Z', draft_changed: true },
}
const request: ReviewSummary = { ...landing.review!, document: { id: 'd-eid', kind: 'page', key: 'landing:eid-sale', title: 'Eid sale', path: '/p/eid-sale' } }

function mockPages(permissions: string[], extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions })),
    'GET /storefront/builder/documents': ok([home, landing]),
    'GET /storefront/builder/reviews': ok([request]),
    'GET /storefront/builder/reviews/rev-1': ok({
      review: request,
      document: request.document,
      render: { sections: [], data: {}, media: {}, snapshot: { kind: 'review', id: 'rev-1' } },
      changes: { from: 'live', to: 'rev-1', added: [{ id: 'e_1', type: 'heading', kind: 'element', parent_id: 'c_1', label: 'Eid sale' }], removed: [], changed: [], moved: [] },
    }),
    'GET /storefront/builder/documents/d-eid/render': fail(409, 'NOTHING_PUBLISHED', 'Nothing is published yet.'),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: bootstrapFixture(), store_url: 'https://shop.test', locales: ['en'] }),
    'GET /storefront/builder/elements': ok({ types: ELEMENT_REGISTRY, limits: {}, enums: {} }),
    ...extra,
  })
}

describe('pages list: planned publishes and approvals', () => {
  beforeEach(() => window.localStorage.clear())

  it('rows show the planned time and the approval state; editors get no approval tab', async () => {
    mockPages(EDIT_ONLY)
    renderRoutes(routes, '/storefront/pages')
    const homeRow = await screen.findByTestId('page-row-home')
    expect(within(homeRow).getByTestId('row-scheduled')).toHaveTextContent('Goes live 1 Dec, 09:00')
    expect(within(screen.getByTestId('page-row-landing:eid-sale')).getByTestId('row-review-pending')).toHaveTextContent('Waiting for approval')
    expect(screen.queryByRole('tab', { name: /Waiting for approval/ })).toBeNull()
  })

  it('publishers see the requests with a count, send one back only with a comment', async () => {
    const user = userEvent.setup()
    let sentBack: unknown
    mockPages(PUBLISH, {
      'POST /storefront/builder/reviews/rev-1/send-back': (init) => {
        sentBack = JSON.parse(String(init.body))
        return ok({ ...request, status: 'sent_back', comment: 'Fix the price' })
      },
    })
    renderRoutes(routes, '/storefront/pages')
    const tab = await screen.findByRole('tab', { name: /Waiting for approval/ })
    await waitFor(() => expect(within(tab).getByTestId('reviews-count')).toHaveTextContent('1'))
    await user.click(tab)
    const row = await screen.findByTestId('review-row-rev-1')
    expect(row).toHaveTextContent('Sent by Karim')
    expect(row).toHaveTextContent('Edited since it was sent')
    await user.click(within(row).getByRole('button', { name: 'Open the review of Eid sale' }))

    const review = await screen.findByTestId('review-screen')
    expect(within(review).getByRole('heading', { name: /Review: Eid sale/ })).toBeInTheDocument()
    // Store time (Asia/Dhaka), not the computer's.
    expect(within(review).getByText(/Sent by Karim on Sun, 15 Nov 2026, 13:00 \(store time\)/)).toBeInTheDocument()
    expect(await within(review).findByTestId('draft-changed')).toBeInTheDocument()
    expect(await within(review).findByText('Not live yet: shoppers don’t see this page.')).toBeInTheDocument()
    expect(within(within(review).getByTestId('change-list')).getByText('Heading “Eid sale”')).toBeInTheDocument()

    await user.click(within(review).getByRole('button', { name: 'Send back…' }))
    await user.click(within(review).getByRole('button', { name: 'Send back' }))
    expect(within(review).getByRole('alert')).toHaveTextContent('Write what should change')
    await user.type(within(review).getByLabelText('What should change? (required)'), 'Fix the price')
    await user.click(within(review).getByRole('button', { name: 'Send back' }))
    await waitFor(() => expect(sentBack).toEqual({ comment: 'Fix the price' }))
    await waitFor(() => expect(screen.queryByTestId('review-screen')).toBeNull())
  })

  it('approve and publish later sends the store-time instant; ?review= opens the request directly', async () => {
    const user = userEvent.setup()
    let approved: { publish_at?: string } | null = null
    mockPages(PUBLISH, {
      'POST /storefront/builder/reviews/rev-1/approve': (init) => {
        approved = JSON.parse(String(init.body)) as { publish_at?: string }
        return ok({ review: { ...request, status: 'approved' }, document: { ...landing, content: { schema_version: 1, sections: [] } } })
      },
    })
    renderRoutes(routes, '/storefront/pages?review=rev-1')
    const review = await screen.findByTestId('review-screen')
    const decision = await within(review).findByTestId('review-decision')
    await user.click(within(decision).getByRole('radio', { name: 'Later, at a time I choose' }))
    await user.click(within(decision).getByRole('button', { name: 'Approve and schedule' }))
    await waitFor(() => expect(approved?.publish_at).toMatch(/T09:00:00\+06:00$/))
  })
})
