import { useRef, type CSSProperties } from 'react'
import { usePageProgressLink, useScrollLink, useScrollMotionOn } from './scroll-link'
import type { BackgroundScroll, ScrollProgress } from './types'
import { normalizeScrollProgress } from './validate'

/*
 * B19 scroll layers: a section's background that zooms / pans while the page scrolls, the Ken
 * Burns slow zoom of pictures, and the page's reading progress bar. Transforms only; the CSS is in
 * storefront.css (`.b-bgscroll`, `[data-b-kb]`, `.b-progress`).
 */

/**
 * B19 `background_scroll`: a layer that inherits the section's background (image, overlay,
 * position) and zooms or pans it through the section's time on screen. Shown by storefront.css only
 * when motion is allowed, not paused and the page moves (`data-b-moving`); otherwise the section's
 * own background stays still. Replaces B9 parallax.
 */
export function BackgroundScrollLayer({ kind }: { kind: Exclude<BackgroundScroll, 'none'> }) {
  const layer = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLElement | null>(null)
  const on = useScrollMotionOn()
  // The fallback engine measures the section and writes the layer.
  useScrollLink(host, 'cover', on, layer)
  return (
    <div
      ref={(node) => {
        layer.current = node
        host.current = node?.parentElement ?? null
      }}
      className="b-bgscroll"
      aria-hidden
      data-testid="builder-bg-scroll"
      data-kind={kind}
    >
      <div />
    </div>
  )
}

const PROGRESS_COLORS: Record<ScrollProgress['color_role'], string> = {
  primary: 'var(--sf-primary)',
  accent: 'var(--sf-accent)',
  secondary: 'var(--sf-highlight)',
}

/**
 * B19 reading progress bar (`document.scroll_progress`): a thin fixed bar that grows with the
 * page's scroll (scaleX, CSS `scroll()` timeline or the fallback engine). Purely decorative:
 * hidden from assistive technology. Under reduced motion it still follows the scroll, without
 * easing (it only moves when the visitor scrolls).
 */
export function ReadingProgressBar({ value }: { value: unknown }) {
  const settings = normalizeScrollProgress(value)
  const bar = useRef<HTMLDivElement>(null)
  usePageProgressLink(bar, settings !== undefined)
  if (!settings) return null
  const style = { '--b-progress-color': PROGRESS_COLORS[settings.color_role], height: `${settings.thickness}px` } as CSSProperties
  return (
    <div className="b-progress" data-position={settings.position} aria-hidden role="progressbar" data-testid="builder-reading-progress" style={style}>
      <div ref={bar} className="b-progress-fill" />
    </div>
  )
}
