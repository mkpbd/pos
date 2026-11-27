import { useState } from 'react'
import { Loader2Icon, PrinterIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { exportErrorMessage } from '@/features/exports/errors'
import { downloadFile } from '@/lib/api/download'

/** ST2b: fetches a server-rendered document PDF (challan, purchase order, goods receipt) for printing. */
export function PdfButton({ path, filename, label = 'Print' }: { path: string; filename: string; label?: string }) {
  const [busy, setBusy] = useState(false)
  const open = async () => {
    setBusy(true)
    try {
      await downloadFile(path, { fallbackFilename: filename })
    } catch (error) {
      toast.error(exportErrorMessage(error, 'pdf'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="outline" disabled={busy} onClick={() => void open()}>
      {busy ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <PrinterIcon data-icon="inline-start" />} {label}
    </Button>
  )
}
