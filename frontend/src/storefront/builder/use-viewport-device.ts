import { useMediaQuery } from '../components/use-media-query'
import { MOBILE_QUERY, TABLET_QUERY } from './compile-styles'
import type { Device } from './types'

/**
 * B12: the builder device the viewport matches, by the same breakpoints the compiled styles use
 * (tablet ≤ 1023 px, mobile ≤ 639 px), kept in step with resizes and rotation. Without matchMedia
 * (and in a server snapshot) it is `desktop`, so the first paint falls back to the base order.
 */
export function useViewportDevice(): Device {
  const tablet = useMediaQuery(TABLET_QUERY)
  const mobile = useMediaQuery(MOBILE_QUERY)
  return mobile ? 'mobile' : tablet ? 'tablet' : 'desktop'
}
