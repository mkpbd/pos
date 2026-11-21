import { BACKDROP, sparklePath } from './scene-paths'
import { SceneSvg, type SceneProps } from './scene'

/* A gift box shakes, its lid pops open and sparkles rise out of it (the final frame: lid open). */

const CSS = `
.b-ill .gu-lid{transform:translate(-8px,-28px) rotate(-12deg);animation:b-ill-gu-lid 2.4s cubic-bezier(.34,1.4,.64,1) var(--b-ill-n,1)}
.b-ill .gu-box{transform-origin:50% 100%;animation:b-ill-gu-box 2.4s ease-in-out var(--b-ill-n,1)}
.b-ill .gu-spark{animation:b-ill-gu-spark 2.4s ease-out var(--b-ill-n,1) both}
.b-ill .gu-spark-2{animation-delay:.1s}
.b-ill .gu-spark-3{animation-delay:.2s}
@keyframes b-ill-gu-lid{0%,30%{transform:translate(0,0) rotate(0)}48%{transform:translate(-10px,-38px) rotate(-17deg)}60%,100%{transform:translate(-8px,-28px) rotate(-12deg)}}
@keyframes b-ill-gu-box{0%,32%,100%{transform:rotate(0)}6%{transform:rotate(-3deg)}12%{transform:rotate(3deg)}18%{transform:rotate(-2deg)}24%{transform:rotate(2deg)}}
@keyframes b-ill-gu-spark{0%,40%{opacity:0;transform:translateY(40px) scale(.2)}62%{opacity:1;transform:translateY(-4px) scale(1.15)}75%,100%{opacity:1;transform:translateY(0) scale(1)}}
`

export default function GiftUnwrap({ palette }: SceneProps) {
  return (
    <SceneSvg name="gift_unwrap" palette={palette} css={CSS}>
      <path d={BACKDROP} className="f4" />
      <ellipse cx={160} cy={216} rx={74} ry={8} className="f5" opacity={0.14} />
      <path d={sparklePath(124, 70, 12)} className="f2 b-ill-m gu-spark gu-spark-1" />
      <path d={sparklePath(168, 52, 16)} className="f3 b-ill-m gu-spark gu-spark-2" />
      <path d={sparklePath(206, 82, 10)} className="f2 b-ill-m gu-spark gu-spark-3" />
      <g className="b-ill-m gu-box">
        <rect x={102} y={122} width={116} height={92} rx={6} className="f1" />
        <rect x={150} y={122} width={20} height={92} className="f2" />
        <rect x={102} y={122} width={116} height={12} className="f5" opacity={0.16} />
      </g>
      <g className="b-ill-m gu-lid">
        <rect x={94} y={100} width={132} height={26} rx={6} className="f1" />
        <rect x={150} y={100} width={20} height={26} className="f2" />
        <path d="M160 100c-10-20-34-26-36-12-2 12 22 12 36 12z" className="f3" />
        <path d="M160 100c10-20 34-26 36-12 2 12-22 12-36 12z" className="f3" />
        <circle cx={160} cy={99} r={7} className="f2" />
      </g>
    </SceneSvg>
  )
}
