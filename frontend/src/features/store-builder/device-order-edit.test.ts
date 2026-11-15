import { cloneSample } from '@/storefront/builder/test-payload'
import { DEVICE_ORDER_ROOT } from '@/storefront/builder/device-order'
import {
  canMoveInDeviceOrder,
  containerChildIds,
  deviceOrderOf,
  hasOwnOrder,
  moveInDeviceOrder,
  orderContainerOf,
  placeInDeviceOrder,
  resetDeviceOrder,
  resetTarget,
  setDeviceOrder,
} from './device-order-edit'

const BASE = ['s_hero', 's_story', 's_features', 's_products', 's_hidden']

describe('device order editing (B12 §4)', () => {
  it('finds containers: the page for sections, the column for elements, none for columns', () => {
    const content = cloneSample()
    expect(orderContainerOf(content, 's_story')).toEqual({ containerId: DEVICE_ORDER_ROOT, childIds: BASE })
    expect(orderContainerOf(content, 'e_text')).toEqual({ containerId: 'c_story_text', childIds: ['e_heading', 'e_text', 'e_button'] })
    expect(orderContainerOf(content, 'e_spacer')?.containerId).toBe('c_feat_b')
    expect(orderContainerOf(content, 'c_story_text')).toBeNull()
    expect(orderContainerOf(content, 'nope')).toBeNull()
    expect(containerChildIds(content, 's_story')).toBeNull()
  })

  it('moves on a phone without touching the desktop order; moving back clears the list', () => {
    const content = cloneSample()
    const moved = moveInDeviceOrder(content, 'mobile', 's_products', -1)
    expect(moved.sections.map((s) => s.id)).toEqual(BASE)
    expect(moved.device_order).toEqual({ mobile: { root: ['s_hero', 's_story', 's_products', 's_features', 's_hidden'] } })
    expect(hasOwnOrder(moved, 'mobile', 'root')).toBe(true)
    expect(hasOwnOrder(moved, 'tablet', 'root')).toBe(false)
    const back = moveInDeviceOrder(moved, 'mobile', 's_products', 1)
    expect(back.device_order).toBeUndefined()
  })

  it('does nothing on desktop, for columns and at the ends', () => {
    const content = cloneSample()
    expect(moveInDeviceOrder(content, 'desktop', 's_story', -1)).toBe(content)
    expect(moveInDeviceOrder(content, 'tablet', 'c_story_text', 1)).toBe(content)
    expect(moveInDeviceOrder(content, 'tablet', 's_hero', -1)).toBe(content)
    expect(canMoveInDeviceOrder(content, 'tablet', 's_hidden', 1)).toBe(false)
    expect(canMoveInDeviceOrder(content, 'tablet', 's_hidden', -1)).toBe(true)
  })

  it('moves several items as a block inside their column', () => {
    const content = cloneSample()
    const moved = moveInDeviceOrder(content, 'tablet', ['e_heading', 'e_text'], 1)
    expect(deviceOrderOf(moved, 'tablet', 'c_story_text')).toEqual(['e_button', 'e_heading', 'e_text'])
    // Phones inherit the tablet order.
    expect(deviceOrderOf(moved, 'mobile', 'c_story_text')).toEqual(['e_button', 'e_heading', 'e_text'])
    expect(deviceOrderOf(moved, 'desktop', 'c_story_text')).toEqual(['e_heading', 'e_text', 'e_button'])
  })

  it('normalizes like the server: unknown ids dropped, missing ones appended, equal to inherited → removed', () => {
    const content = cloneSample()
    const set = setDeviceOrder(content, 'tablet', 'root', ['s_products', 'zzz', 's_products'])
    expect(set.device_order?.tablet?.root).toEqual(['s_products', 's_hero', 's_story', 's_features', 's_hidden'])
    // Phones: a list equal to the tablet's order is not kept.
    expect(setDeviceOrder(set, 'mobile', 'root', set.device_order!.tablet!.root!)).toBe(set)
    // Tablet back to desktop: the tablet list goes.
    expect(setDeviceOrder(set, 'tablet', 'root', BASE).device_order).toBeUndefined()
    // Containers with fewer than two children never keep a list.
    expect(setDeviceOrder(content, 'tablet', 'c_hero', ['e_slider'])).toBe(content)
    expect(setDeviceOrder(content, 'tablet', 'unknown', ['a'])).toBe(content)
  })

  it('drops a phone list that becomes equal to the tablet order', () => {
    let content = cloneSample()
    content = moveInDeviceOrder(content, 'mobile', 's_products', -1)
    content = moveInDeviceOrder(content, 'tablet', 's_products', -1)
    expect(content.device_order).toEqual({ tablet: { root: ['s_hero', 's_story', 's_products', 's_features', 's_hidden'] } })
  })

  it('resets: "Same as computer" deletes the entry; phones then follow a tablet order', () => {
    let content = cloneSample()
    content = moveInDeviceOrder(content, 'tablet', 's_hidden', -1)
    content = moveInDeviceOrder(content, 'mobile', 's_hero', 1)
    expect(resetTarget(content, 'mobile', 'root')).toBe('tablet')
    expect(resetTarget(content, 'tablet', 'root')).toBe('desktop')
    const phones = resetDeviceOrder(content, 'mobile', 'root')
    expect(phones.device_order?.mobile).toBeUndefined()
    expect(deviceOrderOf(phones, 'mobile', 'root')).toEqual(deviceOrderOf(phones, 'tablet', 'root'))
    const tablets = resetDeviceOrder(phones, 'tablet', 'root')
    expect(tablets.device_order).toBeUndefined()
    expect(resetDeviceOrder(tablets, 'tablet', 'root')).toBe(tablets)
  })

  it('places a dragged item at a position', () => {
    const content = cloneSample()
    const placed = placeInDeviceOrder(content, 'mobile', 'c_story_text', 'e_button', 0)
    expect(deviceOrderOf(placed, 'mobile', 'c_story_text')).toEqual(['e_button', 'e_heading', 'e_text'])
    expect(placeInDeviceOrder(content, 'mobile', 'c_story_text', 'nope', 0)).toBe(content)
  })
})
