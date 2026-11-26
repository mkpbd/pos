import { useSyncExternalStore } from 'react'
import type { CodePage } from '@/lib/escpos/code-pages'
import type { PaperWidth, RasterMode } from '@/lib/escpos/document'
import type { DrawerPin } from '@/lib/escpos/encoder'
import type { PrinterConnection, PrinterDevice } from '@/lib/escpos/transports'

/** POS1d: this device's receipt printer (kept in localStorage, like the receipt format). */
export type PrinterSettings = {
  connection: PrinterConnection
  /** The printer picked once in the browser's chooser (USB / serial). */
  device: PrinterDevice | null
  /** Serial only. */
  baudRate: number
  /** Characters per line: 32 (58 mm), 42, 48 (80 mm). */
  paper: PaperWidth
  codePage: CodePage
  raster: RasterMode
  cut: boolean
  /** Kick the drawer after a sale that took cash (or an exchange that paid cash back). */
  openDrawer: boolean
  drawerPin: DrawerPin
  copies: 1 | 2
  /** Print the receipt by itself when a sale completes. */
  autoPrint: boolean
}

export const PRINTER_SETTINGS_KEY = 'pos-printer'

export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200] as const

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  connection: 'browser',
  device: null,
  baudRate: 9600,
  paper: 48,
  codePage: 'cp1252',
  raster: 'auto',
  cut: true,
  openDrawer: true,
  drawerPin: 2,
  copies: 1,
  autoPrint: true,
}

const oneOf = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback)

function sanitize(value: unknown): PrinterSettings {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const d = DEFAULT_PRINTER_SETTINGS
  const device = v.device as Record<string, unknown> | null | undefined
  const validDevice =
    device && (device.kind === 'usb' || device.kind === 'serial') && typeof device.name === 'string'
      ? {
          kind: device.kind,
          name: device.name,
          vendorId: typeof device.vendorId === 'number' ? device.vendorId : null,
          productId: typeof device.productId === 'number' ? device.productId : null,
          serialNumber: typeof device.serialNumber === 'string' ? device.serialNumber : null,
        } satisfies PrinterDevice
      : null
  const connection = oneOf<PrinterConnection>(v.connection, ['browser', 'usb', 'serial'], d.connection)
  return {
    connection,
    device: validDevice && validDevice.kind === connection ? validDevice : null,
    baudRate: oneOf<number>(v.baudRate, BAUD_RATES, d.baudRate),
    paper: oneOf<PaperWidth>(v.paper, [32, 42, 48], d.paper),
    codePage: oneOf<CodePage>(v.codePage, ['cp1252', 'cp437'], d.codePage),
    raster: oneOf<RasterMode>(v.raster, ['auto', 'always'], d.raster),
    cut: typeof v.cut === 'boolean' ? v.cut : d.cut,
    openDrawer: typeof v.openDrawer === 'boolean' ? v.openDrawer : d.openDrawer,
    drawerPin: oneOf<DrawerPin>(v.drawerPin, [2, 5], d.drawerPin),
    copies: oneOf<1 | 2>(v.copies, [1, 2], d.copies),
    autoPrint: typeof v.autoPrint === 'boolean' ? v.autoPrint : d.autoPrint,
  }
}

let cached: { raw: string | null; settings: PrinterSettings } | null = null

export function loadPrinterSettings(): PrinterSettings {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(PRINTER_SETTINGS_KEY)
  } catch {
    raw = null
  }
  if (cached && cached.raw === raw) return cached.settings
  let parsed: unknown = null
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = null
  }
  cached = { raw, settings: sanitize(parsed) }
  return cached.settings
}

const listeners = new Set<() => void>()

export function savePrinterSettings(settings: PrinterSettings): void {
  try {
    localStorage.setItem(PRINTER_SETTINGS_KEY, JSON.stringify(sanitize(settings)))
  } catch {
    // Storage unavailable: the settings last for this page only.
    cached = { raw: null, settings: sanitize(settings) }
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => { if (e.key === PRINTER_SETTINGS_KEY) listener() }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** The printer settings of this device, updated when they are saved. */
export function usePrinterSettings(): PrinterSettings {
  return useSyncExternalStore(subscribe, loadPrinterSettings, loadPrinterSettings)
}

/** A USB / serial printer is set up (printing and the drawer kick go straight to it). */
export function hasDirectPrinter(settings: PrinterSettings): boolean {
  return settings.connection !== 'browser' && settings.device !== null
}
