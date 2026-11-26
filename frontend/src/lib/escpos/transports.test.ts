import { afterEach, describe, expect, it } from 'vitest'
import { bulkOut, directSupport, forgetPrinter, PrinterError, requestSerialPrinter, requestUsbPrinter, USB_CHUNK, writeSerial, writeUsb } from '@/lib/escpos/transports'
import { fakeSerial, fakeSerialPort, fakeUsb, fakeUsbDevice, installNavigatorDevices, written } from '@/test/fake-printers'

afterEach(() => installNavigatorDevices({ serial: null, usb: null }))

describe('feature detection', () => {
  it('offers only browser print when the browser has neither Web Serial nor WebUSB', () => {
    installNavigatorDevices({ serial: null, usb: null })
    expect(directSupport()).toEqual({ serial: false, usb: false })
    installNavigatorDevices({ serial: fakeSerial([]) })
    expect(directSupport()).toEqual({ serial: true, usb: false })
    installNavigatorDevices({ usb: fakeUsb([]) })
    expect(directSupport()).toEqual({ serial: true, usb: true })
  })

  it('refuses to choose a printer without the API', async () => {
    await expect(requestSerialPrinter()).rejects.toBeInstanceOf(PrinterError)
    await expect(requestUsbPrinter()).rejects.toThrow('cannot use USB printers')
  })
})

describe('Web Serial', () => {
  it('remembers the chosen port by its USB ids and writes to it silently later', async () => {
    const other = fakeSerialPort({ usbVendorId: 0x1111, usbProductId: 0x2222 })
    const printer = fakeSerialPort()
    installNavigatorDevices({ serial: fakeSerial([other], printer) })

    const device = await requestSerialPrinter()
    expect(device).toEqual({ kind: 'serial', name: 'Serial port (USB 0416:5011)', vendorId: 0x0416, productId: 0x5011, serialNumber: null })

    await writeSerial(device, Uint8Array.from([0x1b, 0x40]), 9600)
    await writeSerial(device, Uint8Array.from([0x0a]), 9600)
    expect(written(printer)).toEqual([0x1b, 0x40, 0x0a])
    expect(other.writes).toHaveLength(0)
    expect(printer.opened).toBe(2)
    expect(printer.closed).toBe(2)
  })

  it('reports a printer that is gone, and a failed write, as PrinterError', async () => {
    const printer = fakeSerialPort()
    installNavigatorDevices({ serial: fakeSerial([]) })
    const device = { kind: 'serial' as const, name: 'x', vendorId: 0x0416, productId: 0x5011, serialNumber: null }
    await expect(writeSerial(device, Uint8Array.from([1]), 9600)).rejects.toThrow(/not connected/)

    installNavigatorDevices({ serial: fakeSerial([printer]) })
    printer.failWrite = new Error('The device has been lost.')
    await expect(writeSerial(device, Uint8Array.from([1]), 9600)).rejects.toThrow('Printing failed: The device has been lost.')
    // The port is closed again, so the next job can open it.
    expect(printer.closed).toBe(1)
  })
})

describe('WebUSB', () => {
  it('finds the first bulk OUT endpoint, preferring the printer interface', () => {
    expect(bulkOut({
      configurationValue: 1,
      interfaces: [
        { interfaceNumber: 0, alternate: null, alternates: [{ alternateSetting: 0, interfaceClass: 0xff, endpoints: [{ endpointNumber: 5, direction: 'out', type: 'bulk' }] }] },
        { interfaceNumber: 1, alternate: null, alternates: [{ alternateSetting: 0, interfaceClass: 7, endpoints: [{ endpointNumber: 3, direction: 'out', type: 'interrupt' }, { endpointNumber: 4, direction: 'out', type: 'bulk' }] }] },
      ],
    })).toEqual({ interfaceNumber: 1, alternateSetting: 0, endpointNumber: 4 })
    expect(bulkOut({ configurationValue: 1, interfaces: [] })).toBeNull()
  })

  it('opens, selects the configuration, claims, transfers in chunks and releases', async () => {
    const device = fakeUsbDevice()
    installNavigatorDevices({ usb: fakeUsb([device]) })
    const chosen = await requestUsbPrinter()
    expect(chosen).toEqual({ kind: 'usb', name: 'EPSON TM-T20', vendorId: 0x04b8, productId: 0x0202, serialNumber: 'X1' })

    const data = new Uint8Array(USB_CHUNK + 10).map((_, i) => i & 0xff)
    await writeUsb(chosen, data)
    expect(device.transfers.map((t) => [t.endpoint, t.data.length])).toEqual([[2, USB_CHUNK], [2, 10]])
    expect(device.transfers.flatMap((t) => Array.from(t.data))).toEqual(Array.from(data))
    expect(device.claimed).toEqual([0])
    expect(device.released).toEqual([0])
    expect(device.opened).toBe(false)
  })

  it('refuses a device without a printer output', async () => {
    const device = fakeUsbDevice({ configuration: { configurationValue: 1, interfaces: [] } })
    installNavigatorDevices({ usb: fakeUsb([device]) })
    await expect(writeUsb(await requestUsbPrinter(), Uint8Array.from([1]))).rejects.toThrow(/no printer output/)
  })

  it('forgets a device through the browser where it can', async () => {
    const device = fakeUsbDevice()
    let forgotten = false
    device.forget = async () => { forgotten = true }
    installNavigatorDevices({ usb: fakeUsb([device]) })
    await forgetPrinter(await requestUsbPrinter())
    expect(forgotten).toBe(true)
  })
})
