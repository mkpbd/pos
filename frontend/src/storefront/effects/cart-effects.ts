import { useContext, useEffect, useRef, useState } from 'react'
import { BootstrapContext } from '../api'
import type { AddToCartEffect, ThemeEffects } from '../types'

/*
 * B20 store-wide add-to-cart effects (theme `effects`): after a successful add from a product card,
 * the product page, quick view, the quick-buy bar or "add selected", `fly` sends a small copy of the
 * product picture on a curved path (Web Animations, transform / opacity, ~600 ms) from the button
 * to the cart in the header, then the cart bumps; `bump` only bumps the cart; `none` does neither.
 * `button_feedback` shows a brief "Added" check over the button (./added-mark.tsx) without changing
 * its size. Visitors who prefer reduced motion get no flight and no bump (the count still updates,
 * the existing live regions still announce). Nothing here waits: the mini-cart opens at once and
 * the flight passes over it. The flight itself lives in ./cart-fly.ts, loaded only by `fly` themes
 * (prefetched while idle once a buy button is on screen); should it fail to load, the cart bumps.
 */

/** Marks a cart button the picture flies to (header cart, a builder cart icon, a future bottom bar). */
export const CART_TARGET_ATTRIBUTE = 'data-sf-cart-target'
/** The event every played effect dispatches on `document` (detail: CartEffectDetail) — for tests and analytics. */
export const CART_EFFECT_EVENT = 'sf-cart-effect'
export type CartEffectDetail = { effect: AddToCartEffect }

export const FLY_MS = 600
export const BUMP_MS = 450
/** How long the "Added" check stays on the button. */
export const FEEDBACK_MS = 1400

const DEFAULT_EFFECTS: ThemeEffects = { add_to_cart: 'bump', button_feedback: true }

/** The theme's effects; anything missing or unknown = the defaults (bump, feedback on). The bootstrap always sends them resolved. */
export function resolveCartEffects(value: unknown): ThemeEffects {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_EFFECTS }
  const v = value as Record<string, unknown>
  const effect = v.add_to_cart === 'fly' || v.add_to_cart === 'bump' || v.add_to_cart === 'none' ? v.add_to_cart : DEFAULT_EFFECTS.add_to_cart
  return { add_to_cart: effect, button_feedback: typeof v.button_feedback === 'boolean' ? v.button_feedback : DEFAULT_EFFECTS.button_feedback }
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The element's box when it is drawn (null when it has no size: hidden, detached). */
export function visibleRect(element: Element): DOMRect | null {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 ? rect : null
}

/** The cart the picture flies to: the first one on screen, else the first drawn one (a header scrolled away); null when there is none. */
export function cartTarget(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const drawn = Array.from(document.querySelectorAll<HTMLElement>(`[${CART_TARGET_ATTRIBUTE}]`)).filter((element) => !element.closest('[inert]') && visibleRect(element))
  const onScreen = drawn.find((element) => {
    const rect = element.getBoundingClientRect()
    return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth
  })
  return onScreen ?? drawn[0] ?? null
}

function announce(effect: AddToCartEffect) {
  document.dispatchEvent(new CustomEvent<CartEffectDetail>(CART_EFFECT_EVENT, { detail: { effect } }))
}

/** The cart's little bump (scale up and back); counts as `data-sf-bumps` on the cart for tests. */
export function bumpCart(target: HTMLElement | null = cartTarget()) {
  if (!target) return
  target.setAttribute('data-sf-bumps', String(Number(target.getAttribute('data-sf-bumps') ?? '0') + 1))
  if (typeof target.animate !== 'function') return
  target.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22)', offset: 0.35 }, { transform: 'scale(0.94)', offset: 0.7 }, { transform: 'scale(1)' }], { duration: BUMP_MS, easing: 'ease-out' })
}

let flyModule: Promise<typeof import('./cart-fly')> | null = null

/** Loads the flight code once (a `fly` theme only); a failed load is forgotten, so a later add tries again. */
export function loadCartFly(): Promise<typeof import('./cart-fly')> {
  flyModule ??= import('./cart-fly').catch((error: unknown) => {
    flyModule = null
    throw error
  })
  return flyModule
}

/** Fetches the flight code while the browser is idle (buy buttons of a `fly` theme are on the page). */
export function prefetchCartFly() {
  if (flyModule || typeof window === 'undefined') return
  const load = () => void loadCartFly().catch(() => {})
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(load, { timeout: 3000 })
  else setTimeout(load, 1500)
}

/**
 * Plays the theme's add-to-cart effect for a successful add from `source` (reduced motion: none).
 * The flight starts where the button is now (measured before anything loads or closes, e.g. the
 * quick view); without the flight code (a failed load) the cart just bumps.
 */
export function playCartEffect(effects: ThemeEffects, source: HTMLElement | null, imageUrl: string | null = null) {
  if (typeof document === 'undefined') return
  const requested: AddToCartEffect = reducedMotion() ? 'none' : effects.add_to_cart
  const start = requested === 'fly' && source ? visibleRect(source) : null
  const effect: AddToCartEffect = requested === 'fly' && !start ? 'bump' : requested
  if (effect === 'fly' && start) {
    const from = { x: start.left + start.width / 2, y: start.top + start.height / 2 }
    loadCartFly().then(
      (module) => module.flyToCart(from, imageUrl),
      () => bumpCart(),
    )
  } else if (effect === 'bump') bumpCart()
  announce(effect)
}

/** The theme's effects where a storefront bootstrap is present (the defaults elsewhere, e.g. the editor). */
export function useCartEffectsConfig(): ThemeEffects {
  const bootstrap = useContext(BootstrapContext)
  return resolveCartEffects(bootstrap?.theme.effects)
}

/**
 * What a buy button calls after a successful add: plays the flight / bump and, with
 * `button_feedback`, shows the "Added" check for a moment on the button that added (`addedOn(key)`;
 * one hook may serve several buttons, e.g. the product form and its quick-buy bar).
 */
export function useCartEffects() {
  const effects = useCartEffectsConfig()
  const [added, setAdded] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fly = effects.add_to_cart === 'fly'
  useEffect(() => {
    if (fly) prefetchCartFly()
  }, [fly])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const celebrate = (source: HTMLElement | null, imageUrl: string | null = null, key = 'default') => {
    playCartEffect(effects, source, imageUrl)
    if (!effects.button_feedback) return
    setAdded(key)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setAdded(null), FEEDBACK_MS)
  }
  return { addedOn: (key = 'default') => added === key, celebrate }
}
