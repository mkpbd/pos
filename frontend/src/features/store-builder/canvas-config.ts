import type { Device } from '@/storefront/builder/types'

/** The canvas page (builder-canvas.html; the dev middleware and production Nginx serve it here). */
export const CANVAS_URL = '/admin/builder-canvas'

export const DEVICE_WIDTHS: Record<Device, number> = { desktop: 1366, tablet: 768, mobile: 375 }
