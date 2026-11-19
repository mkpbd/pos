import { useMemo } from 'react'
import type { PreviewContext } from '@/storefront/builder/audience/types'
import { useEditor } from '../store'
import { previewContext } from './preview'

/** B13: the "Preview as" shopper on the canvas's device (null = "Show everything"). */
export function usePreviewContext(): PreviewContext | null {
  const previewAs = useEditor((s) => s.previewAs)
  const device = useEditor((s) => s.device)
  return useMemo(() => (previewAs ? previewContext(previewAs, device) : null), [previewAs, device])
}
