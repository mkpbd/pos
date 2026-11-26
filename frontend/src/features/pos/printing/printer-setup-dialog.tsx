import { useState } from 'react'
import { Loader2Icon, PrinterIcon, UnplugIcon, UsbIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CODE_PAGE_LABELS, type CodePage } from '@/lib/escpos/code-pages'
import type { PaperWidth, RasterMode } from '@/lib/escpos/document'
import type { DrawerPin } from '@/lib/escpos/encoder'
import { directSupport, forgetPrinter, requestSerialPrinter, requestUsbPrinter, type PrinterConnection } from '@/lib/escpos/transports'
import { testDocument } from '@/features/pos/printing/receipt-document'
import { BAUD_RATES, loadPrinterSettings, savePrinterSettings, type PrinterSettings } from '@/features/pos/printing/printer-settings'
import { printOnPrinter } from '@/features/pos/printing/till-printer'
import { cn } from '@/lib/utils'

const CONNECTIONS: Record<PrinterConnection, string> = { browser: 'Browser print', usb: 'USB printer', serial: 'Serial / COM printer' }
const PAPERS: { value: PaperWidth; label: string }[] = [
  { value: 32, label: '58 mm (32)' },
  { value: 42, label: '80 mm (42)' },
  { value: 48, label: '80 mm (48)' },
]

function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange: (value: T) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Button
            key={String(o.value)}
            type="button"
            role="radio"
            size="sm"
            aria-checked={value === o.value}
            disabled={o.disabled}
            variant={value === o.value ? 'default' : 'outline'}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

function Toggle({ id, label, checked, onChange, hint }: { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: string }) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <Label htmlFor={id} className="flex flex-col items-start gap-0.5 font-normal">
        {label}
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </Label>
    </div>
  )
}

/** A picker closed without choosing is not an error worth showing. */
const cancelled = (error: unknown) => error instanceof Error && (error.name === 'NotFoundError' || error.name === 'AbortError')

/**
 * POS1d: this device's receipt printer — how it is connected (the browser's print dialog, or
 * straight to a USB / serial printer picked once), paper, picture mode, cutting, the cash drawer,
 * copies and printing by itself after each sale. Saved in this browser only.
 */
