import { drawerKick, renderDocument, type PrintBlock } from '@/lib/escpos/document'
import { PrinterError, writeSerial, writeUsb } from '@/lib/escpos/transports'
import type { CreateCanvas } from '@/lib/escpos/raster'
import { hasDirectPrinter, type PrinterSettings } from '@/features/pos/printing/printer-settings'

/** One job at a time: a drawer kick and a receipt must not open the port together. */
let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job)
  queue = next.catch(() => undefined)
  return next
}

/** Test hook: the canvas used to draw raster receipts (the page's canvas by default). */
let canvasFactory: CreateCanvas | undefined
export function setPrinterCanvasFactory(factory: CreateCanvas | undefined): void {
  canvasFactory = factory
}

function send(settings: PrinterSettings, data: Uint8Array): Promise<void> {
  const device = settings.device
  if (!hasDirectPrinter(settings) || !device) return Promise.reject(new PrinterError('No receipt printer is set up on this device.'))
  return enqueue(() => (device.kind === 'serial' ? writeSerial(device, data, settings.baudRate) : writeUsb(device, data)))
}

/** The bytes of a print job with this device's settings (`kick`: open the drawer first). */
export function printJobBytes(blocks: PrintBlock[], settings: PrinterSettings, kick: boolean): Uint8Array {
  return renderDocument(blocks, {
    width: settings.paper,
    codePage: settings.codePage,
    raster: settings.raster,
    cut: settings.cut,
    copies: settings.copies,
    drawerPin: kick ? settings.drawerPin : null,
    createCanvas: canvasFactory,
  })
}

/** Prints on the USB / serial printer; `kick` also opens the cash drawer wired to it. */
export async function printOnPrinter(blocks: PrintBlock[], settings: PrinterSettings, kick = false): Promise<void> {
  let data: Uint8Array
  try {
    data = printJobBytes(blocks, settings, kick)
  } catch (error) {
    throw new PrinterError(error instanceof Error ? error.message : 'The receipt could not be prepared for the printer.')
  }
  await send(settings, data)
}

/** Opens the cash drawer through the printer (no paper moves). */
export function kickDrawer(settings: PrinterSettings): Promise<void> {
  return send(settings, drawerKick(settings.drawerPin))
}

/** Receipts already printed by themselves this session (a dialog re-mounting must not print again). */
const autoPrinted = new Set<string>()

/** True the first time for `key`; false afterwards. */
export function claimAutoPrint(key: string): boolean {
  if (autoPrinted.has(key)) return false
  autoPrinted.add(key)
  return true
}

/** Test hook. */
export function resetAutoPrints(): void {
  autoPrinted.clear()
}
