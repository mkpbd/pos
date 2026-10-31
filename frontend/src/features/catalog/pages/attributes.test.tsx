import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { toAttributeFormValues, toAttributeInput } from '@/features/catalog/attribute-form'
import type { Attribute } from '@/features/catalog/api'
import { CATALOG_MANAGER_PERMISSIONS, catalogManager, makeCurrentUser } from '@/test/fixtures'
import { fail, mockApi, ok, renderRoutes } from '@/test/utils'

const reference = {
  'GET /categories': ok([]),
  'GET /brands': ok([]),
  'GET /units': ok([]),
  'GET /tax-rates': ok([]),
}

const colour: Attribute = {
  id: 'a-1', name: 'Colour', slug: 'colour', display: 'swatch', is_filterable: true, sort_order: 0,
  values: [{ id: 'av-2', value: 'Blue', swatch_hex: '#0000ff', sort_order: 1 }, { id: 'av-1', value: 'Red', swatch_hex: '#ff0000', sort_order: 0 }],
}

const attributeManager = () => makeCurrentUser({ permissions: [...CATALOG_MANAGER_PERMISSIONS, 'attributes.manage'] })

describe('attributes', () => {
  it('orders values and only sends swatch colours for swatch attributes', () => {
    const values = toAttributeFormValues(colour)
    expect(values.values.map((v) => v.value)).toEqual(['Red', 'Blue'])
    expect(toAttributeInput(values).values).toEqual([{ id: 'av-1', value: 'Red', swatch_hex: '#ff0000' }, { id: 'av-2', value: 'Blue', swatch_hex: '#0000ff' }])
    expect(toAttributeInput({ ...values, display: 'button', slug: '' })).toMatchObject({ name: 'Colour', display: 'button', values: [{ swatch_hex: null }, { swatch_hex: null }] })
    expect(toAttributeInput({ ...values, slug: '' })).not.toHaveProperty('slug')
  })

  it('creates an attribute with ordered values', async () => {
    const user = userEvent.setup()
    let posted: unknown
    mockApi({
      'GET /auth/me': ok(attributeManager()),
      ...reference,
      'GET /attributes': ok([colour]),
      'POST /attributes': (init) => {
        posted = JSON.parse(String(init.body))
        return ok({ ...colour, id: 'a-2', name: 'Size' })
      },
    })
    renderRoutes(routes, '/catalog')

    await user.click(await screen.findByRole('tab', { name: 'Attributes' }))
    const table = await screen.findByRole('table')
    expect(within(table).getByText('Colour')).toBeInTheDocument()
    expect(within(table).getByText('Colour swatches')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New attribute' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), 'Size')
    for (const value of ['M', 'S', 'M']) {
      await user.click(within(dialog).getByRole('button', { name: 'Add value' }))
      const inputs = within(dialog).getAllByRole('textbox', { name: /^Value \d+$/ })
      await user.type(inputs[inputs.length - 1]!, value)
    }
    await user.click(within(dialog).getByRole('button', { name: 'Create attribute' }))
    expect(await within(dialog).findByText('Listed twice.')).toBeInTheDocument()
    expect(posted).toBeUndefined()

    await user.click(within(dialog).getByRole('button', { name: 'Remove value 3' }))
    await user.click(within(dialog).getByRole('button', { name: 'Move value 2 up' }))
    await user.click(within(dialog).getByRole('switch', { name: 'Filter in the shop' }))
    await user.click(within(dialog).getByRole('button', { name: 'Create attribute' }))

    await waitFor(() => expect(posted).toEqual({ name: 'Size', display: 'button', is_filterable: false, values: [{ value: 'S', swatch_hex: null }, { value: 'M', swatch_hex: null }] }))
  })

  it('edits swatch colours and deletes after confirmation', async () => {
    const user = userEvent.setup()
    let patched: { values: unknown[] } | undefined
    let deleted = false
    mockApi({
      'GET /auth/me': ok(attributeManager()),
      ...reference,
      'GET /attributes': ok([colour]),
      'PATCH /attributes/a-1': (init) => {
        patched = JSON.parse(String(init.body)) as { values: unknown[] }
        return fail(422, 'VALIDATION_FAILED', 'Invalid.', { 'values.0.value': ['This value is already used.'] })
      },
      'DELETE /attributes/a-1': () => {
        deleted = true
        return { status: 204 }
      },
    })
    renderRoutes(routes, '/catalog')

    await user.click(await screen.findByRole('tab', { name: 'Attributes' }))
    await user.click(await screen.findByRole('button', { name: 'Edit Colour' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Value 1 colour')).toHaveValue('#ff0000')
    await user.click(within(dialog).getByRole('button', { name: 'Add value' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Value 3' }), 'Green')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(patched?.values).toEqual([
      { id: 'av-1', value: 'Red', swatch_hex: '#ff0000' },
      { id: 'av-2', value: 'Blue', swatch_hex: '#0000ff' },
      { value: 'Green', swatch_hex: '#000000' },
    ]))
    expect(await within(dialog).findByText('This value is already used.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Delete Colour' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleted).toBe(true))
  })

  it('hides the tab without attributes.manage', async () => {
    mockApi({ 'GET /auth/me': ok(catalogManager()), ...reference })
    renderRoutes(routes, '/catalog')

    expect(await screen.findByRole('tab', { name: 'Units' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Attributes' })).not.toBeInTheDocument()
  })
})
