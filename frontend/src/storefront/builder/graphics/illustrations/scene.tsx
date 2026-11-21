import type { ReactNode } from 'react'
import type { IllustrationPalette } from '../../types'
import type { IllustrationName } from '../names'

/*
 * B20: the frame of every illustration — a 320 × 240 SVG (always 4:3, so its box is reserved
 * before it loads) and the scene's own CSS (React 19 hoists it into <head> once). Colours are
 * classes (`f1`–`f7` fills; `s1`–`s3`, `s5`–`s7` strokes) reading the palette variables `--c1`–`--c7` set by
 * the shared illustration CSS: theme roles, or tints of one role (`mono`). Moving parts carry
 * `b-ill-m`: their animations end where they start (the drawn pose), so a stopped or reduced-motion
 * illustration always shows its final frame.
 */

export type SceneProps = { palette: IllustrationPalette }

export function SceneSvg({ name, palette, css, children }: { name: IllustrationName; palette: IllustrationPalette; css: string; children: ReactNode }) {
  return (
    <>
      <style href={`b20-illustration-${name}`} precedence="b20">
        {css}
      </style>
      <svg className="b-ill-svg" viewBox="0 0 320 240" data-palette={palette} data-name={name} focusable="false" aria-hidden>
        {children}
      </svg>
    </>
  )
}
