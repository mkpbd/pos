/**
 * Talking to a receipt printer straight from the browser: Web Serial (USB-serial / COM port
 * printers) and WebUSB (USB printers with a bulk OUT endpoint). Both need Chrome / Edge on https
 * (or localhost). The browser remembers the printer the user picked once, so later prints are
 * silent (`getPorts()` / `getDevices()`). Minimal types of our own — no @types package (POS1d).
 */

/* ------------------------------------------------------------ minimal browser types */

export type SerialPortInfoLike = { usbVendorId?: number; usbProductId?: number }

export type SerialWriterLike = {
  write(data: Uint8Array): Promise<void>
  close(): Promise<void>
  releaseLock(): void
}

export type SerialPortLike = {
  getInfo(): SerialPortInfoLike
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  readonly writable: { getWriter(): SerialWriterLike } | null
  forget?(): Promise<void>
}

export type SerialLike = {
  requestPort(options?: { filters?: { usbVendorId?: number; usbProductId?: number }[] }): Promise<SerialPortLike>
  getPorts(): Promise<SerialPortLike[]>
}

export type UsbEndpointLike = { endpointNumber: number; direction: 'in' | 'out'; type: 'bulk' | 'interrupt' | 'isochronous' }

export type UsbAlternateLike = { alternateSetting: number; interfaceClass: number; endpoints: UsbEndpointLike[] }

export type UsbInterfaceLike = { interfaceNumber: number; alternate: UsbAlternateLike | null; alternates: UsbAlternateLike[] }

export type UsbConfigurationLike = { configurationValue: number; interfaces: UsbInterfaceLike[] }

export type UsbDeviceLike = {
  readonly vendorId: number
  readonly productId: number
  readonly productName?: string | null
  readonly manufacturerName?: string | null
  readonly serialNumber?: string | null
  readonly opened: boolean
  readonly configuration: UsbConfigurationLike | null
  readonly configurations?: UsbConfigurationLike[]
  open(): Promise<void>
  close(): Promise<void>
  selectConfiguration(value: number): Promise<void>
  claimInterface(interfaceNumber: number): Promise<void>
  releaseInterface(interfaceNumber: number): Promise<void>
  selectAlternateInterface?(interfaceNumber: number, alternateSetting: number): Promise<void>
  transferOut(endpointNumber: number, data: Uint8Array): Promise<{ status: string; bytesWritten?: number }>
  forget?(): Promise<void>
}

export type UsbLike = {
  requestDevice(options: { filters: { vendorId?: number; productId?: number; classCode?: number }[] }): Promise<UsbDeviceLike>
  getDevices(): Promise<UsbDeviceLike[]>
}

type NavigatorWithDevices = { serial?: SerialLike; usb?: UsbLike }

/* ------------------------------------------------------------ feature detection */

export type PrinterConnection = 'browser' | 'usb' | 'serial'

/** The remembered printer: enough to find it again among the ports / devices the browser allows. */
export type PrinterDevice = {
  kind: 'usb' | 'serial'
  name: string
  vendorId: number | null
  productId: number | null
  serialNumber: string | null
}

function nav(): NavigatorWithDevices {
  return (typeof navigator === 'undefined' ? {} : navigator) as unknown as NavigatorWithDevices
}

function secure(): boolean {
  return typeof window === 'undefined' || window.isSecureContext !== false
}

export function serialApi(): SerialLike | null {
  const serial = nav().serial
  return secure() && serial && typeof serial.getPorts === 'function' ? serial : null
}

export function usbApi(): UsbLike | null {
  const usb = nav().usb
  return secure() && usb && typeof usb.getDevices === 'function' ? usb : null
}

/** Which direct connections this browser offers (browser print always works). */
export function directSupport(): { serial: boolean; usb: boolean } {
  return { serial: serialApi() !== null, usb: usbApi() !== null }
}

/* ------------------------------------------------------------ errors */

export class PrinterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrinterError'
  }
}

const NOT_FOUND = 'The receipt printer is not connected, or this browser no longer has permission to use it. Check the cable and power, or set it up again (Till → Receipt printer).'

/* ------------------------------------------------------------ choosing a printer (needs a click) */

const hex = (n: number | null | undefined) => (n == null ? '?' : n.toString(16).padStart(4, '0'))

export function serialDevice(port: SerialPortLike): PrinterDevice {
  const info = port.getInfo()
  const ids = info.usbVendorId != null ? ` (USB ${hex(info.usbVendorId)}:${hex(info.usbProductId)})` : ''
  return { kind: 'serial', name: `Serial port${ids}`, vendorId: info.usbVendorId ?? null, productId: info.usbProductId ?? null, serialNumber: null }
}

export function usbDevice(device: UsbDeviceLike): PrinterDevice {
  const name = [device.manufacturerName, device.productName].filter(Boolean).join(' ').trim()
  return {
    kind: 'usb',
    name: name || `USB device ${hex(device.vendorId)}:${hex(device.productId)}`,
    vendorId: device.vendorId,
    productId: device.productId,
    serialNumber: device.serialNumber ?? null,
  }
}

/** Opens the browser's port picker. Must run from a click. */
export async function requestSerialPrinter(): Promise<PrinterDevice> {
  const serial = serialApi()
  if (!serial) throw new PrinterError('This browser cannot use serial printers.')
  return serialDevice(await serial.requestPort())
}

