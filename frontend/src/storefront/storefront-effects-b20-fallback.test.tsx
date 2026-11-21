import { afterEach, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { CART_EFFECT_EVENT, playCartEffect, type CartEffectDetail } from './effects/cart-effects'

/* B20: the flight's own chunk fails to load (offline, a new deploy): the cart bumps instead, nothing breaks. */

vi.mock('./effects/cart-fly', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

it('falls back to the bump when the flight code cannot be loaded', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 10, y: 10, left: 10, top: 10, width: 40, height: 40, right: 50, bottom: 50, toJSON: () => ({}) }) as DOMRect)
  // With Web Animations a loaded flight would draw `.sf-fly` and bump only when it lands.
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, writable: true, value: () => ({ onfinish: null, oncancel: null }) })
  const button = document.createElement('button')
  const cart = document.createElement('button')
  cart.setAttribute('data-sf-cart-target', '')
  document.body.append(button, cart)
  const played: string[] = []
  const listener = (event: Event) => played.push((event as CustomEvent<CartEffectDetail>).detail.effect)
  document.addEventListener(CART_EFFECT_EVENT, listener)

  expect(() => playCartEffect({ add_to_cart: 'fly', button_feedback: true }, button, '/storage/products/cap.png')).not.toThrow()
  expect(played).toEqual(['fly'])
  // At once (a flight would land 600 ms later), and nothing flies.
  await waitFor(() => expect(cart).toHaveAttribute('data-sf-bumps', '1'), { timeout: 300 })
  expect(document.querySelector('.sf-fly')).toBeNull()

  // A failed load is not remembered: the next add tries again (and bumps again).
  playCartEffect({ add_to_cart: 'fly', button_feedback: true }, button, null)
  await waitFor(() => expect(cart).toHaveAttribute('data-sf-bumps', '2'), { timeout: 300 })
  document.removeEventListener(CART_EFFECT_EVENT, listener)
})
