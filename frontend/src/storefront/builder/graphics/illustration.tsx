import { lazy, Suspense, useRef, type ComponentType } from 'react'
import type { IllustrationPalette, IllustrationPlay } from '../types'
import type { SceneProps } from './illustrations/scene'
import { isIllustrationName, type IllustrationName } from './names'
import { useGraphicPlay } from './play'

/*
 * B20 illustration (lazy chunk): the play runtime and the shared palette CSS; each scene is its own
 * lazy module, loaded only when a page shows it. The box keeps its 4:3 ratio while the scene loads
 * (no layout shift). Decorative here (aria-hidden): the element around it carries the alt text.
 * Also the editor's picker thumbnails: `playing` forces the animation on / off.
 */

const SCENES: Record<IllustrationName, ComponentType<SceneProps>> = {
  delivery_scene: lazy(() => import('./illustrations/delivery-scene')),
  shopping_bag_pop: lazy(() => import('./illustrations/shopping-bag-pop')),
  sale_tag_swing: lazy(() => import('./illustrations/sale-tag-swing')),
  gift_unwrap: lazy(() => import('./illustrations/gift-unwrap')),
  phone_order: lazy(() => import('./illustrations/phone-order')),
  parcel_journey: lazy(() => import('./illustrations/parcel-journey')),
  happy_shopper: lazy(() => import('./illustrations/happy-shopper')),
  eid_lanterns: lazy(() => import('./illustrations/eid-lanterns')),
}

const P = 'var(--sf-primary, #2563eb)'

/*
 * Palette: `theme` = primary, accent, highlight, surface, heading (+ the page canvas and a neutral
 * skin tone); `mono` = tints and a shade of the primary colour. Playback: `view` plays twice (under
 * 5 s), `hover` once per hover, `loop` forever (long motion: the B18 Pause toggle stops it; paused
 * off-screen). Nothing moves before it plays, under reduced motion or when paused.
 */
const ILLUSTRATION_CSS = `
.b-ill{display:block;position:relative;line-height:0}
.b-ill-svg{display:block;width:100%;height:auto;overflow:visible;--c1:${P};--c2:var(--sf-accent, #f59e0b);--c3:var(--sf-highlight, #ec4899);--c4:var(--sf-surface, #eef2f7);--c5:var(--sf-heading, #1e293b);--c6:var(--sf-canvas, #ffffff);--c7:#f3c9a5}
.b-ill-svg[data-palette=mono]{--c2:color-mix(in srgb, ${P} 62%, #fff);--c3:color-mix(in srgb, ${P} 38%, #fff);--c4:color-mix(in srgb, ${P} 12%, #fff);--c5:color-mix(in srgb, ${P} 55%, #000);--c7:color-mix(in srgb, ${P} 22%, #fff)}
.b-ill-svg .f1{fill:var(--c1)}.b-ill-svg .f2{fill:var(--c2)}.b-ill-svg .f3{fill:var(--c3)}.b-ill-svg .f4{fill:var(--c4)}.b-ill-svg .f5{fill:var(--c5)}.b-ill-svg .f6{fill:var(--c6)}.b-ill-svg .f7{fill:var(--c7)}
.b-ill-svg .s1{stroke:var(--c1)}.b-ill-svg .s2{stroke:var(--c2)}.b-ill-svg .s3{stroke:var(--c3)}.b-ill-svg .s5{stroke:var(--c5)}.b-ill-svg .s6{stroke:var(--c6)}.b-ill-svg .s7{stroke:var(--c7)}
.b-ill-svg .ln{fill:none;stroke-linecap:round;stroke-linejoin:round}
.b-ill-m{transform-box:fill-box;transform-origin:center}
.b-ill[data-play=run]{--b-ill-n:2}
.b-ill[data-play=run][data-trigger=hover]{--b-ill-n:1}
.b-ill[data-play=loop]{--b-ill-n:infinite}
.b-ill:not([data-play=run]):not([data-play=loop]) .b-ill-m{animation:none!important}
.b-ill[data-offscreen] .b-ill-m{animation-play-state:paused!important}
html[data-b-paused] .b-ill[data-play=loop] .b-ill-m{animation:none!important}
@media (prefers-reduced-motion:reduce){.b-ill .b-ill-m{animation:none!important}}
`

export type IllustrationArtProps = {
  name: string
  palette?: IllustrationPalette
  play?: IllustrationPlay
  /** Editor thumbnails: true plays (`loop` keeps playing), false stops; absent = `play` decides. */
  playing?: boolean
  className?: string
}

export function IllustrationArt({ name, palette = 'theme', play = 'view', playing, className }: IllustrationArtProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const known = isIllustrationName(name)
  useGraphicPlay(ref, { trigger: play, animated: known, playing })
  const Scene = known ? SCENES[name] : null

  return (
    <>
      <style href="b20-illustration" precedence="b20">
        {ILLUSTRATION_CSS}
      </style>
      <span ref={ref} aria-hidden className={className ? `b-ill ${className}` : 'b-ill'} data-trigger={play} data-illustration={name} style={{ aspectRatio: '4 / 3' }}>
        {Scene && (
          <Suspense fallback={null}>
            <Scene palette={palette} />
          </Suspense>
        )}
      </span>
    </>
  )
}

export default IllustrationArt