/** Opens the browser's USB device picker. Must run from a click. */
export async function requestUsbPrinter(): Promise<PrinterDevice> {
  const usb = usbApi()
  if (!usb) throw new PrinterError('This browser cannot use USB printers.')
  return usbDevice(await usb.requestDevice({ filters: [] }))
}

/** Asks the browser to drop its permission for the printer (where it can), so it is fully forgotten. */
export async function forgetPrinter(device: PrinterDevice): Promise<void> {
  try {
    if (device.kind === 'serial') {
      const port = await findSerialPort(device)
      await port?.forget?.()
    } else {
      const found = await findUsbDevice(device)
      await found?.forget?.()
    }
  } catch {
    // Forgetting is best effort: the setting is cleared anyway.
  }
}

/* ------------------------------------------------------------ finding it again (silent) */

async function findSerialPort(device: PrinterDevice): Promise<SerialPortLike | null> {
  const serial = serialApi()
  if (!serial) return null
  const ports = await serial.getPorts()
  const same = ports.find((p) => {
    const info = p.getInfo()
    return (info.usbVendorId ?? null) === device.vendorId && (info.usbProductId ?? null) === device.productId
  })
  return same ?? (ports.length === 1 ? ports[0] ?? null : null)
}

async function findUsbDevice(device: PrinterDevice): Promise<UsbDeviceLike | null> {
  const usb = usbApi()
  if (!usb) return null
  const devices = await usb.getDevices()
  return (
    devices.find((d) => d.vendorId === device.vendorId && d.productId === device.productId && (device.serialNumber == null || d.serialNumber === device.serialNumber))
    ?? devices.find((d) => d.vendorId === device.vendorId && d.productId === device.productId)
    ?? null
  )
}

/* ------------------------------------------------------------ writing */

/** Serial: open at the baud rate, write, let the data drain, close. */
export async function writeSerial(device: PrinterDevice, data: Uint8Array, baudRate: number): Promise<void> {
  const port = await findSerialPort(device)
  if (!port) throw new PrinterError(NOT_FOUND)
  try {
    await port.open({ baudRate })
  } catch (error) {
    // Already open (an earlier job that failed half way) is fine; anything else is not.
    if (!(error instanceof Error && error.name === 'InvalidStateError')) throw new PrinterError(`The printer could not be opened: ${message(error)}`)
  }
  if (!port.writable) throw new PrinterError('The printer port is busy. Close other programs using it and try again.')
  const writer = port.writable.getWriter()
  try {
    await writer.write(data)
    await writer.close()
  } catch (error) {
    throw new PrinterError(`Printing failed: ${message(error)}`)
  } finally {
    try { writer.releaseLock() } catch { /* already released */ }
    try { await port.close() } catch { /* closing is best effort */ }
  }
}

/** Bytes per `transferOut` (some printers stall on very large transfers). */
export const USB_CHUNK = 4096

/** The interface and endpoint to print to: the first bulk OUT endpoint (printer class first). */
export function bulkOut(configuration: UsbConfigurationLike): { interfaceNumber: number; alternateSetting: number; endpointNumber: number } | null {
  const candidates = configuration.interfaces.flatMap((i) =>
    (i.alternates.length > 0 ? i.alternates : i.alternate ? [i.alternate] : []).map((a) => ({ i, a })),
  )
  // Printer class (7) interfaces first, then any other with a bulk OUT endpoint.
  candidates.sort((x, y) => Number(y.a.interfaceClass === 7) - Number(x.a.interfaceClass === 7))
  for (const { i, a } of candidates) {
    const endpoint = a.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk')
    if (endpoint) return { interfaceNumber: i.interfaceNumber, alternateSetting: a.alternateSetting, endpointNumber: endpoint.endpointNumber }
  }
  return null
}

/** WebUSB: open, pick the configuration, claim the interface with a bulk OUT endpoint, transfer, release. */
export async function writeUsb(device: PrinterDevice, data: Uint8Array): Promise<void> {
  const usb = await findUsbDevice(device)
  if (!usb) throw new PrinterError(NOT_FOUND)
  let claimed: number | null = null
  try {
    if (!usb.opened) await usb.open()
    if (!usb.configuration) await usb.selectConfiguration(usb.configurations?.[0]?.configurationValue ?? 1)
    const configuration = usb.configuration as UsbConfigurationLike | null
    const target = configuration ? bulkOut(configuration) : null
    if (!target) throw new PrinterError('This USB device has no printer output. Choose the receipt printer itself.')
    await usb.claimInterface(target.interfaceNumber)
    claimed = target.interfaceNumber
    if (target.alternateSetting !== 0 && usb.selectAlternateInterface) await usb.selectAlternateInterface(target.interfaceNumber, target.alternateSetting)
    for (let offset = 0; offset < data.length; offset += USB_CHUNK) {
      const result = await usb.transferOut(target.endpointNumber, data.subarray(offset, offset + USB_CHUNK))
      if (result.status !== 'ok') throw new PrinterError(`The printer refused the data (${result.status}).`)
    }
  } catch (error) {
    if (error instanceof PrinterError) throw error
    throw new PrinterError(`Printing failed: ${message(error)}`)
  } finally {
    if (claimed !== null) {
      try { await usb.releaseInterface(claimed) } catch { /* best effort */ }
    }
    try { await usb.close() } catch { /* best effort */ }
  }
}

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'unknown error'
}
