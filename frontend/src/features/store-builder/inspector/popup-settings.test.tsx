import { useState } from 'react'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ELEMENT_REGISTRY } from '@/storefront/builder/registry'
import type { PopupSettings } from '@/storefront/builder/types'
import { POPUP_DEFAULTS } from '@/storefront/builder/validate'
import { renderWithQuery } from '@/test/utils'
import { Inspector, type ElementsMetadata, type InspectorCommand, type InspectorDocument, type Problem } from './index'

/*
 * B8b: the Popup settings panel — the inspector of a popup document with nothing selected.
 */

const registry: ElementsMetadata = { types: [...ELEMENT_REGISTRY], limits: {}, enums: {} }

const doc = (extra: Partial<InspectorDocument> = {}): InspectorDocument => ({
  id: 'd-pop', kind: 'popup', key: 'popup:0b6f2e3c-1a2b-4c3d-8e9f-0123456789ab', title: 'Newsletter', path: null, published: { number: 2, published_at: '2026-11-10T08:00:00+00:00' }, active: false, canPublish: true, ...extra,
})

function setup(options: { settings?: Partial<PopupSettings>; document?: Partial<InspectorDocument>; problems?: Problem[]; locales?: string[] } = {}) {
  const commands = vi.fn<(command: InspectorCommand) => void>()
  function Harness() {
    const [popup, setPopup] = useState<PopupSettings>({ ...structuredClone(POPUP_DEFAULTS), ...options.settings })
    return (
      <Inspector
        content={{ schema_version: 1, sections: [], popup }}
        node={null}
        document={doc(options.document)}
        registry={registry}
        locales={options.locales ?? ['en']}
        errors={options.problems ?? []}
        onChange={() => undefined}
        onCommand={(command) => {
          commands(command)
          if (command.type === 'set-popup') setPopup(command.settings)
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
  const last = () => commands.mock.calls.map((c) => c[0]).filter((c) => c.type === 'set-popup').at(-1) as Extract<InspectorCommand, { type: 'set-popup' }> | undefined
  return { user, commands, settings: () => last()?.settings, last }
}

const choose = async (user: ReturnType<typeof userEvent.setup>, label: string, option: string) => {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('Popup settings panel', () => {
  it('shows the state on the shop and switches the popup on', async () => {
    const { user, commands } = setup()
    const panel = screen.getByTestId('popup-settings')
    expect(within(panel).getByRole('heading', { name: 'Popup settings' })).toBeInTheDocument()
    expect(screen.getByTestId('popup-panel-status')).toHaveTextContent('Switched off')
    await user.click(screen.getByRole('switch', { name: 'Show on shop' }))
    expect(commands).toHaveBeenCalledWith({ type: 'set-popup-active', active: true })
  })

  it('can’t be switched on before the first publish or without permission', () => {
    setup({ document: { published: null } })
    expect(screen.getByRole('switch', { name: 'Show on shop' })).toBeDisabled()
    expect(screen.getByText('Publish it first, then switch it on.')).toBeInTheDocument()
    expect(screen.getByTestId('popup-panel-status')).toHaveTextContent('Not published')
  })

  it('changes the layout: a corner box gets its corner and size; bars explain they move the page', async () => {
    const { user, settings } = setup()
    expect(screen.getByRole('switch', { name: 'Dim the page behind' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'Box in a corner' }))
    expect(settings()?.layout).toBe('slide_in')
    expect(screen.queryByRole('switch', { name: 'Dim the page behind' })).toBeNull()
    await choose(user, 'Corner', 'Bottom left')
    expect(settings()?.position).toBe('bottom_left')
    await user.click(screen.getByRole('radio', { name: 'Bar at the top' }))
    expect(screen.queryByRole('combobox', { name: 'Size' })).toBeNull()
    expect(screen.getByText(/Bars move the page instead of covering it/)).toBeInTheDocument()
  })

  it('trigger: on scroll asks how far; on leaving asks the phone fallback (20 s by default); a wrong number is explained', async () => {
    const { user, settings, last } = setup()
    await choose(user, 'Show it when', 'When the shopper scrolls down')
    expect(settings()?.trigger.kind).toBe('on_scroll')
    const scroll = screen.getByLabelText('After scrolling this far down (%)')
    await user.clear(scroll)
    await user.type(scroll, '95')
    expect(settings()?.trigger.scroll_percent).toBe(95)
    expect(last()?.coalesceKey).toBe('popup:scroll')
    expect(screen.getByText('Use 10–90 %.')).toBeInTheDocument()

    await choose(user, 'Show it when', 'When the shopper is about to leave')
    expect(settings()?.trigger).toMatchObject({ kind: 'on_exit', delay_seconds: 20 })
    expect(screen.getByLabelText('On phones, show after (seconds)')).toHaveValue(20)
  })

  it('frequency and the pages I choose: addresses are lower case and never the checkout', async () => {
    const { user, settings } = setup()
    await choose(user, 'How often to show it', 'Once every few days')
    expect(settings()?.frequency.kind).toBe('once_every_days')
    expect(screen.getByLabelText('Every how many days')).toHaveValue(7)

    await choose(user, 'On which pages', 'Pages I choose')
    expect(settings()?.pages).toEqual({ kind: 'paths', paths: [] })
    expect(screen.getByText('Add at least one page address.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add a page address' }))
    await user.type(screen.getByLabelText('Page address 1'), 'P/Eid-Sale')
    expect(settings()?.pages.paths).toEqual(['/p/eid-sale'])
    await user.click(screen.getByRole('button', { name: 'Add a page address' }))
    await user.type(screen.getByLabelText('Page address 2'), 'checkout')
    expect(screen.getByText('Popups never show on the cart, checkout, account or order pages.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove page address 2' }))
    expect(settings()?.pages.paths).toEqual(['/p/eid-sale'])
    await choose(user, 'On which pages', 'Home page only')
    expect(settings()?.pages).toEqual({ kind: 'home', paths: [] })
  })

  it('devices, who sees it, priority and a Bangla name for screen readers', async () => {
    const { user, settings } = setup({ locales: ['en', 'bn'] })
    await choose(user, 'On which devices', 'Phones only')
    await choose(user, 'Who sees it', 'Shoppers who are not signed in')
    expect(settings()).toMatchObject({ devices: 'mobile', audience: 'guests' })
    await user.type(screen.getByLabelText(/Name for screen readers/), 'Sign up')
    await user.click(screen.getByRole('button', { name: /বাংলা \(Bangla\)/ }))
    await user.type(screen.getByLabelText('Name for screen readers in Bangla'), 'সাইন আপ')
    expect(settings()?.translations).toEqual({ bn: { label: 'সাইন আপ' } })
  })

  it('shows the server’s problems at their fields and lists the others', () => {
    setup({
      settings: { trigger: { kind: 'on_load', delay_seconds: 5, scroll_percent: 50 } },
      problems: [
        { path: 'popup.trigger.delay_seconds', message: 'Server: use 0–120 seconds.' },
        { path: 'popup.audience', message: 'Server: choose who sees it.' },
      ],
    })
    expect(screen.getByText('Server: use 0–120 seconds.')).toBeInTheDocument()
    expect(within(screen.getByRole('alert')).getByText('Server: choose who sees it.')).toBeInTheDocument()
  })
})
