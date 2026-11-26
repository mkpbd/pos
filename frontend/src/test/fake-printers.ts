import type { SerialLike, SerialPortLike, UsbConfigurationLike, UsbDeviceLike, UsbLike } from '@/lib/escpos/transports'

/**
 * Test doubles of `navigator.serial` / `navigator.usb` (vitest): they record every byte written
 * and the calls made, so tests can assert exact printer output.
 */
export type FakeSerialPort = SerialPortLike & { writes: Uint8Array[]; opened: number; closed: number; failWrite: Error | null }

export function fakeSerialPort(info: { usbVendorId?: number; usbProductId?: number } = { usbVendorId: 0x0416, usbProductId: 0x5011 }): FakeSerialPort {
  let isOpen = false
  const port: FakeSerialPort = {
    writes: [],
    opened: 0,
    closed: 0,
    failWrite: null,
    getInfo: () => info,
    open: async () => {
      if (isOpen) throw Object.assign(new Error('The port is already open.'), { name: 'InvalidStateError' })
      isOpen = true
      port.opened++
    },
    close: async () => {
      isOpen = false
      port.closed++
    },
    get writable() {
      if (!isOpen) return null
      return {
        getWriter: () => ({
          write: async (data: Uint8Array) => {
            if (port.failWrite) throw port.failWrite
            port.writes.push(Uint8Array.from(data))
          },
          close: async () => {},
          releaseLock: () => {},
        }),
      }
    },
    forget: async () => {},
  }
  return port
}

export function fakeSerial(ports: SerialPortLike[], chosen: SerialPortLike | null = ports[0] ?? null): SerialLike & { requests: number } {
  const serial = {
    requests: 0,
    requestPort: async () => {
      serial.requests++
      if (!chosen) throw Object.assign(new Error('No port selected by the user.'), { name: 'NotFoundError' })
      if (!ports.includes(chosen)) ports.push(chosen)
      return chosen
    },
    getPorts: async () => ports,
  }
  return serial
}

export type FakeUsbDevice = UsbDeviceLike & { transfers: { endpoint: number; data: Uint8Array }[]; claimed: number[]; released: number[] }

export function fakeUsbDevice(options: { configuration?: UsbConfigurationLike; vendorId?: number; productId?: number; productName?: string } = {}): FakeUsbDevice {
  const configuration: UsbConfigurationLike = options.configuration ?? {
    configurationValue: 1,
    interfaces: [{
      interfaceNumber: 0,
      alternate: null,
      alternates: [{ alternateSetting: 0, interfaceClass: 7, endpoints: [{ endpointNumber: 1, direction: 'in', type: 'bulk' }, { endpointNumber: 2, direction: 'out', type: 'bulk' }] }],
    }],
  }
  let opened = false
  let selected: UsbConfigurationLike | null = null
  const device: FakeUsbDevice = {
    vendorId: options.vendorId ?? 0x04b8,
    productId: options.productId ?? 0x0202,
    productName: options.productName ?? 'TM-T20',
    manufacturerName: 'EPSON',
    serialNumber: 'X1',
    get opened() { return opened },
    get configuration() { return selected },
    configurations: [configuration],
    transfers: [],
    claimed: [],
    released: [],
    open: async () => { opened = true },
    close: async () => { opened = false },
    selectConfiguration: async () => { selected = configuration },
    claimInterface: async (n) => { device.claimed.push(n) },
    releaseInterface: async (n) => { device.released.push(n) },
    transferOut: async (endpoint, data) => {
      device.transfers.push({ endpoint, data: Uint8Array.from(data) })
      return { status: 'ok', bytesWritten: data.length }
    },
    forget: async () => {},
  }
  return device
}

export function fakeUsb(devices: UsbDeviceLike[]): UsbLike {
  return {
    requestDevice: async () => {
      const first = devices[0]
      if (!first) throw Object.assign(new Error('No device selected.'), { name: 'NotFoundError' })
      return first
    },
    getDevices: async () => devices,
  }
}

/** Puts fakes on `navigator` (or removes them with `null`). */
export function installNavigatorDevices(devices: { serial?: SerialLike | null; usb?: UsbLike | null }): void {
  for (const key of ['serial', 'usb'] as const) {
    if (!(key in devices)) continue
    const value = devices[key]
    if (value === null || value === undefined) Reflect.deleteProperty(navigator, key)
    else Object.defineProperty(navigator, key, { value, configurable: true })
  }
}

/** All bytes written to a fake serial port, joined. */
export function written(port: { writes: Uint8Array[] }): number[] {
  return port.writes.flatMap((w) => Array.from(w))
}
