import { BACKDROP } from './scene-paths'
import { SceneSvg, type SceneProps } from './scene'

/* A phone buzzes with a new order and a check badge pops up beside it. */

const CSS = `
.b-ill .po-phone{animation:b-ill-po-buzz 2.4s linear var(--b-ill-n,1)}
.b-ill .po-wave{animation:b-ill-po-wave 2.4s ease-out var(--b-ill-n,1)}
.b-ill .po-badge{animation:b-ill-po-badge 2.4s cubic-bezier(.34,1.56,.64,1) var(--b-ill-n,1) both}
.b-ill .po-tap{animation:b-ill-po-tap 2.4s ease-in-out var(--b-ill-n,1)}
@keyframes b-ill-po-buzz{0%,36%,100%{transform:rotate(0)}4%,12%,20%,28%{transform:rotate(-4deg)}8%,16%,24%,32%{transform:rotate(4deg)}}
@keyframes b-ill-po-wave{0%,100%{opacity:1;transform:scale(1)}18%{opacity:.2;transform:scale(.85)}36%{opacity:1;transform:scale(1.1)}50%{transform:scale(1)}}
@keyframes b-ill-po-badge{0%,40%{opacity:0;transform:scale(0)}56%{opacity:1;transform:scale(1.2)}66%,100%{opacity:1;transform:scale(1)}}
@keyframes b-ill-po-tap{0%,40%,100%{transform:scale(1)}48%{transform:scale(.9)}56%{transform:scale(1)}}
`

export default function PhoneOrder({ palette }: SceneProps) {
  return (
    <SceneSvg name="phone_order" palette={palette} css={CSS}>
      <path d={BACKDROP} className="f4" />
      <g className="b-ill-m po-wave">
        <path d="M92 92a40 40 0 0 0 0 56M78 80a58 58 0 0 0 0 80" className="ln s2" strokeWidth={6} />
        <path d="M228 92a40 40 0 0 1 0 56M242 80a58 58 0 0 1 0 80" className="ln s2" strokeWidth={6} />
      </g>
      <g className="b-ill-m po-phone">
        <rect x={114} y={28} width={92} height={186} rx={16} className="f5" />
        <rect x={122} y={44} width={76} height={154} rx={8} className="f6" />
        <path d="M122 52a8 8 0 0 1 8-8h60a8 8 0 0 1 8 8v12h-76z" className="f1" />
        <rect x={130} y={74} width={22} height={22} rx={4} className="f3" />
        <rect x={158} y={78} width={32} height={6} rx={3} className="f4" />
        <rect x={158} y={88} width={20} height={6} rx={3} className="f4" />
        <rect x={130} y={104} width={22} height={22} rx={4} className="f2" />
        <rect x={158} y={108} width={32} height={6} rx={3} className="f4" />
        <rect x={158} y={118} width={20} height={6} rx={3} className="f4" />
        <rect x={130} y={136} width={60} height={6} rx={3} className="f4" />
        <rect x={130} y={164} width={60} height={20} rx={10} className="f1 b-ill-m po-tap" />
        <path d="M152 174h16" className="ln s6" strokeWidth={4} />
        <rect x={146} y={33} width={28} height={5} rx={2.5} className="f6" opacity={0.4} />
      </g>
      <g className="b-ill-m po-badge">
        <circle cx={212} cy={50} r={22} className="f2" />
        <path d="M202 50l7 7 13-14" className="ln s6" strokeWidth={6} />
      </g>
    </SceneSvg>
  )
}
