import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { routes } from '@/app/routes'
import type { Banner } from '@/features/storefront/api'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import { cloneSample } from '@/storefront/builder/test-payload'
import { bootstrapFixture } from '@/storefront/test-fixtures'
import { makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderRoutes } from '@/test/utils'
import { elementsShowingBanners, replaceBanner } from './banner-refs'
import { detail } from './test-helpers'

/*
 * Editing a page's banner from the inspector: the banner chooser's Edit opens the banner form,
 * the save goes through the builder's copy-on-write endpoint, a copy is swapped into the draft
 * (one undo step) and the canvas resolves the slider again even when its input is unchanged.
 */

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, success: toastSuccess }) }
})

beforeEach(() => toastSuccess.mockReset())

const MEN = '01a1c9d9-0000-7000-8000-000000000001'
const COPY = '01a1c9d9-0000-7000-8000-0000000000c0'
const page = { pagination: { current_page: 1, per_page: 100, total: 0, last_page: 1 } }

const banner = (id: string, name: string, title: string): Banner => ({
  id, placement: 'hero_slider', name, kicker: null, title, subtitle: null, link_url: null, button_label: null, secondary_link_url: null, secondary_button_label: null,
  desktop_media_id: '01a1c9d9-0000-7000-8000-0000000000a1', mobile_media_id: null, text_color: '#ffffff', text_position: 'left', starts_at: null, ends_at: null,
  is_active: true, is_live: true, state: 'live', sort_order: 0, updated_at: null,
})

type ResolveBody = { elements: { id: string; items?: { item_id: string }[] }[] }

function mockEditor(replaced: { old_id: string; new_id: string } | null) {
  const resolves: ResolveBody[] = []
  const edits: Record<string, unknown>[] = []
  const puts: { content: unknown }[] = []
  let banners = [banner(MEN, 'Men', 'Men title')]
  mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions: ['storefront.view', 'storefront.manage', 'storefront.publish'] })),
    'GET /storefront/builder/documents/doc-1': ok(detail(cloneSample(), 3)),
    'GET /storefront/builder/elements': ok({ types: ELEMENT_REGISTRY, limits: {}, enums: {} }),
    'GET /storefront/builder/canvas-context': ok({ bootstrap: bootstrapFixture(), store_url: 'https://shop.test', locales: ['en'] }),
    'POST /storefront/builder/resolve': (init) => {
      resolves.push(JSON.parse(String(init.body)) as ResolveBody)
      return ok({ data: {}, media: {}, errors: {} })
    },
    'GET /storefront/link-targets': ok({ pages: [], categories: [], brands: [], blog_categories: [], blog_posts: [] }),
    'GET /storefront/banners': () => ok(banners),
    'GET /media': ok([], page),
    [`POST /storefront/builder/documents/doc-1/banners/${MEN}`]: (init) => {
      const input = JSON.parse(String(init.body)) as Record<string, unknown>
      edits.push(input)
      const saved = { ...banner(replaced ? COPY : MEN, replaced ? 'Men · Home' : 'Men', String(input.title)) }
      banners = replaced ? [...banners, saved] : [saved]
      return ok({ banner: saved, replaced })
    },
    'PUT /storefront/builder/documents/doc-1/draft': (init) => {
      const body = JSON.parse(String(init.body)) as { revision: number; content: unknown }
      puts.push(body)
      return ok(detail(cloneSample(), body.revision + 1))
    },
  })
  return { resolves, edits, puts }
}

const sliderResolves = (resolves: ResolveBody[]) => resolves.filter((body) => body.elements.some((e) => e.id === 'e_slider'))

async function openBannerEdit(user: ReturnType<typeof userEvent.setup>) {
  renderRoutes(routes, '/storefront/builder/doc-1')
  expect(await screen.findByTitle(/Page canvas/)).toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: 'Layers' }))
  await user.click(within(screen.getByRole('tree', { name: 'Page layers' })).getByRole('button', { name: /^Hero slider/ }))
  const inspector = screen.getByRole('complementary', { name: 'Inspector' })
  await user.click(await within(inspector).findByRole('button', { name: 'Edit Men' }))
  const dialog = await screen.findByRole('dialog', { name: 'Edit banner' })
  expect(within(dialog).getByRole('textbox', { name: 'Headline' })).toHaveValue('Men title')
  expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('Men')
  return dialog
}

describe('store builder: editing a page banner', () => {
  it('saves in place and resolves the slider again although its input is unchanged', async () => {
    const user = userEvent.setup()
    const { resolves, edits } = mockEditor(null)
    const dialog = await openBannerEdit(user)
    await waitFor(() => expect(sliderResolves(resolves).length).toBeGreaterThan(0))
    const before = sliderResolves(resolves).length

    const headline = within(dialog).getByRole('textbox', { name: 'Headline' })
    await user.clear(headline)
    await user.type(headline, 'Summer is here')
    await user.click(within(dialog).getByRole('button', { name: 'Save banner' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Banner updated'))
    expect(edits).toEqual([expect.objectContaining({ title: 'Summer is here', name: 'Men' })])
    expect(edits[0]).not.toHaveProperty('placement')
    expect(screen.queryByRole('dialog', { name: 'Edit banner' })).not.toBeInTheDocument()
    // Same banner id, same element input: only the explicit refresh asks the server again.
    await waitFor(() => expect(sliderResolves(resolves).length).toBe(before + 1))
    expect(sliderResolves(resolves).at(-1)!.elements.find((e) => e.id === 'e_slider')!.items).toEqual([{ item_type: 'banner', item_id: MEN }])
  })

  it('swaps in the copy the server made (one undo step) and resolves it', async () => {
    const user = userEvent.setup()
    const { resolves, puts } = mockEditor({ old_id: MEN, new_id: COPY })
    const dialog = await openBannerEdit(user)

    const headline = within(dialog).getByRole('textbox', { name: 'Headline' })
    await user.clear(headline)
    await user.type(headline, 'Only here')
    await user.click(within(dialog).getByRole('button', { name: 'Save banner' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Banner copied for this page — the live store doesn’t change until you publish'))
    const sliderItems = () => sliderResolves(resolves).at(-1)?.elements.find((e) => e.id === 'e_slider')?.items
    await waitFor(() => expect(sliderItems()).toEqual([{ item_type: 'banner', item_id: COPY }]))
    // The chooser shows the copy, and the autosave sends the draft with it.
    expect(await within(screen.getByRole('complementary', { name: 'Inspector' })).findByRole('button', { name: 'Edit Men · Home' })).toBeInTheDocument()
    await waitFor(() => expect(JSON.stringify(puts.at(-1)?.content ?? '')).toContain(COPY), { timeout: 4000 })
    expect(JSON.stringify(puts.at(-1)!.content)).not.toContain(MEN)

    // One undo brings the original back.
    await user.click(within(screen.getByRole('banner', { name: 'Editor toolbar' })).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(sliderItems()).toEqual([{ item_type: 'banner', item_id: MEN }]))
  })
})

describe('banner refs', () => {
  it('replaces a banner everywhere in the draft and finds the elements showing it', () => {
    const content = cloneSample()
    expect(elementsShowingBanners(content, [MEN])).toEqual(['e_slider'])
    expect(elementsShowingBanners(content, [COPY])).toEqual([])
    const next = replaceBanner(content, MEN, COPY)
    expect(elementsShowingBanners(next, [COPY])).toEqual(['e_slider'])
    expect(elementsShowingBanners(next, [MEN])).toEqual([])
    expect(replaceBanner(content, COPY, MEN)).toBe(content)
  })
})
