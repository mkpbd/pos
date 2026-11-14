import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/routes'
import { listingResponse } from '@/features/online-catalog/test-data'
import { draftFromTemplate, GUIDE_TEMPLATES, pasteIntoDraft, toDraft, toSizeGuideInput, validateDraft, type SizeGuide } from '@/features/storefront/size-guides'
import { makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess, error: vi.fn(), message: vi.fn() }) }
})
beforeEach(() => toastSuccess.mockReset())

const manager = () => makeCurrentUser({ permissions: ['storefront.view', 'online_catalog.view', 'online_catalog.manage', 'media.manage'] })
const viewer = () => makeCurrentUser({ permissions: ['storefront.view', 'online_catalog.view'] })

const webCategories = [
  { id: 'c-1', name: 'Kids', parent_id: null, depth: 0, is_active: true, listing: null },
  { id: 'c-2', name: 'Shoes', parent_id: 'c-1', depth: 1, is_active: true, listing: null },
  { id: 'c-3', name: 'Tops', parent_id: 'c-1', depth: 1, is_active: true, listing: null },
]

const guide: SizeGuide = {
  id: 'g-1', name: 'Kids tops', title: 'Size guide', intro: 'Measure under the arms.',
  columns: [{ id: 'size', label: 'Size' }, { id: 'chest', label: 'Chest (cm)' }],
  rows: [{ id: 'r1', cells: { size: '2', chest: '52' } }, { id: 'r2', cells: { size: '4', chest: '56' } }],
  note: null, image_media_id: null, image: null, category_ids: ['c-3'],
  translations: { bn: { title: 'সাইজ গাইড', intro: null, note: null, columns: { chest: 'বুক (সেমি)' }, cells: { r1: { size: '২' } } } },
  updated_at: '2026-11-10T10:00:00Z',
}
const summary = { id: 'g-1', name: 'Kids tops', title: 'Size guide', category_ids: ['c-3'], products_count: 4, updated_at: '2026-11-10T10:00:00Z' }

describe('size guide helpers', () => {
  it('round-trips a guide and builds the body with Bangla keyed by column and row ids', () => {
    const draft = toDraft(guide)
    expect(draft.bn.columns).toEqual({ chest: 'বুক (সেমি)' })
    const input = toSizeGuideInput({ ...draft, note: '  ', rows: [...draft.rows, { id: 'r3', cells: { size: ' 6 ', gone: 'x' } }] })
    expect(input).toEqual({
      name: 'Kids tops', title: 'Size guide', intro: 'Measure under the arms.', note: null, image_media_id: null, category_ids: ['c-3'],
      columns: [{ id: 'size', label: 'Size' }, { id: 'chest', label: 'Chest (cm)' }],
      rows: [{ id: 'r1', cells: { size: '2', chest: '52' } }, { id: 'r2', cells: { size: '4', chest: '56' } }, { id: 'r3', cells: { size: '6' } }],
      translations: { bn: { title: 'সাইজ গাইড', intro: '', note: '', columns: { chest: 'বুক (সেমি)' }, cells: { r1: { size: '২' } } } },
    })
  })

  it('validates limits and pastes spreadsheet blocks, growing the table', () => {
    const draft = draftFromTemplate(GUIDE_TEMPLATES.find((t) => t.key === 'blank')!)
    expect(validateDraft(draft)).toEqual({ name: 'Give the guide a name, e.g. “T-shirts”.' })
    expect(validateDraft({ ...draft, name: 'x', columns: [{ id: 'a', label: '' }] })['columns.0.label']).toBe('Name the column.')

    const pasted = pasteIntoDraft(draft, 0, 0, [['S', '50', '70'], ['M', '54', '72']])
    expect(pasted.columns).toHaveLength(3)
    expect(pasted.rows.map((r) => pasted.columns.map((c) => r.cells[c.id] ?? ''))).toEqual([['S', '50', '70'], ['M', '54', '72']])
  })
})

