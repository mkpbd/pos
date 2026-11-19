/*
 * B15 privacy rules of the insights collector. Nothing is counted when the visitor asked not to be
 * tracked (Do Not Track or Global Privacy Control), and never on a staff draft preview or in the
 * editor canvas (served under /admin). The collector sets no cookie and sends no personal data.
 */

type PrivacyNavigator = Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string }
type PrivacyWindow = Window & { doNotTrack?: string }

/** Whether the visitor asked not to be tracked (DNT "1"/"yes" or GPC on). */
export function trackingRefused(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator, win: Window | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!nav) return true
  const n = nav as PrivacyNavigator
  if (n.globalPrivacyControl === true) return true
  const dnt = n.doNotTrack ?? n.msDoNotTrack ?? (win as PrivacyWindow | undefined)?.doNotTrack
  return dnt === '1' || dnt === 'yes'
}

/** A staff view that must never send: the draft preview (`?preview=draft`) or the editor canvas (/admin/…). */
export function isStaffView(location: Pick<Location, 'pathname' | 'search'> | undefined = typeof window === 'undefined' ? undefined : window.location): boolean {
  if (!location) return true
  if (location.pathname === '/admin' || location.pathname.startsWith('/admin/')) return true
  return new URLSearchParams(location.search).get('preview') === 'draft'
}
