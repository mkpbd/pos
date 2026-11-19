import { useState } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Audience } from '@/storefront/builder/audience/types'
import type { Element } from '@/storefront/builder/types'
import { ADMIN_PERMISSIONS, makeCurrentUser } from '@/test/fixtures'
import { mockApi, ok, renderWithQuery } from '@/test/utils'
import { AdvancedTab } from './advanced-tab'
import { errorMap, isInlineProblem } from './errors'
import { validateNode } from './validate'
import { WhoSeesThis } from './who-sees-this'

const DISTRICTS = [
  { id: 13, division_id: 3, name: 'Dhaka', name_bn: 'ঢাকা' },
  { id: 15, division_id: 2, name: 'Chattogram', name_bn: 'চট্টগ্রাম' },
  { id: 40, division_id: 4, name: 'Khulna', name_bn: 'খুলনা' },
]
const CAMPAIGN = { id: '6f1c2c4e-8f7d-4c1a-9a51-2b2f0d1e4a10', name: 'Eid sale', slug: 'eid-sale', utm_campaign: 'eid-sale', landing_document: null, starts_at: null, ends_at: null, status: 'active' }
const page = { pagination: { current_page: 1, per_page: 100, total: 1, last_page: 1 } }

function mock(permissions: string[] = [...ADMIN_PERMISSIONS, 'marketing.view']) {
  return mockApi({
    'GET /auth/me': ok(makeCurrentUser({ permissions })),
    'GET /geography/districts': ok(DISTRICTS),
    'GET /marketing/campaigns': ok([CAMPAIGN], page),
  })
}

function setup(initial: Audience | null = null, errors: Record<string, string> = {}) {
  const onChange = vi.fn()
  function Harness() {
    const [audience, setAudience] = useState<Audience | null>(initial)
    return (
      <WhoSeesThis
        nodeId="e_test01"
        noun="element"
        audience={audience}
        errors={errors}
        onChange={(next, opts) => {
          onChange(next, opts)
          setAudience(next)
        }}
      />
    )
  }
  const user = userEvent.setup()
  renderWithQuery(<Harness />)
  return { user, onChange, last: () => onChange.mock.calls.at(-1)?.[0] as Audience | null, lastOpts: () => onChange.mock.calls.at(-1)?.[1] }
}

async function addRule(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  await user.click(screen.getByTestId('audience-add-rule'))
  await user.click(await screen.findByRole('menuitem', { name }))
}

