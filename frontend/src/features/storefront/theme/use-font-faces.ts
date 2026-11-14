import { useEffect } from 'react'
import type { StoreFont } from '@/features/storefront/api'
import { customFontFaceCss } from '@/storefront/fonts'

/** Declares the store's uploaded fonts in this document, so samples draw in them. */
export function useFontFaces(fonts: readonly StoreFont[]) {
  const css = customFontFaceCss(fonts)
  useEffect(() => {
    if (!css) return
    const style = document.createElement('style')
    style.dataset.fontFaces = 'admin'
    style.textContent = css
    document.head.append(style)
    return () => style.remove()
  }, [css])
}
