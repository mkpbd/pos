import { useEffect, useEffectEvent, useState } from 'react'
import { Loader2Icon, PrinterIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { PrintBlock } from '@/lib/escpos/document'
import { hasDirectPrinter, usePrinterSettings } from '@/features/pos/printing/printer-settings'
import { claimAutoPrint, kickDrawer, printOnPrinter } from '@/features/pos/printing/till-printer'

/** What to print for one sale / slip. */
export type TillPrintJob = {
  /** Unique per transaction (e.g. `sale:<id>`): it prints by itself once. */
  key: string
  build: () => PrintBlock[] | Promise<PrintBlock[]>
  /** Cash came in (or went out in an exchange): the drawer opens when the transaction completes. */
  cash: boolean
}

/**
 * POS1d: the receipt's "Print" button. With a USB / serial printer set up, it prints straight to it
 * and — when `auto` — prints the receipt by itself (and opens the drawer after a cash sale) as soon
 * as it shows. Without one it uses the browser's print dialog. A failure offers browser printing.
 */
export function TillPrintButton({
  job,
  auto = false,
  onBrowserPrint,
  disabled = false,
}: {
  job: TillPrintJob | null
  auto?: boolean
  onBrowserPrint: () => void
  disabled?: boolean
}) {
  const settings = usePrinterSettings()
  const direct = hasDirectPrinter(settings)
  const [busy, setBusy] = useState(false)

  const run = async (mode: 'auto' | 'manual') => {
    if (!job) return
    if (!direct) {
      if (mode === 'manual') onBrowserPrint()
      return
    }
    const kick = mode === 'auto' && job.cash && settings.openDrawer
    if (mode === 'auto' && !settings.autoPrint && !kick) return
    setBusy(true)
    try {
      if (mode === 'auto' && !settings.autoPrint) await kickDrawer(settings)
      else await printOnPrinter(await job.build(), settings, kick)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'The printer did not answer.'
      toast.error(mode === 'auto' && !settings.autoPrint ? `The drawer did not open. ${reason}` : `The receipt was not printed. ${reason}`, {
        id: `print-${job.key}`,
        action: { label: 'Print in browser', onClick: onBrowserPrint },
        duration: 15_000,
      })
    } finally {
      setBusy(false)
    }
  }
  const autoPrint = useEffectEvent(() => void run('auto'))

  const jobKey = job?.key ?? null
  useEffect(() => {
    if (!auto || !jobKey || !direct) return
    // Next tick, claimed there: a re-mount (Strict Mode) cancels the first timer and prints once.
    const timer = setTimeout(() => { if (claimAutoPrint(jobKey)) autoPrint() }, 0)
    return () => clearTimeout(timer)
  }, [auto, jobKey, direct])

  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled || busy || !job}
      title={direct && settings.device ? `Print on ${settings.device.name}` : 'Print in the browser'}
      onClick={() => void run('manual')}
    >
      {busy ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <PrinterIcon data-icon="inline-start" />} Print
    </Button>
  )
}
