import { BACKDROP, sparklePath } from './scene-paths'
import { SceneSvg, type SceneProps } from './scene'

/* A price tag with a percent sign swings on its string; confetti drifts down around it. */

const CSS = `
.b-ill .st-tag{transform-origin:50% 0;animation:b-ill-st-swing 2.4s ease-in-out var(--b-ill-n,1)}
.b-ill .st-bit{animation:b-ill-st-bit 2.4s ease-in-out var(--b-ill-n,1)}
.b-ill .st-bit-2{animation-delay:.1s}
.b-ill .st-bit-3{animation-delay:.2s}
@keyframes b-ill-st-swing{0%,100%{transform:rotate(0)}14%{transform:rotate(12deg)}32%{transform:rotate(-9deg)}50%{transform:rotate(6deg)}68%{transform:rotate(-3deg)}84%{transform:rotate(1deg)}}
@keyframes b-ill-st-bit{0%{opacity:0;transform:translateY(-24px) rotate(-40deg)}30%{opacity:1}70%,100%{opacity:1;transform:translateY(0) rotate(0)}}
`

export default function SaleTagSwing({ palette }: SceneProps) {
  return (
    <SceneSvg name="sale_tag_swing" palette={palette} css={CSS}>
      <path d={BACKDROP} className="f4" />
      <rect x={110} y={26} width={100} height={8} rx={4} className="f5" opacity={0.25} />
      <circle cx={160} cy={30} r={7} className="f5" />
      <g className="b-ill-m st-tag">
        <path d="M160 30L160 92" className="ln s5" strokeWidth={3} />
        <path d="M160 72l46 38a8 8 0 0 1 3 6v84a10 10 0 0 1-10 10h-78a10 10 0 0 1-10-10v-84a8 8 0 0 1 3-6z" className="f1" />
        <circle cx={160} cy={100} r={8} className="f6" />
        <circle cx={141} cy={140} r={10} className="ln s6" strokeWidth={7} />
        <circle cx={179} cy={182} r={10} className="ln s6" strokeWidth={7} />
        <path d="M184 130l-48 62" className="ln s6" strokeWidth={8} />
        <rect x={111} y={196} width={98} height={8} className="f2" />
      </g>
      <g className="b-ill-m st-bit st-bit-1">
        <rect x={64} y={92} width={12} height={6} rx={2} className="f2" transform="rotate(25 70 95)" />
      </g>
      <g className="b-ill-m st-bit st-bit-2">
        <circle cx={250} cy={110} r={5} className="f3" />
      </g>
      <g className="b-ill-m st-bit st-bit-3">
        <rect x={236} y={168} width={12} height={6} rx={2} className="f1" transform="rotate(-30 242 171)" />
      </g>
      <g className="b-ill-m st-bit st-bit-2">
        <circle cx={78} cy={170} r={4} className="f1" />
      </g>
      <path d={sparklePath(250, 60, 10)} className="f2" />
      <path d={sparklePath(72, 52, 7)} className="f3" />
    </SceneSvg>
  )
}
