import { useCallback, useSyncExternalStore } from 'react'

/** Tailwind's `lg` breakpoint (64rem): the desktop header, top bar and navigation. */
export const DESKTOP_QUERY = '(min-width: 64rem)'

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function mediaQueryList(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null
}

/** Whether a media query matches, kept in step with the viewport (no first-render flash: read synchronously). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = mediaQueryList(query)
      list?.addEventListener?.('change', onChange)
      return () => list?.removeEventListener?.('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => mediaQueryList(query)?.matches ?? false, () => false)
}

/** Desktop layout (≥ lg). Header and top-bar variants are desktop-only; smaller screens keep the standard mobile header. */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY)
}
