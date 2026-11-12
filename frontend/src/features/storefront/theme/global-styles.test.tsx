import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ThemeSettings } from '@/features/storefront/api'
import { GlobalStylesPanel } from './global-styles'

/** A theme from before B3: no roles, no type scale, no palette. */
const legacy: ThemeSettings = {
  colors: { primary: '#f59e0b', primary_foreground: '#3b2500', accent: '#6f55c2', accent_foreground: '#ffffff', highlight: '#2fb79a', sale: '#c2410c', heading: '#3d3d3d', text: '#5f6368', canvas: '#f3f7fa', surface: '#ffffff', border: '#e1e1e1' },
  typography: { heading_font: 'baloo', body_font: 'poppins' },
  shape: { button_style: 'pill', card_radius: 12 },
  layout: { container_width: 1170, sticky_header: true },
  logo_media_id: null,
  favicon_media_id: null,
  announcement: { enabled: false, text: null, link: null, background: '#6f55c2', foreground: '#ffffff', starts_at: null, ends_at: null },
  footer: { about: null, copyright: null, contact: { email: null, phone: null, address: null }, social: { facebook: null, instagram: null, youtube: null, tiktok: null, x: null, linkedin: null }, payment_logo_media_ids: [] },
}

function Harness({ initial = legacy, onChange, disabled, errors }: { initial?: ThemeSettings; onChange?: (next: ThemeSettings) => void; disabled?: boolean; errors?: Record<string, string> }) {
  const [settings, setSettings] = useState(initial)
  return (
    <GlobalStylesPanel
      settings={settings}
      disabled={disabled}
      errors={errors}
      onChange={(next) => {
        setSettings(next)
        onChange?.(next)
      }}
    />
  )
}

const last = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)?.[0] as ThemeSettings

async function setHex(user: ReturnType<typeof userEvent.setup>, label: string, hex: string) {
  await user.click(screen.getByRole('button', { name: new RegExp(`^${label}: `) }))
  const input = await screen.findByLabelText(`${label} hex value`)
  await user.clear(input)
  await user.type(input, hex)
  await user.keyboard('{Escape}')
}

