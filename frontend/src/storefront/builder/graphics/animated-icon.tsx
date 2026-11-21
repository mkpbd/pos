import { useRef, type CSSProperties } from 'react'
import type { AnimatedIconAnimation, AnimatedIconBackground, AnimatedIconTrigger } from '../types'
import { iconArtSize, iconBoxStyle } from './icon-box'
import { ANIMATED_ICONS } from './icons'
import { isAnimatedIconName } from './names'
import { useGraphicPlay } from './play'

/*
 * B20 animated icon drawing (lazy chunk: the whole icon set lives here, never in the storefront
 * entry). Every part is a path with `pathLength="1"`; `draw` traces them one after another with
 * `stroke-dashoffset`, the other animations move the whole drawing (transform / opacity only).
 * Decorative here (aria-hidden): the element around it carries the label. Also the editor's picker
 * preview: `playing` forces the animation on / off; reduced motion always shows the still drawing.
 */

export type AnimatedIconArtProps = {
  name: string
  animation?: AnimatedIconAnimation
  trigger?: AnimatedIconTrigger
  /** Box size in px (default 64). */
  size?: number
  /** Stroke width in drawing units (default 2). */
  stroke?: number
  /** Any CSS colour (default: the theme's primary). */
  color?: string
  background?: AnimatedIconBackground
  /** Editor previews: true plays (again), false stops; absent = the trigger decides. */
  playing?: boolean
  className?: string
}

const EASE = 'cubic-bezier(.65,0,.35,1)'

/*
 * The animations. `start` hides draw / pop drawings until they play (motion allowed only); the
 * still final drawing is the default everywhere else. `loop` variants rest between moves; the
 * B18 Pause toggle stops loops on their final drawing; loops off-screen are paused.
 */
