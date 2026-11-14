import { useEffect, useLayoutEffect, useMemo } from 'react'
import poppinsLatin from '@fontsource/poppins/files/poppins-latin-400-normal.woff2?url'
import jostLatin from '@fontsource-variable/jost/files/jost-latin-wght-normal.woff2?url'
import hindLatin from '@fontsource/hind-siliguri/files/hind-siliguri-latin-400-normal.woff2?url'
import hindBengali from '@fontsource/hind-siliguri/files/hind-siliguri-bengali-400-normal.woff2?url'
import notoLatin from '@fontsource-variable/noto-sans-bengali/files/noto-sans-bengali-latin-wght-normal.woff2?url'
import notoBengali from '@fontsource-variable/noto-sans-bengali/files/noto-sans-bengali-bengali-wght-normal.woff2?url'
import anekLatin from '@fontsource-variable/anek-bangla/files/anek-bangla-latin-wght-normal.woff2?url'
import anekBengali from '@fontsource-variable/anek-bangla/files/anek-bangla-bengali-wght-normal.woff2?url'
import tiroLatin from '@fontsource/tiro-bangla/files/tiro-bangla-latin-400-normal.woff2?url'
import tiroBengali from '@fontsource/tiro-bangla/files/tiro-bangla-bengali-400-normal.woff2?url'
import balooDaLatin from '@fontsource-variable/baloo-da-2/files/baloo-da-2-latin-wght-normal.woff2?url'
import balooDaBengali from '@fontsource-variable/baloo-da-2/files/baloo-da-2-bengali-wght-normal.woff2?url'
import { customFontFaceCss, isBuiltInFont, usedFonts, type BuiltInFontKey } from './fonts'
import type { StorefrontTheme } from './types'

/*
 * B10: loads only the fonts a theme uses. Each built-in font's fontsource stylesheet is its own
 * dynamic import (a CSS chunk with `font-display: swap` faces behind unicode ranges, so a page
 * fetches only the subsets its text needs); uploaded fonts get `@font-face` rules in one <style>;
 * the body font's main file is preloaded. storefront.css no longer imports every font.
 */

type LoadableFont = Exclude<BuiltInFontKey, 'system'>

/** A font's whole family (Latin + Bengali subsets), for a main heading / body font. */
const MAIN: Record<LoadableFont, () => Promise<unknown>> = {
  baloo: () => import('@fontsource-variable/baloo-2/index.css'),
  poppins: () =>
    Promise.all([
      import('@fontsource/poppins/400.css'),
      import('@fontsource/poppins/500.css'),
      import('@fontsource/poppins/600.css'),
      import('@fontsource/poppins/700.css'),
    ]),
  playfair: () => import('@fontsource-variable/playfair-display/index.css'),
  jost: () => import('@fontsource-variable/jost/index.css'),
  'hind-siliguri': () =>
    Promise.all([
      import('@fontsource/hind-siliguri/400.css'),
      import('@fontsource/hind-siliguri/500.css'),
      import('@fontsource/hind-siliguri/600.css'),
      import('@fontsource/hind-siliguri/700.css'),
    ]),
  'noto-sans-bengali': () => import('@fontsource-variable/noto-sans-bengali/wght.css'),
  'anek-bangla': () => import('@fontsource-variable/anek-bangla/wght.css'),
  'tiro-bangla': () => import('@fontsource/tiro-bangla/400.css'),
  'baloo-da-2': () => import('@fontsource-variable/baloo-da-2/wght.css'),
}

/**
 * A Bangla font used only for Bangla text. Hind Siliguri (today's default) loads its Bengali
 * subsets alone, so Latin words in Bangla text keep the theme font as before; the others load
 * whole (their Latin matches their Bengali).
 */
const BANGLA_ONLY: Partial<Record<LoadableFont, () => Promise<unknown>>> = {
  'hind-siliguri': () =>
    Promise.all([
      import('@fontsource/hind-siliguri/bengali-400.css'),
      import('@fontsource/hind-siliguri/bengali-500.css'),
      import('@fontsource/hind-siliguri/bengali-600.css'),
      import('@fontsource/hind-siliguri/bengali-700.css'),
    ]),
  'tiro-bangla': () => import('@fontsource/tiro-bangla/bengali-400.css'),
}

