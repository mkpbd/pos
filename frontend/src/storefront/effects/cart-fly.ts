import { bumpCart, cartTarget, FLY_MS, visibleRect } from './cart-effects'

/*
 * B20 `fly` add-to-cart effect: the flight of a small copy of the product picture to the cart
 * (Web Animations, transform / opacity only, ~600 ms), then the cart's bump. Its own chunk: only
 * stores whose theme flies load it (./cart-effects.ts `loadCartFly`).
 */

const FLY_SIZE = 48

/** A point on the quadratic Bézier curve p0 → p2 bent towards p1. */
function curvePoint(t: number, p0: number, p1: number, p2: number): number {
  return (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2
}

/**
 * The flight's keyframes: from the button's centre to the cart's, arching upwards (the bend stays
 * inside the screen), shrinking and fading at the end. Transform and opacity only.
 */
export function flightKeyframes(from: { x: number; y: number }, to: { x: number; y: number }): Keyframe[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  // The bend: half-way across, above the higher end, but never above the top of the screen.
  const bendX = dx * 0.5
  const bendY = Math.max(Math.min(0, dy) - Math.min(160, 60 + Math.abs(dx) * 0.15), -from.y + FLY_SIZE / 2)
  const steps = 12
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    const x = curvePoint(t, 0, bendX, dx)
    const y = curvePoint(t, 0, bendY, dy)
    const scale = 1 - 0.7 * t * t
    return { transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`, opacity: t < 0.8 ? 1 : 1 - (t - 0.8) * 3, offset: t }
  })
}

/**
 * Flies a small copy of the picture from `from` (the button's centre, in viewport px) to the cart,
 * then bumps the cart. Without a cart on the page (or Web Animations) only the bump runs.
 */
export function flyToCart(from: { x: number; y: number }, imageUrl: string | null) {
  const target = cartTarget()
  const end = target ? visibleRect(target) : null
  if (!target || !end || typeof document.body.animate !== 'function') {
    bumpCart(target)
    return
  }
  // A cart scrolled out of view: the picture heads for the screen's edge nearest to it.
  const to = {
    x: Math.min(Math.max(end.left + end.width / 2, FLY_SIZE / 2), window.innerWidth - FLY_SIZE / 2),
    y: Math.min(Math.max(end.top + end.height / 2, FLY_SIZE / 2), window.innerHeight - FLY_SIZE / 2),
  }
  const node = document.createElement(imageUrl ? 'img' : 'span')
  if (node instanceof HTMLImageElement && imageUrl) {
    node.src = imageUrl
    node.alt = ''
    node.decoding = 'async'
  }
  node.className = 'sf-fly'
  node.setAttribute('aria-hidden', 'true')
  node.setAttribute('data-testid', 'cart-fly')
  node.style.left = `${from.x - FLY_SIZE / 2}px`
  node.style.top = `${from.y - FLY_SIZE / 2}px`
  document.body.appendChild(node)
  let done = false
  const finish = () => {
    if (done) return
    done = true
    node.remove()
    bumpCart(target)
  }
  const animation = node.animate(flightKeyframes(from, to), { duration: FLY_MS, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' })
  animation.onfinish = finish
  animation.oncancel = finish
  // Never left behind (a background tab may not finish animations).
  setTimeout(finish, FLY_MS + 400)
}
