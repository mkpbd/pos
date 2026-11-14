import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

/**
 * True once the element has scrolled up past the top of the viewport — or under a sticky header
 * `top` px tall — (its bottom above that edge); false while it is in view or still below. Without
 * IntersectionObserver: always false. The observer's root reaches far below the screen, so "not
 * intersecting" means "above the top", and a jump from below the screen straight past the element
 * (a long fling, Home / End) still reports.
 */
export function useScrolledPast(ref: RefObject<Element | null>, top = 0): boolean {
  const [past, setPast] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]
        if (!entry) return
        setPast(!entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? top) + 1)
      },
      { rootMargin: `${-Math.max(0, Math.round(top))}px 0px 1000000px 0px` },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, top])
  return past
}

/** True once the element comes within `margin` of the viewport (stays true). Without IntersectionObserver: true at once. */
export function useNearViewport(ref: RefObject<Element | null>, margin = '400px'): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const element = ref.current
    if (near || !element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true)
      },
      { rootMargin: margin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, margin, near])
  return near
}

/**
 * While `active`, the element's height is published as `--sf-quick-buy-space` on the document
 * root; the store frame pads its bottom by it (storefront.css `.sf-frame`), so a fixed bottom bar
 * never hides the end of the page.
 */
export function useBottomBarSpace(ref: RefObject<HTMLElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const element = ref.current
    if (!active || !element) return
    const root = document.documentElement
    const apply = () => root.style.setProperty('--sf-quick-buy-space', `${Math.ceil(element.getBoundingClientRect().height)}px`)
    apply()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply)
    observer?.observe(element)
    return () => {
      observer?.disconnect()
      root.style.removeProperty('--sf-quick-buy-space')
    }
  }, [ref, active])
}