/** The regular face of each body-capable font, preloaded: [Latin file, Bengali file]. */
const BODY_FILES: Partial<Record<LoadableFont, readonly [string, string | null]>> = {
  poppins: [poppinsLatin, null],
  jost: [jostLatin, null],
  'hind-siliguri': [hindLatin, hindBengali],
  'noto-sans-bengali': [notoLatin, notoBengali],
  'anek-bangla': [anekLatin, anekBengali],
  'tiro-bangla': [tiroLatin, tiroBengali],
  'baloo-da-2': [balooDaLatin, balooDaBengali],
}

const started = new Map<string, Promise<void>>()

/**
 * Loads a built-in font's stylesheet once (`main`: the whole family; else its Bangla subsets
 * where they ship separately). Unknown keys and `system` resolve at once. Exported for the
 * admin's font pickers (samples).
 */
export function loadFont(key: string, main = true): Promise<void> {
  if (!isBuiltInFont(key) || key === 'system') return Promise.resolve()
  const loader = main ? MAIN[key] : (BANGLA_ONLY[key] ?? MAIN[key])
  const id = `${key}:${main || !BANGLA_ONLY[key] ? 'main' : 'bn'}`
  let promise = started.get(id)
  if (!promise) {
    promise = loader().then(
      () => undefined,
      // A chunk that fails to load leaves the fallback fonts of the stack; never an error on the page.
      () => {
        started.delete(id)
      },
    )
    started.set(id, promise)
  }
  return promise
}

/** The fonts a theme uses, as loads (for tests and the admin). */
export function themeFontLoads(theme: Pick<StorefrontTheme, 'typography' | 'fonts'>): { key: string; main: boolean }[] {
  return usedFonts(theme).builtIn
}

/** The body font file to preload, or null (system font, an uploaded font — the page shell preloads those). */
export function bodyPreloadUrl(theme: Pick<StorefrontTheme, 'typography'>, locale: string): string | null {
  const key = theme.typography.body_font
  if (!isBuiltInFont(key) || key === 'system') return null
  const files = BODY_FILES[key]
  if (!files) return null
  return locale === 'bn' && files[1] ? files[1] : files[0]
}

const STYLE_ID = 'sf-custom-fonts'
const PRELOAD_ID = 'sf-font-preload'

function setCustomFontCss(css: string): () => void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!css) {
    style?.remove()
    return () => {}
  }
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  if (style.textContent !== css) style.textContent = css
  const own = style
  return () => own.remove()
}

function setPreload(url: string | null): () => void {
  if (!url) return () => {}
  const link = document.createElement('link')
  link.id = PRELOAD_ID
  link.rel = 'preload'
  link.as = 'font'
  link.type = 'font/woff2'
  link.crossOrigin = 'anonymous'
  link.href = url
  document.getElementById(PRELOAD_ID)?.remove()
  document.head.appendChild(link)
  return () => link.remove()
}

/**
 * Loads the theme's fonts (storefront shell and builder canvas): built-in stylesheets on demand,
 * uploaded fonts' `@font-face` rules, and a preload of the body font. `theme` null = nothing yet.
 */
export function useThemeFonts(theme: Pick<StorefrontTheme, 'typography' | 'fonts'> | null | undefined, locale: string) {
  const used = useMemo(() => (theme ? usedFonts(theme) : null), [theme])
  const loads = used ? used.builtIn.map(({ key, main }) => `${key}:${main ? 1 : 0}`).join(',') : ''
  useEffect(() => {
    if (!loads) return
    for (const entry of loads.split(',')) {
      const [key, main] = entry.split(':') as [string, string]
      void loadFont(key, main === '1')
    }
  }, [loads])
  const css = used ? customFontFaceCss(used.custom) : ''
  useLayoutEffect(() => setCustomFontCss(css), [css])
  const preload = theme ? bodyPreloadUrl(theme, locale) : null
  useEffect(() => setPreload(preload), [preload])
}