describe('Who sees this', () => {
  it('starts with everyone and a note that it is not for secrets', () => {
    mock()
    setup()
    expect(screen.getByTestId('audience-sentence')).toHaveTextContent('Everyone sees this element.')
    expect(screen.getByTestId('audience-not-secret')).toHaveTextContent(/not a lock.*never put secret prices or discount codes here/)
    expect(screen.getByRole('button', { name: /Show only to some shoppers/ })).toBeInTheDocument()
  })

  it('builds rules in plain words: visitor, device, cart; all / any; remove back to everyone', async () => {
    mock()
    const { user, last, lastOpts } = setup()
    await addRule(user, 'New or returning')
    expect(last()).toEqual({ match: 'all', rules: [{ kind: 'visitor', is: 'new' }], otherwise: 'hide' })
    expect(screen.getByTestId('audience-sentence')).toHaveTextContent('Only new visitors.')
    await user.click(screen.getByRole('radio', { name: /Returning visitors/ }))
    expect(last()?.rules[0]).toEqual({ kind: 'visitor', is: 'returning' })

    await addRule(user, 'Device')
    const devices = within(screen.getByRole('group', { name: 'Devices' }))
    expect(devices.getByRole('button', { name: 'Phones' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(devices.getByRole('button', { name: 'Computers' }))
    expect(last()?.rules[1]).toEqual({ kind: 'device', in: ['desktop', 'mobile'] })
    expect(screen.getByTestId('audience-sentence')).toHaveTextContent('Only returning visitors and on computers and phones.')

    await user.click(screen.getByRole('radio', { name: 'Any one is true' }))
    expect(last()?.match).toBe('any')

    await addRule(user, 'Cart value')
    const atLeast = screen.getByLabelText('At least')
    expect(atLeast).toHaveValue('1000')
    await user.clear(atLeast)
    await user.type(atLeast, '১,৫০০')
    expect(last()?.rules[2]).toEqual({ kind: 'cart', min: '1500.00', max: null })
    expect(lastOpts()).toEqual({ coalesceKey: 'e_test01:audience.2.min' })
    await user.type(screen.getByLabelText('At most'), 'abc')
    expect(screen.getByText('Type an amount like 1500 or 99.50.')).toBeInTheDocument()
    expect(last()?.rules[2]).toEqual({ kind: 'cart', min: '1500.00', max: null })
    expect(screen.getByTestId('audience-sentence')).toHaveTextContent('when the cart is ৳1,500 or more')

    await user.click(screen.getByRole('button', { name: 'Remove the device rule' }))
    expect(last()?.rules.map((r) => r.kind)).toEqual(['visitor', 'cart'])
    await user.click(screen.getByTestId('audience-clear'))
    expect(last()).toBeNull()
    expect(screen.getByTestId('audience-sentence')).toHaveTextContent('Everyone sees this element.')
  })

  it('picks districts from Geography with search and chips', async () => {
    mock()
    const { user, last } = setup()
    await addRule(user, 'District')
    expect(await screen.findByRole('checkbox', { name: /Dhaka/ })).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'Find a district' }), 'চট্ট')
    expect(screen.queryByRole('checkbox', { name: /Dhaka/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /Chattogram/ }))
    await user.clear(screen.getByRole('searchbox', { name: 'Find a district' }))
    await user.click(screen.getByRole('checkbox', { name: /Dhaka/ }))
    expect(last()?.rules[0]).toEqual({ kind: 'district', in: [15, 13] })
    expect(screen.getByTestId('audience-sentence')).toHaveTextContent('Only shoppers in Chattogram, Dhaka.')
    await user.click(within(screen.getByRole('list', { name: 'Chosen districts' })).getByRole('button', { name: 'Remove Chattogram' }))
    expect(last()?.rules[0]).toEqual({ kind: 'district', in: [13] })
  })

  it('picks a campaign or typed link values; without marketing.view only the values', async () => {
    mock()
    const { user, last } = setup()
    await addRule(user, 'Campaign')
    await user.click(await screen.findByRole('checkbox', { name: 'Eid sale' }))
    expect(last()?.rules[0]).toEqual({ kind: 'campaign', in: [CAMPAIGN.id] })
    await user.type(screen.getByLabelText('Link source'), 'Facebook, SMS')
    expect(last()?.rules[0]).toMatchObject({ utm_source: ['facebook', 'sms'] })
    expect(screen.getByTestId('audience-sentence')).toHaveTextContent('Only visitors from Eid sale, facebook or sms.')
  })

  it('without marketing.view it asks for the link values', async () => {
    mock(ADMIN_PERMISSIONS.filter((p) => p !== 'marketing.view'))
    const { user } = setup()
    await addRule(user, 'Campaign')
    expect(await screen.findByText(/You can’t see the store’s campaigns; type the link values instead/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Campaigns' })).not.toBeInTheDocument()
  })

  it('edits days and times in store time, with all day and past midnight', async () => {
    mock()
    const { user, last } = setup()
    await addRule(user, 'Day and time')
    expect(screen.getByTestId('audience-sentence')).toHaveTextContent('Only 6 PM–11 PM on Fri, Sat.')
    await user.click(screen.getByRole('button', { name: 'Thu' }))
    expect(last()?.rules[0]).toMatchObject({ days: ['thu', 'fri', 'sat'] })
    expect(await screen.findByText('Store time (Asia/Dhaka).')).toBeInTheDocument()
    const until = screen.getByLabelText('Until')
    await user.clear(until)
    await user.type(until, '02:00')
    expect(screen.getByText(/Runs past midnight/)).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'All day' }))
    expect(last()?.rules[0]).toMatchObject({ from: null, to: null })
  })

  it('shows a rule’s problem under it and caps the rules at one per kind', async () => {
    mock()
    const { user } = setup({ match: 'all', rules: [{ kind: 'district', in: [99] }], otherwise: 'hide' }, { 'audience.rules.0.in': 'Some districts no longer exist.' })
    const rule = screen.getByTestId('audience-rule-district')
    expect(within(rule).getByText('Some districts no longer exist.')).toBeInTheDocument()
    expect(await within(rule).findByRole('button', { name: 'Remove District 99' })).toBeInTheDocument()
    await user.click(screen.getByTestId('audience-add-rule'))
    expect(screen.queryByRole('menuitem', { name: 'District' })).not.toBeInTheDocument()
  })
})

describe('Who sees this in the Advanced tab', () => {
  const heading = { id: 'e_test01', type: 'heading', props: { text: 'Hi', level: 2, link: null }, style: {}, visibility: { desktop: true, tablet: true, mobile: true }, hidden: false, schedule: null, translations: {} } as unknown as Element

  it('writes `audience` on the node and drops the key for everyone', async () => {
    mock()
    const onChange = vi.fn()
    function Harness() {
      const [node, setNode] = useState<Element>(heading)
      return <AdvancedTab node={node} errors={{}} onChange={(next) => (onChange(next), setNode(next))} />
    }
    const user = userEvent.setup()
    renderWithQuery(<Harness />)
    await addRule(user, 'Language')
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({ id: 'e_test01', audience: { match: 'all', rules: [{ kind: 'language', in: ['bn'] }] } })
    await user.click(screen.getByTestId('audience-clear'))
    await waitFor(() => expect('audience' in (onChange.mock.calls.at(-1)?.[0] ?? {})).toBe(false))
  })

  it('validates the audience and maps server paths to the rule', () => {
    const node = { ...heading, audience: { match: 'all', rules: [{ kind: 'device', in: [] }], otherwise: 'hide' } } as unknown as Element
    expect(validateNode(node)).toContainEqual({ path: 'audience.rules.0.in', message: 'Pick at least one device.' })
    const server = { path: 'sections.2.columns.0.elements.1.audience.rules.0.in', message: 'Some districts no longer exist.', code: 'DISTRICT_NOT_FOUND' }
    expect(errorMap(node, [], [server])).toEqual({ 'audience.rules.0.in': 'Some districts no longer exist.' })
    expect(isInlineProblem(node, server, false)).toBe(true)
  })
})
