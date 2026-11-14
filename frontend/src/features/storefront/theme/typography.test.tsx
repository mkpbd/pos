import { useState } from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StoreFont, ThemeSettings } from '@/features/storefront/api'
import { fail, mockApi, ok, renderWithQuery } from '@/test/utils'
import { GlobalStylesPanel } from './global-styles'

const UUID = '0193ab12-cd34-7000-8000-000000000001'
const UUID2 = '0193ab12-cd34-7000-8000-000000000002'
const shonar: StoreFont = {
  id: UUID,
  key: `custom:${UUID}`,
  name: 'Shonar',
  family: 'sf-custom-0193ab12cd34',
  url: '/storage/fonts/org/shonar.woff2',
  format: 'woff2',
  weight_min: 400,
  weight_max: 700,
  size: 120_000,
  used_by: ['theme_draft'],
  roles: ['bangla_heading'],
  created_at: null,
}
const spare: StoreFont = { ...shonar, id: UUID2, key: `custom:${UUID2}`, name: 'Spare', family: 'sf-custom-0193ab12cd35', url: '/storage/fonts/org/spare.woff2', used_by: [], roles: [] }

const theme: ThemeSettings = {
  colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
  typography: { heading_font: 'baloo', body_font: 'poppins' },
  shape: { button_style: 'pill', card_radius: 12 },
  layout: { container_width: 1170, sticky_header: true },
  logo_media_id: null,
  favicon_media_id: null,
  announcement: { enabled: false, text: null, link: null, background: '#6f55c2', foreground: '#ffffff', starts_at: null, ends_at: null },
  footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: { facebook: null, instagram: null, youtube: null, tiktok: null, x: null, linkedin: null }, payment_logo_media_ids: [] },
}

function setup(fonts: StoreFont[] = [shonar, spare], extra: Parameters<typeof mockApi>[0] = {}, disabled = false) {
  const fetch = mockApi({ 'GET /storefront/fonts': ok({ fonts, limit: 4, max_bytes: 512000 }), ...extra })
  const onChange = vi.fn()
  function Harness() {
    const [settings, setSettings] = useState(theme)
    return (
      <GlobalStylesPanel
        settings={settings}
        disabled={disabled}
        onChange={(next) => {
          setSettings(next)
          onChange(next)
        }}
      />
    )
  }
  renderWithQuery(<Harness />)
  return { user: userEvent.setup({ applyAccept: false }), onChange, fetch, last: () => onChange.mock.calls.at(-1)?.[0] as ThemeSettings }
}

