import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import type { ThemeDocument, ThemeDraft } from '@/features/storefront/api'
import type { DocumentSchedule } from '@/features/store-builder/publishing-api'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

/* B11: the theme's "Publish later" (store time), its chip with cancel, and publish now cancelling a plan. */

const publisher = () => makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish', 'media.manage'] })

const settings = {
  colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1', button: '#f59e0b', button_foreground: '#3b2500', button_hover: null, link: '#6f55c2' },
  typography: { heading_font: 'baloo', body_font: 'poppins', body_size: 16, heading_scale: 1.25, line_height: 1.5, heading_weight: 700, mobile_scale: 1, letter_spacing: 0 },
  palette: [],
  shape: { button_style: 'pill', card_radius: 12 },
  layout: { container_width: 1170, sticky_header: true, header_style: 'standard', footer_style: 'columns', card_style: 'standard', hero_style: 'full', heading_case: 'normal', top_bar: 'none' },
  preset: 'default',
  logo_media_id: null,
  favicon_media_id: null,
  announcement: { enabled: false, text: null, link: null, background: '#6f55c2', foreground: '#ffffff', starts_at: null, ends_at: null },
  footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: { facebook: null, instagram: null, youtube: null, tiktok: null, x: null, linkedin: null }, payment_logo_media_ids: [] },
} as unknown as ThemeDocument

const planned: DocumentSchedule = { id: 'sch-t', status: 'pending', publish_at: '2026-12-01T03:00:00Z', note: null, created_by: { id: 'u-1', name: 'Rahim Uddin' } }

const draft = (schedule: DocumentSchedule | null, over: Partial<ThemeDraft> = {}) =>
  ({
    settings,
    draft_revision: 5,
    has_unpublished_changes: true,
    draft_updated_at: null,
    published: { version_id: 'v-2', number: 2, published_at: '2026-11-10T10:00:00Z' },
    preview_url: null,
    custom_css: null,
    has_custom_css: false,
    schedule,
    ...over,
  }) as ThemeDraft

const emptyMedia = ok([], { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } })
const body = (init: RequestInit) => JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>

describe('theme page: publish later (B11)', () => {
  it('schedules the theme in store time, shows when it goes live and cancels it', async () => {
    const user = userEvent.setup()
    let current: DocumentSchedule | null = null
    let scheduled: Record<string, unknown> | null = null
    let cancelled = false
    mockApi({
      'GET /auth/me': ok(publisher()),
      'GET /storefront/theme/presets': ok([]),
      'GET /media': emptyMedia,
      'GET /storefront/theme/draft': () => ok(draft(current)),
      'POST /storefront/theme/schedule': (init) => {
        scheduled = body(init)
        current = { ...planned, publish_at: String(scheduled.publish_at) }
        return ok(draft(current))
      },
      'DELETE /storefront/theme/schedule': () => {
        cancelled = true
        current = null
        return ok(draft(null))
      },
    })
    renderRoutes(routes, '/storefront/theme')
    await user.click(await screen.findByRole('button', { name: /^Publish$/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Publish the theme?' })
    await user.click(within(dialog).getByRole('radio', { name: /Publish later/ }))
    expect(within(dialog).getByText(/In store time, Asia\/Dhaka/)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Winter colours')
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }))
    await waitFor(() => expect(scheduled).toEqual({ publish_at: expect.stringMatching(/T09:00:00\+06:00$/), note: 'Winter colours' }))

    const chip = await within(screen.getByTestId('theme-status')).findByTestId('schedule-chip')
    expect(chip).toHaveTextContent(/Goes live \d+ \w+, 09:00/)
    await user.click(chip)
    expect(await screen.findByTestId('schedule-details')).toHaveTextContent('The theme goes live as it was when this was planned')
    await user.click(within(screen.getByTestId('schedule-details')).getByRole('button', { name: 'Cancel it' }))
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Cancel the planned publish?' })).getByRole('button', { name: 'Cancel it' }))
    await waitFor(() => expect(cancelled).toBe(true))
    await waitFor(() => expect(screen.queryByTestId('schedule-chip')).toBeNull())
  })

  it('publishing now while a publish is planned cancels it unless unticked', async () => {
    const user = userEvent.setup()
    const posts: Record<string, unknown>[] = []
    mockApi({
      'GET /auth/me': ok(publisher()),
      'GET /storefront/theme/presets': ok([]),
      'GET /media': emptyMedia,
      'GET /storefront/theme/draft': ok(draft(planned)),
      'POST /storefront/theme/publish': (init) => {
        posts.push(body(init))
        return ok(draft(planned, { has_unpublished_changes: false }))
      },
    })
    renderRoutes(routes, '/storefront/theme')
    await user.click(await screen.findByRole('button', { name: /^Publish$/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Publish the theme?' })
    expect(within(dialog).getByTestId('publish-pending-schedule')).toHaveTextContent('A publish is planned for Tue, 1 Dec 2026, 09:00.')
    const box = within(dialog).getByRole('checkbox', { name: /Cancel it \(your theme goes live now\)/ })
    expect(box).toBeChecked()
    await user.click(box)
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(posts).toEqual([{ cancel_schedule: false }]))
  })

  it('a failed theme plan says why', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(publisher()),
      'GET /storefront/theme/presets': ok([]),
      'GET /media': emptyMedia,
      'GET /storefront/theme/draft': ok(draft({ ...planned, status: 'failed', failure: { code: 'FONT_NOT_FOUND', message: 'The heading font was deleted.' } })),
      'DELETE /storefront/theme/schedule': fail(409, 'NOTHING_SCHEDULED'),
    })
    renderRoutes(routes, '/storefront/theme')
    const chip = await screen.findByTestId('schedule-chip')
    expect(chip).toHaveTextContent('Didn’t go live')
    await user.click(chip)
    expect(await screen.findByTestId('schedule-details')).toHaveTextContent('The heading font was deleted.')
  })
})
