import { BACKDROP } from './scene-paths'
import { SceneSvg, type SceneProps } from './scene'

/*
 * A parcel travels along a dashed path from the shop to a home, where a check pops up. Its drawn
 * pose (the final frame) is at the door; the keyframes follow the curve's points from the shop.
 */

const CSS = `
.b-ill .pj-parcel{animation:b-ill-pj-parcel 2.4s ease-in-out var(--b-ill-n,1)}
.b-ill .pj-path{animation:b-ill-pj-path 2.4s linear var(--b-ill-n,1)}
.b-ill .pj-check{animation:b-ill-pj-check 2.4s cubic-bezier(.34,1.56,.64,1) var(--b-ill-n,1) both}
@keyframes b-ill-pj-parcel{0%,8%{transform:translate(-133px,0) rotate(-8deg)}24%{transform:translate(-101px,-34px) rotate(-4deg)}40%{transform:translate(-64px,-45px) rotate(0)}56%{transform:translate(-32px,-34px) rotate(4deg)}72%,100%{transform:translate(0,0) rotate(0)}}
@keyframes b-ill-pj-path{from{stroke-dashoffset:56}to{stroke-dashoffset:0}}
@keyframes b-ill-pj-check{0%,74%{opacity:0;transform:scale(0)}86%{opacity:1;transform:scale(1.2)}92%,100%{opacity:1;transform:scale(1)}}
`

export default function ParcelJourney({ palette }: SceneProps) {
  return (
    <SceneSvg name="parcel_journey" palette={palette} css={CSS}>
      <path d={BACKDROP} className="f4" />
      <rect x={16} y={186} width={288} height={6} rx={3} className="f5" opacity={0.2} />
      {/* The shop */}
      <rect x={30} y={120} width={64} height={66} className="f1" />
      <path d="M24 106h76l-6 16H30z" className="f2" />
      <path d="M40 106l-4 16M56 106v16M72 106v16M88 106l4 16" className="ln s6" strokeWidth={3} opacity={0.6} />
      <rect x={52} y={150} width={20} height={36} rx={2} className="f6" />
      {/* The home */}
      <path d="M226 128l34-30 34 30" className="f5" />
      <rect x={232} y={126} width={56} height={60} className="f3" />
      <rect x={252} y={152} width={16} height={34} rx={2} className="f6" />
      <rect x={238} y={136} width={12} height={12} rx={2} className="f6" />
      {/* The way */}
      <path d="M95 160C130 100 200 100 228 160" className="ln s5 b-ill-m pj-path" strokeWidth={4} strokeDasharray="6 8" opacity={0.55} />
      <g className="b-ill-m pj-parcel">
        <rect x={203} y={136} width={30} height={24} rx={3} className="f2" />
        <path d="M218 136v24" className="ln s6" strokeWidth={4} opacity={0.7} />
      </g>
      <g className="b-ill-m pj-check">
        <circle cx={286} cy={86} r={18} className="f1" />
        <path d="M278 86l6 6 10-11" className="ln s6" strokeWidth={5} />
      </g>
    </SceneSvg>
  )
}
