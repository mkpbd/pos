import { useMemo } from 'react'
import { DownloadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { copyText } from '@/features/marketing/clipboard'
import { encodeQr, qrPath, qrSvg } from '@/features/marketing/qr'

/** The QR code itself: black on white whatever the theme (scanners need the contrast). */
export function QrImage({ text, label, className }: { text: string; label: string; className?: string }) {
  const code = useMemo(() => {
    try {
      return encodeQr(text)
    } catch {
      return null
    }
  }, [text])
  if (!code) return <p className="text-sm text-destructive">This link is too long for a QR code.</p>
  const dim = code.size + 8
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${dim} ${dim}`} shapeRendering="crispEdges" className={className} data-testid="qr-code">
      <rect width={dim} height={dim} fill="#ffffff" />
      <path d={qrPath(code)} fill="#000000" />
    </svg>
  )
}

/** QR code of a short link, to print on flyers, packaging or a shop window; downloads as SVG. */
export function QrDialog({ url, code, onClose }: { url: string; code: string; onClose: () => void }) {
  // A data URL needs no clean-up (the SVG is a few kilobytes).
  const href = useMemo(() => {
    try {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(url))}`
    } catch {
      return null
    }
  }, [url])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>QR code</DialogTitle>
          <DialogDescription>Phones that scan it open your short link. Print it on flyers, packaging or your shop window.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <QrImage text={url} label={`QR code for ${url}`} className="w-full max-w-64 rounded-md border" />
          <p className="font-mono text-xs break-all text-muted-foreground">{url}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void copyText(url)}>Copy link</Button>
          {href && (
            <Button asChild>
              <a href={href} download={`qr-${code}.svg`}><DownloadIcon data-icon="inline-start" /> Download SVG</a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
