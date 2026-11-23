import { useMemo } from 'react'
import { encodeQr, qrPath, type QrCode } from '@/features/marketing/qr'

/** Level M first; a long organization name or e-mail can still fit at level L (versions 1–10 only). */
function encode(text: string): QrCode | null {
  for (const level of ['M', 'L'] as const) {
    try {
      return encodeQr(text, level)
    } catch {
      // Too long at this level — try the next one.
    }
  }
  return null
}

/**
 * The otpauth:// URI as a QR code for an authenticator app (in-house encoder, no dependency).
 * Black on white whatever the theme: scanners need the contrast.
 */
export function TwoFactorQr({ uri, className }: { uri: string; className?: string }) {
  const code = useMemo(() => encode(uri), [uri])
  if (!code) {
    return <p className="text-sm text-muted-foreground">This code is too long to show as a QR code — enter the key below in your app instead.</p>
  }
  const dim = code.size + 8
  return (
    <svg
      role="img"
      aria-label="QR code to scan with your authenticator app"
      viewBox={`0 0 ${dim} ${dim}`}
      shapeRendering="crispEdges"
      className={className}
      data-testid="two-factor-qr"
    >
      <rect width={dim} height={dim} fill="#ffffff" />
      <path d={qrPath(code)} fill="#000000" />
    </svg>
  )
}

