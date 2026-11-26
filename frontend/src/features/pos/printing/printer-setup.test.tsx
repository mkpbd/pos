import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PRINTER_SETTINGS, loadPrinterSettings, PRINTER_SETTINGS_KEY, savePrinterSettings } from '@/features/pos/printing/printer-settings'
import { PrinterSetupDialog } from '@/features/pos/printing/printer-setup-dialog'
import { testDocument } from '@/features/pos/printing/receipt-document'
import { printJobBytes } from '@/features/pos/printing/till-printer'
import { fakeSerial, fakeSerialPort, fakeUsb, fakeUsbDevice, installNavigatorDevices, written } from '@/test/fake-printers'

const toastSuccess = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const original = await importOriginal<typeof import('sonner')>()
  return { ...original, toast: Object.assign(vi.fn(), { ...original.toast, error: toastError, success: toastSuccess }) }
})

beforeEach(() => {
  localStorage.clear()
  toastSuccess.mockReset()
  toastError.mockReset()
})
afterEach(() => installNavigatorDevices({ serial: null, usb: null }))

describe('printer settings', () => {
  it('starts from browser print and survives a round trip through localStorage', () => {
    expect(loadPrinterSettings()).toEqual(DEFAULT_PRINTER_SETTINGS)
    const device = { kind: 'serial' as const, name: 'Serial port', vendorId: 1, productId: 2, serialNumber: null }
    savePrinterSettings({ ...DEFAULT_PRINTER_SETTINGS, connection: 'serial', device, paper: 32, baudRate: 19200, copies: 2, drawerPin: 5, raster: 'always', cut: false })
    expect(loadPrinterSettings()).toMatchObject({ connection: 'serial', device, paper: 32, baudRate: 19200, copies: 2, drawerPin: 5, raster: 'always', cut: false })
  })

  it('ignores damaged or foreign values', () => {
    localStorage.setItem(PRINTER_SETTINGS_KEY, '{not json')
    expect(loadPrinterSettings()).toEqual(DEFAULT_PRINTER_SETTINGS)
    localStorage.setItem(PRINTER_SETTINGS_KEY, JSON.stringify({ connection: 'usb', paper: 99, copies: 7, device: { kind: 'serial', name: 'x' }, autoPrint: 'yes' }))
    // A serial device does not belong to a USB connection; unknown sizes fall back.
    expect(loadPrinterSettings()).toEqual({ ...DEFAULT_PRINTER_SETTINGS, connection: 'usb' })
  })
})

describe('PrinterSetupDialog', () => {
  it('explains browser printing when the browser cannot reach a printer', () => {
    render(<PrinterSetupDialog open onOpenChange={() => {}} shop="Corner Shop" />)
    const dialog = screen.getByRole('dialog', { name: 'Receipt printer' })
    expect(within(dialog).getByTestId('printer-no-direct')).toHaveTextContent('Chrome or Edge')
    expect(within(dialog).getByRole('radio', { name: 'Browser print' })).toHaveAttribute('aria-checked', 'true')
    expect(within(dialog).queryByRole('radio', { name: 'USB printer' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Test print' })).toBeDisabled()
  })

  it('chooses a serial printer, test prints with the drawer kick, saves, and forgets it', async () => {
    const user = userEvent.setup()
    const port = fakeSerialPort()
    installNavigatorDevices({ serial: fakeSerial([], port), usb: fakeUsb([fakeUsbDevice()]) })
    const closed = vi.fn()
    const { unmount } = render(<PrinterSetupDialog open onOpenChange={closed} shop="Corner Shop" />)
    const dialog = screen.getByRole('dialog', { name: 'Receipt printer' })

    await user.click(within(dialog).getByRole('radio', { name: 'Serial / COM printer' }))
    expect(within(dialog).getByTestId('printer-device')).toHaveTextContent('No printer chosen yet')
    await user.click(within(dialog).getByRole('button', { name: 'Choose printer' }))
    expect(within(dialog).getByTestId('printer-device')).toHaveTextContent('Serial port (USB 0416:5011)')
    await user.click(within(dialog).getByRole('radio', { name: '58 mm (32)' }))
    await user.click(within(dialog).getByRole('radio', { name: 'Pin 5' }))

    await user.click(within(dialog).getByRole('button', { name: 'Test print' }))
    await waitFor(() => expect(port.writes).toHaveLength(1))
    const form = { ...DEFAULT_PRINTER_SETTINGS, connection: 'serial' as const, device: { kind: 'serial' as const, name: 'Serial port (USB 0416:5011)', vendorId: 0x0416, productId: 0x5011, serialNumber: null }, paper: 32 as const, drawerPin: 5 as const }
    expect(written(port)).toEqual(Array.from(printJobBytes(testDocument(form, 'Corner Shop'), form, true)))
    expect(written(port).slice(0, 10)).toEqual([0x1b, 0x40, 0x1b, 0x74, 16, 0x1b, 0x70, 1, 25, 250])
    expect(written(port).slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00])
    expect(toastSuccess).toHaveBeenCalledWith('Test page sent; the drawer should open.')

    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(closed).toHaveBeenCalledWith(false)
    expect(JSON.parse(localStorage.getItem(PRINTER_SETTINGS_KEY) ?? '{}')).toMatchObject({ connection: 'serial', paper: 32, drawerPin: 5, device: { name: 'Serial port (USB 0416:5011)' } })
    unmount()

    render(<PrinterSetupDialog open onOpenChange={() => {}} shop={null} />)
    const again = screen.getByRole('dialog', { name: 'Receipt printer' })
    expect(within(again).getByRole('radio', { name: 'Serial / COM printer' })).toHaveAttribute('aria-checked', 'true')
    expect(within(again).getByTestId('printer-device')).toHaveTextContent('Serial port (USB 0416:5011)')
    await user.click(within(again).getByRole('button', { name: 'Forget printer' }))
    expect(within(again).getByTestId('printer-device')).toHaveTextContent('No printer chosen yet')
    expect(loadPrinterSettings().device).toBeNull()
  })

  it('shows why a test print failed', async () => {
    const user = userEvent.setup()
    const port = fakeSerialPort()
    port.failWrite = new Error('The device has been lost.')
    installNavigatorDevices({ serial: fakeSerial([], port) })
    render(<PrinterSetupDialog open onOpenChange={() => {}} shop={null} />)
    const dialog = screen.getByRole('dialog', { name: 'Receipt printer' })
    await user.click(within(dialog).getByRole('radio', { name: 'Serial / COM printer' }))
    await user.click(within(dialog).getByRole('button', { name: 'Choose printer' }))
    await user.click(within(dialog).getByRole('button', { name: 'Test print' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Printing failed: The device has been lost.'))
  })
})