export function PrinterSetupDialog({ open, onOpenChange, shop }: { open: boolean; onOpenChange: (open: boolean) => void; shop: string | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        {open && <PrinterSetupForm shop={shop} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function PrinterSetupForm({ shop, onClose }: { shop: string | null; onClose: () => void }) {
  const [form, setForm] = useState<PrinterSettings>(loadPrinterSettings)
  const [choosing, setChoosing] = useState(false)
  const [testing, setTesting] = useState(false)
  const support = directSupport()
  const direct = form.connection !== 'browser'
  const set = (patch: Partial<PrinterSettings>) => setForm((f) => ({ ...f, ...patch }))

  const choose = async () => {
    if (form.connection === 'browser') return
    setChoosing(true)
    try {
      const device = form.connection === 'usb' ? await requestUsbPrinter() : await requestSerialPrinter()
      set({ device })
    } catch (error) {
      if (!cancelled(error)) toast.error(error instanceof Error ? error.message : 'The printer could not be chosen.')
    } finally {
      setChoosing(false)
    }
  }

  const forget = async () => {
    if (!form.device) return
    await forgetPrinter(form.device)
    set({ device: null })
    // The browser's permission is gone now, so the saved setting goes too.
    savePrinterSettings({ ...loadPrinterSettings(), device: null })
    toast.success('Printer forgotten.')
  }

  const testPrint = async () => {
    setTesting(true)
    try {
      await printOnPrinter(testDocument(form, shop), form, form.openDrawer)
      toast.success(form.openDrawer ? 'Test page sent; the drawer should open.' : 'Test page sent.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The test page was not printed.')
    } finally {
      setTesting(false)
    }
  }

  const save = () => {
    savePrinterSettings(form)
    toast.success('Receipt printer saved for this device.')
    onClose()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><PrinterIcon className="size-5" aria-hidden /> Receipt printer</DialogTitle>
        <DialogDescription>Saved on this device only. A USB or serial printer prints receipts without the print dialog and opens the cash drawer wired to it.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <Choice<PrinterConnection>
          label="Connection"
          value={form.connection}
          onChange={(connection) => set({ connection, device: form.device?.kind === connection ? form.device : null })}
          options={[
            { value: 'browser', label: CONNECTIONS.browser },
            ...(support.usb ? [{ value: 'usb' as const, label: CONNECTIONS.usb }] : []),
            ...(support.serial ? [{ value: 'serial' as const, label: CONNECTIONS.serial }] : []),
          ]}
        />
        {!support.usb && !support.serial && (
          <p className="rounded-md border p-3 text-sm text-muted-foreground" data-testid="printer-no-direct">
            This browser cannot talk to a receipt printer directly (that needs Chrome or Edge, on https). Receipts print through the browser’s print dialog: choose the receipt printer there.
          </p>
        )}

        {direct && (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <UsbIcon className="size-4 text-muted-foreground" aria-hidden />
              <span data-testid="printer-device">{form.device ? form.device.name : 'No printer chosen yet'}</span>
              <div className="ml-auto flex gap-2">
                <Button type="button" size="sm" variant="outline" disabled={choosing} onClick={() => void choose()}>
                  {choosing && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                  {form.device ? 'Change printer' : 'Choose printer'}
                </Button>
                {form.device && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => void forget()}>
                    <UnplugIcon data-icon="inline-start" /> Forget printer
                  </Button>
                )}
              </div>
            </div>
            {form.connection === 'serial' && (
              <div className="flex items-center gap-2">
                <Label asChild><span className="text-sm">Baud rate</span></Label>
                <Select value={String(form.baudRate)} onValueChange={(v) => set({ baudRate: Number(v) })}>
                  <SelectTrigger className="w-32" aria-label="Baud rate"><SelectValue /></SelectTrigger>
                  <SelectContent>{BAUD_RATES.map((b) => <SelectItem key={b} value={String(b)}>{b}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        <div className={cn('flex flex-col gap-4', !direct && 'opacity-60')} aria-disabled={!direct}>
          <Choice<PaperWidth> label="Paper" value={form.paper} options={PAPERS} onChange={(paper) => set({ paper })} />
          <Choice<CodePage>
            label="Characters"
            value={form.codePage}
            options={(Object.keys(CODE_PAGE_LABELS) as CodePage[]).map((c) => ({ value: c, label: CODE_PAGE_LABELS[c] }))}
            onChange={(codePage) => set({ codePage })}
          />
          <Choice<RasterMode>
            label="Print as a picture"
            value={form.raster}
            options={[{ value: 'auto', label: 'When needed (Bangla, other scripts)' }, { value: 'always', label: 'Always' }]}
            onChange={(raster) => set({ raster })}
          />
          <Toggle id="printer-cut" label="Cut the paper after printing" checked={form.cut} onChange={(cut) => set({ cut })} />
          <Toggle id="printer-auto" label="Print the receipt by itself after each sale" checked={form.autoPrint} onChange={(autoPrint) => set({ autoPrint })} />
          <Toggle
            id="printer-drawer"
            label="Open the cash drawer after a cash sale"
            hint="The drawer must be plugged into the printer."
            checked={form.openDrawer}
            onChange={(openDrawer) => set({ openDrawer })}
          />
          <div className="flex flex-wrap gap-4">
            <Choice<DrawerPin> label="Drawer pin" value={form.drawerPin} options={[{ value: 2, label: 'Pin 2' }, { value: 5, label: 'Pin 5' }]} onChange={(drawerPin) => set({ drawerPin })} />
            <Choice<1 | 2> label="Copies" value={form.copies} options={[{ value: 1, label: '1' }, { value: 2, label: '2' }]} onChange={(copies) => set({ copies })} />
          </div>
          {!direct && <p className="text-xs text-muted-foreground">These apply to a USB or serial printer. With browser print, the paper size is the receipt format chosen on the receipt.</p>}
        </div>
      </div>
      <DialogFooter className="gap-2 sm:justify-between">
        <Button type="button" variant="outline" disabled={!direct || !form.device || testing} onClick={() => void testPrint()}>
          {testing ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <PrinterIcon data-icon="inline-start" />} Test print
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={save}>Save</Button>
        </div>
      </DialogFooter>
    </>
  )
}
