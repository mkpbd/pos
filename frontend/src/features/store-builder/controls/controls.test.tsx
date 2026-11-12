import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Gradient, Shadow, Sides, Typography } from '@/storefront/builder/types'
import { normalizeGradient, normalizeShadow } from '@/storefront/builder/validate'
import { BorderControl, ColorControl, GradientControl, LengthControl, PaletteSwatches, ShadowControl, SpacingBox, TypographyControl, type Border } from './index'

const THEME = { primary: '#f59e0b', accent: '#6f55c2', surface: '#ffffff', text: '#5f6368' }

function Controlled<T>({ initial, children }: { initial: T; children: (value: T, set: (v: T) => void) => React.ReactNode }) {
  const [value, setValue] = useState(initial)
  return <>{children(value, setValue)}</>
}

describe('ColorControl', () => {
  function setup(props: Partial<Parameters<typeof ColorControl>[0]> = {}, initial: string | null = '#1d4ed8') {
    const onChange = vi.fn()
    render(
      <Controlled initial={initial}>
        {(value, set) => (
          <ColorControl
            label="Text colour"
            value={value}
            onChange={(v) => {
              onChange(v)
              set(v)
            }}
            themeColors={THEME}
            {...props}
          />
        )}
      </Controlled>,
    )
    return { onChange, user: userEvent.setup() }
  }

  it('shows the value and opens the editor; theme, palette and curated swatches write their value', async () => {
    const { onChange, user } = setup({ allowTokens: true, palette: [{ name: 'Mango', hex: '#FFB300' }] })
    await user.click(screen.getByRole('button', { name: 'Text colour: #1d4ed8. Change colour' }))
    await user.click(screen.getByRole('button', { name: 'Theme colour: Primary' }))
    expect(onChange).toHaveBeenLastCalledWith('theme:primary')
    expect(screen.getByRole('button', { name: 'Theme colour: Primary' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Store palette: Mango' }))
    expect(onChange).toHaveBeenLastCalledWith('#ffb300')
    await user.click(screen.getByRole('button', { name: 'Colours: Teal' }))
    expect(onChange).toHaveBeenLastCalledWith('#0f766e')
  })

  it('offers no theme swatches unless allowed', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: /Change colour/ }))
    expect(screen.queryByRole('group', { name: 'Theme colours' })).toBeNull()
  })

  it('writes typed hex and rgb values; invalid input is flagged and never written', async () => {
    const { onChange, user } = setup()
    await user.click(screen.getByRole('button', { name: /Change colour/ }))
    const hex = screen.getByLabelText('Text colour hex value')
    await user.clear(hex)
    await user.type(hex, '#C2410C')
    expect(onChange).toHaveBeenLastCalledWith('#c2410c')
    onChange.mockClear()

    await user.clear(hex)
    await user.type(hex, 'zz{Enter}')
    expect(hex).toHaveAttribute('aria-invalid', 'true')
    expect(onChange).not.toHaveBeenCalled()

    const rgb = screen.getByLabelText('Text colour RGB value')
    await user.clear(rgb)
    await user.type(rgb, 'rgb(255, 0, 0){Enter}')
    expect(onChange).toHaveBeenLastCalledWith('#ff0000')
  })

  it('refuses see-through colours without alpha; the opacity slider writes #rrggbbaa with alpha', async () => {
    const first = setup()
    await first.user.click(screen.getByRole('button', { name: /Change colour/ }))
    expect(screen.queryByLabelText('Text colour opacity')).toBeNull()
    const rgb = screen.getByLabelText('Text colour RGB value')
    await first.user.clear(rgb)
    await first.user.type(rgb, 'rgba(0, 0, 0, 0.5){Enter}')
    expect(rgb).toHaveAttribute('aria-invalid', 'true')
    expect(first.onChange).not.toHaveBeenCalled()
  })

  it('opacity slider (alpha allowed)', async () => {
    const { onChange, user } = setup({ allowAlpha: true })
    await user.click(screen.getByRole('button', { name: /Change colour/ }))
    fireEvent.change(screen.getByLabelText('Text colour opacity'), { target: { value: '50' } })
    expect(onChange).toHaveBeenLastCalledWith('#1d4ed880')
    expect(screen.getByRole('button', { name: 'Text colour: #1d4ed8 · 50 %. Change colour' })).toBeInTheDocument()
  })

  it('clears to null and shows a contrast hint', async () => {
    const { onChange, user } = setup({ allowClear: true, contrastWith: '#ffffff' }, '#eeeeee')
    expect(screen.getByTestId('contrast-hint')).toHaveTextContent('hard to read')
    await user.click(screen.getByRole('button', { name: 'Clear Text colour' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})

describe('PaletteSwatches', () => {
  it('marks the current colour and reports clicks', async () => {
    const onSelect = vi.fn()
    render(<PaletteSwatches label="Palette" colors={[{ name: 'Mango', hex: '#FFB300' }, { name: 'Ink', hex: '#111111' }]} value="#ffb300" onSelect={onSelect} />)
    expect(screen.getByRole('button', { name: 'Palette: Mango' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Palette: Ink' }))
    expect(onSelect).toHaveBeenCalledWith('#111111')
  })
})

describe('LengthControl', () => {
  function setup(props: Partial<Parameters<typeof LengthControl>[0]> = {}, initial?: string) {
    const onChange = vi.fn()
    render(
      <Controlled initial={initial}>
        {(value, set) => (
          <LengthControl
            label="Gap"
            value={value}
            onChange={(v) => {
              onChange(v)
              set(v)
            }}
            {...props}
          />
        )}
      </Controlled>,
    )
    return { onChange, user: userEvent.setup() }
  }

  it('writes number + unit, switches units and clears to undefined', async () => {
    const { onChange, user } = setup({ units: ['px', 'rem'] })
    await user.type(screen.getByLabelText('Gap'), '24')
    expect(onChange).toHaveBeenLastCalledWith('24px')
    await user.selectOptions(screen.getByLabelText('Gap unit'), 'rem')
    expect(onChange).toHaveBeenLastCalledWith('24rem')
    expect(within(screen.getByLabelText('Gap unit')).queryByRole('option', { name: '%' })).toBeNull()
    await user.clear(screen.getByLabelText('Gap'))
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it('disables invalid input: negative where not allowed, over the cap', async () => {
    const { onChange, user } = setup({ units: ['px'], max: 20 })
    await user.type(screen.getByLabelText('Gap'), '-4')
    expect(screen.getByLabelText('Gap')).toHaveAttribute('aria-invalid', 'true')
    await user.clear(screen.getByLabelText('Gap'))
    await user.type(screen.getByLabelText('Gap'), '25')
    expect(screen.getByText('Use 0 to 20 px.')).toBeInTheDocument()
    expect(onChange.mock.calls.flat().filter(Boolean)).toEqual(['2px'])
  })

  it('offers auto where allowed and arrow keys step', async () => {
    const { onChange, user } = setup({ allowAuto: true, allowNegative: true }, '0px')
    await user.selectOptions(screen.getByLabelText('Gap unit'), 'auto')
    expect(onChange).toHaveBeenLastCalledWith('auto')
    expect(screen.getByLabelText('Gap')).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Gap unit'), 'px')
    await user.type(screen.getByLabelText('Gap'), '{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith('-1px')
  })
})

describe('GradientControl', () => {
  function setup(initial?: Gradient) {
    const onChange = vi.fn()
    render(
      <Controlled initial={initial}>
        {(value, set) => (
          <GradientControl
            label="Gradient"
            value={value}
            themeColors={THEME}
            onChange={(v) => {
              onChange(v)
              set(v)
            }}
          />
        )}
      </Controlled>,
    )
    return { onChange, user: userEvent.setup(), last: () => onChange.mock.calls.at(-1)?.[0] as Gradient }
  }

  it('edits angle, stops and type; every write is a valid gradient; preview follows', async () => {
    const { user, last } = setup()
    expect(screen.getByTestId('gradient-preview').style.background).toContain('linear-gradient(135deg')
    await user.click(screen.getByRole('button', { name: 'Left to right' }))
    expect(last().angle).toBe(90)
    fireEvent.change(screen.getByLabelText('Angle in degrees'), { target: { value: '200' } })
    expect(last().angle).toBe(200)
    // Out of range: ignored.
    fireEvent.change(screen.getByLabelText('Angle in degrees'), { target: { value: '400' } })
    expect(last().angle).toBe(200)

    expect(screen.getByRole('button', { name: 'Remove colour 1' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Add colour' }))
    expect(last().stops).toHaveLength(3)
    fireEvent.change(screen.getByLabelText('Colour 2 position'), { target: { value: '30' } })
    expect(last().stops[1]!.position).toBe(30)
    await user.click(screen.getByRole('button', { name: 'Remove colour 2' }))
    expect(last().stops).toHaveLength(2)

    await user.click(screen.getByRole('radio', { name: 'Round' }))
    expect(last()).toMatchObject({ type: 'radial', shape: 'ellipse' })
    await user.click(screen.getByRole('radio', { name: 'Circle' }))
    expect(last().shape).toBe('circle')
    expect(normalizeGradient(last())).toEqual(last())
  })
})

describe('SpacingBox', () => {
  it('linked sides write all four; unlinked edits one side', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Controlled initial={{} as { margin?: Sides; padding?: Sides }}>
        {(value, set) => (
          <SpacingBox
            value={value}
            onChange={(box, sides) => {
              onChange(box, sides)
              set({ ...value, [box]: sides })
            }}
          />
        )}
      </Controlled>,
    )
    await user.type(screen.getByLabelText('Padding on all sides'), '16')
    expect(onChange).toHaveBeenLastCalledWith('padding', { top: '16px', right: '16px', bottom: '16px', left: '16px' })
    await user.click(screen.getByRole('button', { name: 'Same padding on all sides' }))
    const top = screen.getByLabelText('Padding top')
    await user.clear(top)
    await user.type(top, '40')
    expect(onChange).toHaveBeenLastCalledWith('padding', { top: '40px', right: '16px', bottom: '16px', left: '16px' })
    // Margins may be negative or auto.
    await user.selectOptions(screen.getByLabelText('Margin on all sides unit'), 'auto')
    expect(onChange).toHaveBeenLastCalledWith('margin', { top: 'auto', right: 'auto', bottom: 'auto', left: 'auto' })
  })
})

describe('ShadowControl', () => {
  it('presets, custom layers (≤ 3), text shadows without spread', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const view = render(
      <Controlled initial={undefined as Shadow[] | undefined}>
        {(value, set) => (
          <ShadowControl
            label="Shadow"
            value={value}
            onChange={(v) => {
              onChange(v)
              set(v)
            }}
          />
        )}
      </Controlled>,
    )
    await user.click(screen.getByRole('radio', { name: 'Soft' }))
    expect(onChange.mock.calls.at(-1)?.[0]).toHaveLength(2)
    await user.click(screen.getByRole('radio', { name: 'None' }))
    expect(onChange).toHaveBeenLastCalledWith([])
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    expect(screen.getByTestId('shadow-layer-0')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Layer 1 blur'), { target: { value: '30' } })
    const last = onChange.mock.calls.at(-1)?.[0] as Shadow[]
    expect(last[0]!.blur).toBe(30)
    await user.click(screen.getByRole('button', { name: 'Add layer' }))
    expect(screen.getByRole('button', { name: 'Add layer' })).toBeDisabled()
    for (const s of onChange.mock.calls.at(-1)![0] as Shadow[]) expect(normalizeShadow(s)).toEqual(s)
    view.unmount()

    render(<ShadowControl text label="Text shadow" value={[{ x: 0, y: 1, blur: 1, spread: 0, color: '#000000', inset: false }]} onChange={onChange} />)
    expect(screen.queryByLabelText('Layer 1 spread')).toBeNull()
    expect(screen.queryByLabelText('Layer 1 inside')).toBeNull()
  })
})

describe('TypographyControl and BorderControl', () => {
  it('reports one key per change', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TypographyControl value={{ size: '18px' } as Typography} onChange={onChange} />)
    await user.selectOptions(screen.getByLabelText('Weight'), '700')
    expect(onChange).toHaveBeenLastCalledWith('weight', 700)
    await user.click(screen.getByRole('radio', { name: 'Align centre' }))
    expect(onChange).toHaveBeenLastCalledWith('align', 'center')
    await user.click(screen.getByRole('radio', { name: 'ALL CAPITALS' }))
    expect(onChange).toHaveBeenLastCalledWith('transform', 'uppercase')
    expect(screen.getByLabelText('Text size')).toHaveValue('18')
  })

  it('border width is capped at 20 px; corners link and unlink', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<BorderControl value={{ radius: { tl: '8px', tr: '8px', br: '8px', bl: '8px' } } as Border} onChange={onChange} />)
    expect(within(screen.getByLabelText('Line width unit')).getAllByRole('option').map((o) => o.textContent)).toEqual(['px'])
    await user.type(screen.getByLabelText('Line width'), '30')
    expect(onChange).toHaveBeenLastCalledWith('width', '3px')
    const all = screen.getByLabelText('Rounding on all corners')
    expect(all).toHaveValue('8')
    await user.click(screen.getByRole('button', { name: 'Same rounding on all corners' }))
    await user.clear(screen.getByLabelText('Top left rounding'))
    await user.type(screen.getByLabelText('Top left rounding'), '2')
    expect(onChange).toHaveBeenLastCalledWith('radius', { tl: '2px', tr: '8px', br: '8px', bl: '8px' })
  })
})