describe('SizeGuidesPage', () => {
  it('creates a guide from a template, fills the table and assigns a free category', async () => {
    const user = userEvent.setup()
    let posted: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /online-catalog/size-guides': ok([summary]),
      'GET /online-catalog/categories': ok(webCategories),
      'POST /online-catalog/size-guides': (init) => {
        posted = JSON.parse(String(init.body))
        return { status: 201, body: { success: true, data: { ...guide, id: 'g-2', name: 'Kids shoes' }, meta: { request_id: 't' } } }
      },
    })
    renderRoutes(routes, '/storefront/size-guides')

    const row = (await screen.findByText('Kids tops')).closest('tr') as HTMLElement
    expect(within(row).getByText('Tops')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Size guides' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New size guide' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^Shoes/ }))
    await user.type(within(dialog).getByLabelText('Name (for you)'), 'Kids shoes')
    const cell = within(dialog).getByLabelText('UK, 38')
    await user.type(cell, '5')
    await user.keyboard('{ArrowDown}')
    expect(within(dialog).getByLabelText('UK, 39')).toHaveFocus()
    // Tops already uses another guide; Shoes is free.
    expect(within(dialog).getByRole('checkbox', { name: /Tops/ })).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox', { name: /Shoes/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Save size guide' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Kids shoes saved.'))
    expect(posted).toMatchObject({ name: 'Kids shoes', title: 'Size guide', category_ids: ['c-2'] })
    const body = posted as { columns: { id: string; label: string }[]; rows: { cells: Record<string, string> }[] }
    expect(body.columns.map((c) => c.label)).toEqual(['EU', 'UK', 'US', 'Foot length (cm)'])
    expect(body.rows[0]?.cells).toEqual({ [body.columns[0]!.id]: '38', [body.columns[1]!.id]: '5' })
  })

  it('edits a guide in Bangla and shows category conflicts from the server', async () => {
    const user = userEvent.setup()
    let put: Record<string, unknown> | undefined
    mockApi({
      'GET /auth/me': ok(manager()),
      'GET /online-catalog/size-guides': ok([summary]),
      'GET /online-catalog/categories': ok(webCategories),
      'GET /online-catalog/size-guides/g-1': ok(guide),
      'PUT /online-catalog/size-guides/g-1': (init) => {
        put = JSON.parse(String(init.body))
        return fail(422, 'VALIDATION_FAILED', 'Invalid.', { 'category_ids.1': ['Already uses size guide “Shoes”.'] })
      },
    })
    renderRoutes(routes, '/storefront/size-guides')

    await user.click(await screen.findByRole('button', { name: 'Edit size guide Kids tops' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(await within(dialog).findByText(/Table in/))
    const bnCell = within(dialog).getByLabelText('Chest (cm), 4 in Bangla')
    await user.type(bnCell, '৫৬')
    await user.click(within(dialog).getByRole('checkbox', { name: /Shoes/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Save size guide' }))

    expect(await within(dialog).findByText('Shoes: Already uses size guide “Shoes”.')).toBeInTheDocument()
    expect(put).toMatchObject({ category_ids: ['c-3', 'c-2'], translations: { bn: { cells: { r1: { size: '২' }, r2: { chest: '৫৬' } } } } })
  })

  it('is read-only for viewers', async () => {
    const user = userEvent.setup()
    mockApi({
      'GET /auth/me': ok(viewer()),
      'GET /online-catalog/size-guides': ok([summary]),
      'GET /online-catalog/categories': ok(webCategories),
      'GET /online-catalog/size-guides/g-1': ok(guide),
    })
    renderRoutes(routes, '/storefront/size-guides')

    await user.click(await screen.findByRole('button', { name: 'View size guide Kids tops' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByLabelText('Chest (cm), 2')).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: 'Save size guide' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New size guide' })).not.toBeInTheDocument()
  })
})

describe('product online listing', () => {
  it('picks a size guide for the product or falls back to the category', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | undefined
    const data = listingResponse({ size_guide_id: null, inherited_size_guide: { id: 'g-1', name: 'Kids tops' } })
    mockApi({
      'GET /auth/me': ok(makeCurrentUser({ permissions: ['products.view', 'online_catalog.view', 'online_catalog.manage'] })),
      'GET /online-catalog/products/p-1': ok(data),
      'GET /online-catalog/size-guides': ok([summary, { ...summary, id: 'g-2', name: 'Kids shoes', category_ids: [] }]),
      'PUT /online-catalog/products/p-1': (init) => {
        body = JSON.parse(String(init.body))
        return ok(data)
      },
      'PUT /online-catalog/products/p-1/related': ok({ related: [], frequently_bought: [] }),
    })
    renderRoutes(routes, '/products/p-1/online-store')

    const picker = await screen.findByRole('combobox', { name: 'Size guide on the product page' })
    expect(picker).toHaveTextContent('From the category (Kids tops)')
    await user.click(picker)
    await user.click(await screen.findByRole('option', { name: 'Kids shoes' }))
    await user.click(screen.getByRole('button', { name: 'Save online listing' }))

    await waitFor(() => expect(body).toBeDefined())
    expect(body?.size_guide_id).toBe('g-2')
  })
})
