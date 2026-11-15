import { cloneSample } from '@/storefront/builder/test-payload'
import { moveInDeviceOrder } from './device-order-edit'
import { flattenLayers, layerDropSpot, layerRange } from './layers'

const ids = (rows: ReturnType<typeof flattenLayers>, kind?: string) => rows.filter((r) => !kind || r.kind === kind).map((r) => r.node.id)

describe('Layers rows (B12)', () => {
  it('lists sections and column elements in the device’s order; columns keep theirs', () => {
    let content = cloneSample()
    content = moveInDeviceOrder(content, 'mobile', 's_products', -1)
    content = moveInDeviceOrder(content, 'tablet', 'e_button', -1)
    expect(ids(flattenLayers(content), 'section')).toEqual(['s_hero', 's_story', 's_features', 's_products', 's_hidden'])
    expect(ids(flattenLayers(content, 'mobile'), 'section')).toEqual(['s_hero', 's_story', 's_products', 's_features', 's_hidden'])
    // Phones inherit the tablet's element order.
    const phone = flattenLayers(content, 'mobile')
    expect(phone.filter((r) => r.parentId === 'c_story_text').map((r) => [r.node.id, r.index])).toEqual([
      ['e_heading', 0],
      ['e_button', 1],
      ['e_text', 2],
    ])
    expect(phone.find((r) => r.node.id === 'c_story_text')).toMatchObject({ containerId: null, parentId: 's_story' })
    expect(phone.find((r) => r.node.id === 's_story')).toMatchObject({ containerId: 'root', parentId: null })
  })

  it('Shift ranges follow the order shown, among siblings only', () => {
    let content = cloneSample()
    content = moveInDeviceOrder(content, 'mobile', 'e_button', -1)
    const rows = flattenLayers(content, 'mobile')
    expect(layerRange(rows, 'e_heading', 'e_button')).toEqual(['e_heading', 'e_button'])
    expect(layerRange(flattenLayers(content), 'e_heading', 'e_button')).toEqual(['e_heading', 'e_text', 'e_button'])
    expect(layerRange(rows, 'e_heading', 'e_image')).toBeNull()
    expect(layerRange(rows, 's_products', 's_story')).toEqual(['s_story', 's_features', 's_products'])
  })

  it('drop spots: on the row (upper / lower half) or anything inside it; other containers are no target', () => {
    const rows = flattenLayers(cloneSample(), 'mobile')
    expect(layerDropSpot(rows, 's_products', 's_story', true)).toEqual({ targetId: 's_story', position: 'before', indicatorRowId: 's_story', index: 1, containerId: 'root' })
    // Over an element inside a section above the dragged one: before that section.
    expect(layerDropSpot(rows, 's_products', 'e_text', false)).toMatchObject({ targetId: 's_story', position: 'before', index: 1 })
    // Below the dragged one: after it, the line under its last row.
    expect(layerDropSpot(rows, 's_hero', 'e_feat_a', true)).toMatchObject({ targetId: 's_features', position: 'after', indicatorRowId: 'c_feat_c', index: 2 })
    expect(layerDropSpot(rows, 'e_heading', 'e_button', false)).toMatchObject({ targetId: 'e_button', position: 'after', index: 2, containerId: 'c_story_text' })
    expect(layerDropSpot(rows, 'e_heading', 'e_image', true)).toBeNull()
    expect(layerDropSpot(rows, 'e_heading', 'c_story_text', true)).toBeNull()
    expect(layerDropSpot(rows, 'c_story_text', 'c_story_media', true)).toBeNull()
    expect(layerDropSpot(rows, 's_hero', 's_hero', true)).toBeNull()
  })
})