const ICON_CSS = `
.b-aicon{display:inline-flex;align-items:center;justify-content:center;flex:none;line-height:0}
.b-aicon svg{display:block;overflow:visible}
.b-aicon-g{transform-box:view-box;transform-origin:24px 24px}
@media (prefers-reduced-motion:no-preference){
.b-aicon[data-anim=draw][data-play=start] .b-aicon-p{stroke-dasharray:1 2;stroke-dashoffset:1.01}
.b-aicon[data-anim=pop][data-play=start] .b-aicon-g{opacity:0;transform:scale(.4)}
.b-aicon[data-anim=draw][data-play=run] .b-aicon-p{animation:b-aicon-draw 1s ${EASE} calc(var(--i,0) * 90ms) both}
.b-aicon[data-anim=draw][data-play=loop] .b-aicon-p{animation:b-aicon-draw-loop 3.6s ${EASE} calc(var(--i,0) * 90ms) infinite both}
.b-aicon[data-anim=pop][data-play=run] .b-aicon-g{animation:b-aicon-pop .6s cubic-bezier(.34,1.56,.64,1) both}
.b-aicon[data-anim=pop][data-play=loop] .b-aicon-g{animation:b-aicon-pop-loop 2.4s ease-out infinite}
.b-aicon[data-anim=bounce][data-play=run] .b-aicon-g{animation:b-aicon-bounce .9s ease-out}
.b-aicon[data-anim=bounce][data-play=loop] .b-aicon-g{animation:b-aicon-bounce-loop 2.2s ease-out infinite}
.b-aicon[data-anim=spin][data-play=run] .b-aicon-g{animation:b-aicon-spin .9s ${EASE}}
.b-aicon[data-anim=spin][data-play=loop] .b-aicon-g{animation:b-aicon-spin-loop 3s ${EASE} infinite}
.b-aicon[data-anim=pulse][data-play=run] .b-aicon-g{animation:b-aicon-pulse .9s ease-in-out}
.b-aicon[data-anim=pulse][data-play=loop] .b-aicon-g{animation:b-aicon-pulse-loop 2.4s ease-in-out infinite}
.b-aicon[data-anim=wiggle][data-play=run] .b-aicon-g{animation:b-aicon-wiggle .8s ease-in-out}
.b-aicon[data-anim=wiggle][data-play=loop] .b-aicon-g{animation:b-aicon-wiggle-loop 2.6s ease-in-out infinite}
.b-aicon[data-anim=float][data-play=run] .b-aicon-g{animation:b-aicon-float 1.6s ease-in-out}
.b-aicon[data-anim=float][data-play=loop] .b-aicon-g{animation:b-aicon-float 3s ease-in-out infinite}
.b-aicon[data-offscreen] *{animation-play-state:paused!important}
}
html[data-b-paused] .b-aicon[data-play=loop] *{animation:none!important}
@keyframes b-aicon-draw{from{stroke-dasharray:1 2;stroke-dashoffset:1.01}to{stroke-dasharray:1 2;stroke-dashoffset:0}}
@keyframes b-aicon-draw-loop{0%{stroke-dasharray:1 2;stroke-dashoffset:1.01;opacity:1}35%,80%{stroke-dasharray:1 2;stroke-dashoffset:0;opacity:1}95%{stroke-dasharray:1 2;stroke-dashoffset:0;opacity:0}100%{stroke-dasharray:1 2;stroke-dashoffset:1.01;opacity:0}}
@keyframes b-aicon-pop{0%{opacity:0;transform:scale(.4)}60%{opacity:1;transform:scale(1.12)}100%{opacity:1;transform:scale(1)}}
@keyframes b-aicon-pop-loop{0%,34%,100%{transform:scale(1)}10%{transform:scale(.82)}22%{transform:scale(1.14)}}
@keyframes b-aicon-bounce{0%,50%,85%,100%{transform:translateY(0)}30%{transform:translateY(-7px)}70%{transform:translateY(-3px)}}
@keyframes b-aicon-bounce-loop{0%,20%,36%,100%{transform:translateY(0)}12%{transform:translateY(-7px)}28%{transform:translateY(-3px)}}
@keyframes b-aicon-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes b-aicon-spin-loop{0%{transform:rotate(0)}40%,100%{transform:rotate(360deg)}}
@keyframes b-aicon-pulse{0%,50%,100%{transform:scale(1)}25%{transform:scale(1.15)}75%{transform:scale(1.08)}}
@keyframes b-aicon-pulse-loop{0%,20%,40%,100%{transform:scale(1)}10%{transform:scale(1.15)}30%{transform:scale(1.08)}}
@keyframes b-aicon-wiggle{0%,100%{transform:rotate(0)}15%{transform:rotate(-12deg)}35%{transform:rotate(10deg)}55%{transform:rotate(-7deg)}75%{transform:rotate(4deg)}}
@keyframes b-aicon-wiggle-loop{0%,32%,100%{transform:rotate(0)}6%{transform:rotate(-12deg)}14%{transform:rotate(10deg)}22%{transform:rotate(-7deg)}28%{transform:rotate(4deg)}}
@keyframes b-aicon-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
`

/** The CSS of the animated icons, added once to the document head (React 19 style hoisting). */
export function AnimatedIconStyles() {
  return (
    <style href="b20-animated-icon" precedence="b20">
      {ICON_CSS}
    </style>
  )
}

export function AnimatedIconArt({ name, animation = 'draw', trigger = 'view', size = 64, stroke = 2, color = 'var(--sf-primary, #2563eb)', background = 'none', playing, className }: AnimatedIconArtProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const paths = isAnimatedIconName(name) ? ANIMATED_ICONS[name] : null
  useGraphicPlay(ref, { trigger, animated: animation !== 'none' && paths !== null, playing })
  const art = iconArtSize(size, background)

  return (
    <>
      <AnimatedIconStyles />
      <span ref={ref} aria-hidden className={className ? `b-aicon ${className}` : 'b-aicon'} data-anim={animation} data-trigger={trigger} data-icon={name} style={iconBoxStyle(size, background, color)}>
        {paths && (
          <svg viewBox="0 0 48 48" width={art} height={art} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" focusable="false" aria-hidden>
            <g className="b-aicon-g">
              {paths.map((d, index) => (
                <path key={index} className="b-aicon-p" d={d} pathLength={1} style={{ '--i': index } as CSSProperties} />
              ))}
            </g>
          </svg>
        )}
      </span>
    </>
  )
}

export default AnimatedIconArt
