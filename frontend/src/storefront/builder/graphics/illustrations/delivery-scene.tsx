import { useId } from 'react'
import { BACKDROP } from './scene-paths'
import { SceneSvg, type SceneProps } from './scene'

/* A delivery van on its way: the van bobs, its wheels spin, the road and the clouds slide by. */

const CSS = `
.b-ill .ds-van{animation:b-ill-ds-van 2.4s ease-in-out var(--b-ill-n,1)}
.b-ill .ds-wheel{animation:b-ill-ds-wheel 2.4s linear var(--b-ill-n,1)}
.b-ill .ds-road{animation:b-ill-ds-road 2.4s linear var(--b-ill-n,1)}
.b-ill .ds-cloud{animation:b-ill-ds-cloud 2.4s ease-in-out var(--b-ill-n,1)}
.b-ill .ds-speed{animation:b-ill-ds-speed 2.4s ease-in-out var(--b-ill-n,1)}
@keyframes b-ill-ds-wheel{from{transform:rotate(-1080deg)}to{transform:rotate(0)}}
@keyframes b-ill-ds-van{0%,25%,50%,75%,100%{transform:translateY(0)}12.5%,37.5%,62.5%,87.5%{transform:translateY(-3px)}}
@keyframes b-ill-ds-road{from{transform:translateX(48px)}to{transform:translateX(0)}}
@keyframes b-ill-ds-cloud{0%,100%{transform:translateX(0)}50%{transform:translateX(-14px)}}
@keyframes b-ill-ds-speed{0%,50%,100%{opacity:1;transform:translateX(0)}25%,75%{opacity:.2;transform:translateX(-10px)}}
`

function Wheel({ x }: { x: number }) {
  return (
    <g className="b-ill-m ds-wheel">
      <circle cx={x} cy={180} r={17} className="f5" />
      <circle cx={x} cy={180} r={7} className="f6" />
      <path d={`M${x} 166v28M${x - 14} 180h28`} className="ln s6" strokeWidth={3} opacity={0.5} />
    </g>
  )
}

export default function DeliveryScene({ palette }: SceneProps) {
  const road = `ds${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-road`
  return (
    <SceneSvg name="delivery_scene" palette={palette} css={CSS}>
      <path d={BACKDROP} className="f4" />
      <g className="b-ill-m ds-cloud">
        <path d="M58 70a14 14 0 0 1 26-6 11 11 0 0 1 14 11H52a7 7 0 0 1 6-5z" className="f6" />
        <path d="M214 52a12 12 0 0 1 22-5 9 9 0 0 1 12 9h-38a6 6 0 0 1 4-4z" className="f6" />
      </g>
      <clipPath id={road}>
        <rect x={16} y={188} width={288} height={14} rx={7} />
      </clipPath>
      <rect x={16} y={188} width={288} height={14} rx={7} className="f5" />
      <g clipPath={`url(#${road})`}>
        <g className="b-ill-m ds-road">
          <path d="M-24 195h20M24 195h20M72 195h20M120 195h20M168 195h20M216 195h20M264 195h20" className="ln s6" strokeWidth={3} />
        </g>
      </g>
      <g className="b-ill-m ds-speed">
        <path d="M44 120h34M30 140h44M50 160h26" className="ln s2" strokeWidth={6} />
      </g>
      <g className="b-ill-m ds-van">
        <rect x={90} y={100} width={130} height={78} rx={12} className="f1" />
        <path d="M220 124h30a8 8 0 0 1 6 3l22 27a8 8 0 0 1 2 5v13a6 6 0 0 1-6 6h-54z" className="f1" />
        <path d="M228 132h20l18 22h-38z" className="f6" />
        <rect x={90} y={150} width={130} height={10} className="f2" />
        <rect x={120} y={114} width={44} height={28} rx={4} className="f2" />
        <path d="M142 114v28M120 126h44" className="ln s5" strokeWidth={3} opacity={0.35} />
        <rect x={272} y={162} width={10} height={8} rx={3} className="f3" />
      </g>
      <Wheel x={128} />
      <Wheel x={240} />
    </SceneSvg>
  )
}
