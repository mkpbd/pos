import { act, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { bootstrapFixture } from '../../test-fixtures'
import { samplePage } from '../test-payload'
import { CanvasApp } from './canvas-app'
import { envelope, readParentMessage, type ParentMessage } from './protocol'
import { createCanvasQueryClient } from './query-client'
import { mergeThemeSettings } from './theme-override'

const ORIGIN = window.location.origin

describe('draft theme on the canvas', () => {
  it('lays valid settings over the bootstrap theme and ignores the rest', () => {
    const theme = bootstrapFixture().theme
    const merged = mergeThemeSettings(theme, {
      colors: { primary: '#FF0000', accent: 'red', text: '#000;}', button_hover: null, canvas: null, unknown_role: '#123456' },
      typography: { heading_font: 'playfair', body_size: 17, evil: 'x;}body{' },
      shape: { card_radius: 4 },
      preset: 'vegan',
    })
    expect(merged.colors.primary).toBe('#ff0000')
    expect(merged.colors.accent).toBe(theme.colors.accent)
    expect(merged.colors.text).toBe(theme.colors.text)
    expect(merged.colors.canvas).toBe(theme.colors.canvas)
    expect((merged.colors as unknown as Record<string, unknown>).button_hover).toBeNull()
    expect(merged.typography).toMatchObject({ heading_font: 'playfair', body_size: 17 })
    expect((merged.typography as Record<string, unknown>).evil).toBeUndefined()
    expect(merged.shape.card_radius).toBe(4)
    expect(merged.preset).toBe('vegan')
    expect(mergeThemeSettings(theme, 'nope')).toBe(theme)
  })

  it('the `theme` message is part of protocol v1 and recolours the canvas at once', async () => {
    const message = envelope({ type: 'theme', settings: { colors: { primary: '#123456' } } } satisfies ParentMessage)
    expect(readParentMessage(new MessageEvent('message', { data: message, origin: ORIGIN, source: window }), ORIGIN, window)).toEqual(message)

    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    render(
      <QueryClientProvider client={createCanvasQueryClient()}>
        <MemoryRouter>
          <CanvasApp parent={window} origin={ORIGIN} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const send = (data: ParentMessage) => act(() => void window.dispatchEvent(new MessageEvent('message', { data: envelope(data), origin: ORIGIN, source: window })))
    const page = samplePage({ source: 'draft' })
    send({ type: 'init', bootstrap: bootstrapFixture(), locale: 'en' })
    send({ type: 'render', sections: page.sections, data: page.data, media: page.media, selection: null, hover: null, errors: [], device: 'desktop', pending: [] })
    expect(await screen.findByRole('heading', { name: 'Made fresh every morning' })).toBeInTheDocument()
    const before = document.documentElement.style.getPropertyValue('--sf-primary')
    expect(before).not.toBe('#123456')
    send({ type: 'theme', settings: { colors: { primary: '#123456' } } })
    expect(document.documentElement.style.getPropertyValue('--sf-primary')).toBe('#123456')
  })
})