describe('GlobalStylesPanel', () => {
  it('shows every colour role with plain labels; buttons follow the primary colour until set on their own', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    for (const label of ['Primary', 'Secondary', 'Background', 'Surface', 'Text', 'Heading', 'Button', 'Button text', 'Button hover', 'Border', 'Link', 'Sale badge', 'Highlight']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}: `) })).toBeInTheDocument()
    }
    // A theme from before B3: the roles follow their source colours.
    expect(screen.getByRole('button', { name: /^Button: Same as Primary/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Button hover: Automatic/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Link: Same as Secondary/ })).toBeInTheDocument()

    await setHex(user, 'Button', '#1d4ed8')
    expect(last(onChange).colors).toMatchObject({ button: '#1d4ed8', primary: '#f59e0b' })
    // Changing the primary now leaves the button alone; clearing it goes back to "same as".
    await setHex(user, 'Primary', '#0f766e')
    expect(last(onChange).colors).toMatchObject({ primary: '#0f766e', button: '#1d4ed8' })
    await user.click(screen.getByRole('button', { name: 'Clear Button' }))
    expect(last(onChange).colors.button).toBeNull()
    // Text colours show their readability.
    expect(within(screen.getByTestId('role-text')).getByTestId('contrast-hint')).toHaveTextContent(/Contrast 6\.\d:1/)
    expect(screen.getByRole('list', { name: 'Contrast checks' })).toHaveTextContent('Button text on button')
  })

  it('applies a predefined palette in one click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    const palettes = screen.getByRole('group', { name: 'Colour palettes' })
    expect(within(palettes).getAllByRole('button')).toHaveLength(8)
    await user.click(within(palettes).getByRole('button', { name: 'Use the Ocean Blue palette' }))
    expect(last(onChange).colors).toMatchObject({ primary: '#1d4ed8', accent: '#0e7490', button: '#1d4ed8', link: '#0e7490', button_hover: null })
    expect(within(palettes).getByRole('button', { name: 'Use the Ocean Blue palette' })).toHaveAttribute('aria-pressed', 'true')
    // Fonts and shape stay.
    expect(last(onChange).typography).toMatchObject({ heading_font: 'baloo', body_font: 'poppins' })
  })

  it('edits the store palette: add, rename, remove, up to eight colours', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    expect(screen.getByText('No saved colours yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add colour' }))
    expect(last(onChange).palette).toEqual([{ name: 'Colour 1', hex: '#f59e0b' }])
    const name = screen.getByLabelText('Colour 1 name')
    await user.clear(name)
    await user.type(name, 'Mango')
    expect(last(onChange).palette).toEqual([{ name: 'Mango', hex: '#f59e0b' }])
    await setHex(user, 'Colour 1', '#123456')
    expect(last(onChange).palette).toEqual([{ name: 'Mango', hex: '#123456' }])

    for (let i = 0; i < 7; i++) await user.click(screen.getByRole('button', { name: 'Add colour' }))
    expect(last(onChange).palette).toHaveLength(8)
    expect(screen.getByRole('button', { name: 'Add colour' })).toBeDisabled()
    expect(screen.getByText('The palette is full (8 colours).')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove Mango' }))
    expect(last(onChange).palette).toHaveLength(7)
    expect(last(onChange).palette?.[0]?.name).toBe('Colour 2')
    // Saved colours are offered in the colour pickers.
    await user.click(screen.getByRole('button', { name: /^Heading: / }))
    expect(await screen.findByRole('group', { name: 'Store palette' })).toBeInTheDocument()
  })

  it('edits the type scale with a live preview of the sizes; reset brings back the defaults', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    const sizes = screen.getByRole('table', { name: 'Text sizes' })
    expect(within(sizes).getByRole('row', { name: /Page & section titles/ })).toHaveTextContent('36 px30 px')
    expect(screen.getByRole('button', { name: /Reset sizes/ })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Body text size'), { target: { value: '18' } })
    expect(last(onChange).typography).toMatchObject({ body_size: 18, heading_scale: 1.25, line_height: 1.5 })
    expect(within(sizes).getByRole('row', { name: /Body text/ })).toHaveTextContent('18 px')
    expect(within(sizes).getByRole('row', { name: /Page & section titles/ })).toHaveTextContent('40.5 px')

    fireEvent.change(screen.getByLabelText('Heading scale'), { target: { value: '1.333' } })
    fireEvent.change(screen.getByLabelText('Headings on phones'), { target: { value: '0.9' } })
    fireEvent.change(screen.getByLabelText('Line height'), { target: { value: '1.7' } })
    fireEvent.change(screen.getByLabelText('Heading letter spacing'), { target: { value: '-0.01' } })
    expect(last(onChange).typography).toMatchObject({ heading_scale: 1.33, mobile_scale: 0.9, line_height: 1.7, letter_spacing: -0.01 })

    await user.click(screen.getByRole('combobox', { name: 'Heading weight' }))
    await user.click(await screen.findByRole('option', { name: 'Black' }))
    expect(last(onChange).typography.heading_weight).toBe(900)

    await user.click(screen.getByRole('button', { name: /Reset sizes/ }))
    expect(last(onChange).typography).toEqual({ heading_font: 'baloo', body_font: 'poppins', body_size: 16, heading_scale: 1.25, line_height: 1.5, heading_weight: 700, mobile_scale: 1, letter_spacing: 0 })
  })

  it('sets fonts, button shape and card radius', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await user.click(screen.getByRole('combobox', { name: 'Heading font' }))
    await user.click(await screen.findByRole('option', { name: 'Playfair Display (serif, elegant)' }))
    expect(last(onChange).typography.heading_font).toBe('playfair')
    await user.click(screen.getByRole('radio', { name: 'Square' }))
    expect(last(onChange).shape).toEqual({ button_style: 'square', card_radius: 12 })
    fireEvent.change(screen.getByLabelText('Card corner radius'), { target: { value: '4' } })
    expect(last(onChange).shape).toEqual({ button_style: 'square', card_radius: 4 })
  })

  it('is read-only when disabled and shows validation messages', () => {
    render(<Harness disabled errors={{ 'colors.primary': 'Use a hex colour.', 'typography.body_size': 'Too big.' }} />)
    expect(screen.getByRole('button', { name: /^Primary: / })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Use the Forest Lodge palette' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add colour' })).toBeDisabled()
    expect(screen.getByLabelText('Body text size')).toBeDisabled()
    expect(screen.getByText('Use a hex colour.')).toBeInTheDocument()
    expect(screen.getByText('Too big.')).toBeInTheDocument()
  })
})