describe('typography (B10)', () => {
  it('font pickers show English and Bangla samples and offer Bangla and uploaded fonts', async () => {
    const { user, last } = setup()
    expect(within(screen.getByTestId('font-sample-heading')).getByText('Welcome to our shop')).toBeInTheDocument()
    expect(within(screen.getByTestId('font-sample-heading')).getByText('আমাদের দোকানে স্বাগতম')).toHaveAttribute('lang', 'bn')
    await user.click(screen.getByRole('combobox', { name: 'Body font' }))
    expect(await screen.findByRole('group', { name: 'For English and Bangla' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^Shonar/ })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /^Noto Sans Bengali/ }))
    expect(last().typography.body_font).toBe('noto-sans-bengali')
    expect(screen.getByRole('combobox', { name: 'Body font' })).toHaveTextContent('Noto Sans Bengali')
    // Automatic Bangla text now follows the body font, which writes Bangla.
    expect(screen.getByRole('combobox', { name: 'Bangla text font' })).toHaveTextContent('Automatic (Noto Sans Bengali)')
  })

  it('Bangla fonts: automatic (null) or a chosen font; line spacing and size sliders', async () => {
    const { user, last } = setup()
    expect(screen.getByRole('combobox', { name: 'Bangla heading font' })).toHaveTextContent('Automatic (Baloo Da 2)')
    await user.click(screen.getByRole('combobox', { name: 'Bangla heading font' }))
    await user.click(await screen.findByRole('option', { name: /^Shonar/ }))
    expect(last().typography).toMatchObject({ bangla_heading_font: `custom:${UUID}`, bangla_body_font: null })
    await user.click(screen.getByRole('combobox', { name: 'Bangla heading font' }))
    await user.click(await screen.findByRole('option', { name: /^Automatic/ }))
    expect(last().typography.bangla_heading_font).toBeNull()

    fireEvent.change(screen.getByLabelText('Bangla line spacing'), { target: { value: '1.85' } })
    expect(last().typography.bangla_line_height).toBe(1.85)
    fireEvent.change(screen.getByLabelText('Bangla text size'), { target: { value: '1.1' } })
    expect(last().typography.bangla_scale).toBe(1.1)
    expect(screen.getByLabelText('Bangla text size')).toHaveAttribute('aria-valuetext', '110 %')
    // Other typography keys stay.
    expect(last().typography).toMatchObject({ heading_font: 'baloo', body_font: 'poppins', bangla_line_height: 1.85, body_size: 16 })
  })

  it('lists uploaded fonts; a font in use can’t be deleted (with the reason); an unused one is deleted after confirming', async () => {
    const deleted = vi.fn()
    const { user } = setup([shonar, spare], {
      [`DELETE /storefront/fonts/${UUID2}`]: () => {
        deleted()
        return { status: 204 }
      },
    })
    const items = await screen.findAllByTestId('custom-font')
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getByText(/Used for Bangla headings \(draft\)/)).toBeInTheDocument()
    expect(within(items[0]!).getByRole('button', { name: 'Delete Shonar' })).toBeDisabled()
    expect(within(items[0]!).getByText('Weights 400–700 · 117 KB')).toBeInTheDocument()
    expect(screen.getByText('(2 of 4)')).toBeInTheDocument()
    await user.click(within(items[1]!).getByRole('button', { name: 'Delete Spare' }))
    await user.click(await screen.findByRole('button', { name: 'Delete font' }))
    await waitFor(() => expect(deleted).toHaveBeenCalled())
  })

  it('a refused delete says where the font is used', async () => {
    const { user } = setup([spare], { [`DELETE /storefront/fonts/${UUID2}`]: fail(409, 'FONT_IN_USE', 'In use', { used_by: ['live_theme'], roles: ['body'] }) })
    await user.click(await screen.findByRole('button', { name: 'Delete Spare' }))
    await user.click(await screen.findByRole('button', { name: 'Delete font' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('“Spare” wasn’t deleted. Used for body text (live store). Choose another font there first, then delete it.')
  })

  it('uploads a woff2 font with its name and weights; checks the file first', async () => {
    let body: FormData | null = null
    const { user } = setup([], {
      'POST /storefront/fonts': (init) => {
        body = init.body as FormData
        return { status: 201, body: { success: true, data: { ...spare, name: 'Kalpurush' }, meta: { request_id: 't' } } }
      },
    })
    await screen.findByText('No fonts uploaded yet.')
    const file = screen.getByLabelText('Font file (.woff2)')
    await user.upload(file, new File(['x'], 'kalpurush.ttf', { type: 'font/ttf' }))
    expect(screen.getByLabelText('Font name')).toHaveValue('kalpurush')
    await user.click(screen.getByRole('button', { name: 'Upload font' }))
    expect(await screen.findByText(/Only WOFF2 font files/)).toBeInTheDocument()
    expect(body).toBeNull()

    await user.upload(file, new File(['wOF2'], 'kalpurush.woff2', { type: 'font/woff2' }))
    await user.clear(screen.getByLabelText('Font name'))
    await user.type(screen.getByLabelText('Font name'), 'Kalpurush')
    await user.click(screen.getByRole('combobox', { name: 'Boldest weight' }))
    await user.click(await screen.findByRole('option', { name: '700 · Bold' }))
    await user.click(screen.getByRole('button', { name: 'Upload font' }))
    await waitFor(() => expect(body).not.toBeNull())
    const sent = body as unknown as FormData
    expect(sent.get('name')).toBe('Kalpurush')
    expect(sent.get('weight_min')).toBe('400')
    expect(sent.get('weight_max')).toBe('700')
    expect((sent.get('file') as File).name).toBe('kalpurush.woff2')
    await waitFor(() => expect(screen.getByLabelText('Font name')).toHaveValue(''))
  })

  it('shows a server refusal next to the file; the upload form is hidden for people who can’t change the theme', async () => {
    const { user } = setup([], { 'POST /storefront/fonts': fail(422, 'INVALID_FONT', 'Not a font') })
    await screen.findByText('No fonts uploaded yet.')
    await user.upload(screen.getByLabelText('Font file (.woff2)'), new File(['x'], 'fake.woff2', { type: 'font/woff2' }))
    await user.click(screen.getByRole('button', { name: 'Upload font' }))
    expect(await screen.findByText(/isn’t a WOFF2 font/)).toBeInTheDocument()
  })

  it('read-only: no upload form', async () => {
    setup([spare], {}, true)
    expect(await screen.findByRole('button', { name: 'Delete Spare' })).toBeDisabled()
    expect(screen.queryByRole('group', { name: 'Upload a font' })).not.toBeInTheDocument()
  })

  it('a full store can’t upload more', async () => {
    const four = [0, 1, 2, 3].map((i) => ({ ...spare, id: `${UUID2.slice(0, -1)}${i}`, key: `custom:${UUID2.slice(0, -1)}${i}` as const, name: `Font ${i}` }))
    setup(four)
    expect(await screen.findByText(/You have 4 fonts, the most a store can have/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload font' })).toBeDisabled()
  })
})
