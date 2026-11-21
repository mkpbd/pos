import { BACKDROP } from './scene-paths'
import { SceneSvg, type SceneProps } from './scene'

/* A happy shopper with her bags waves hello; little hearts float up. */

const CSS = `
.b-ill .hs-arm{transform-origin:0 100%;animation:b-ill-hs-wave 2.4s ease-in-out var(--b-ill-n,1)}
.b-ill .hs-body{transform-origin:50% 100%;animation:b-ill-hs-bob 2.4s ease-in-out var(--b-ill-n,1)}
.b-ill .hs-heart{animation:b-ill-hs-heart 2.4s ease-out var(--b-ill-n,1) both}
.b-ill .hs-heart-2{animation-delay:.2s}
@keyframes b-ill-hs-wave{0%,72%,100%{transform:rotate(0)}12%{transform:rotate(-22deg)}26%{transform:rotate(8deg)}40%{transform:rotate(-18deg)}54%{transform:rotate(6deg)}}
@keyframes b-ill-hs-bob{0%,50%,100%{transform:translateY(0)}25%,75%{transform:translateY(-4px)}}
@keyframes b-ill-hs-heart{0%{opacity:0;transform:translateY(30px) scale(.4)}40%{opacity:1;transform:translateY(-4px) scale(1.1)}55%,100%{opacity:1;transform:translateY(0) scale(1)}}
`

export default function HappyShopper({ palette }: SceneProps) {
  return (
    <SceneSvg name="happy_shopper" palette={palette} css={CSS}>
      <path d={BACKDROP} className="f4" />
      <ellipse cx={156} cy={216} rx={62} ry={7} className="f5" opacity={0.14} />
      <g className="b-ill-m hs-body">
        {/* Legs */}
        <rect x={138} y={160} width={12} height={54} rx={6} className="f5" />
        <rect x={160} y={160} width={12} height={54} rx={6} className="f5" />
        {/* Left arm down to the bags */}
        <path d="M134 104l-18 52" className="ln s7" strokeWidth={11} />
        {/* Bags */}
        <path d="M94 156v-8a10 10 0 0 1 20 0v8" className="ln s5" strokeWidth={4} />
        <rect x={86} y={154} width={36} height={44} rx={4} className="f2" />
        <path d="M118 166v-6a8 8 0 0 1 16 0v6" className="ln s5" strokeWidth={4} />
        <rect x={112} y={164} width={30} height={36} rx={4} className="f3" />
        {/* Body */}
        <path d="M138 96h34l12 72h-58z" className="f1" />
        {/* Head and hair */}
        <rect x={149} y={82} width={12} height={16} rx={5} className="f7" />
        <path d="M130 58c0-20 50-20 50 0v28c0 6-6 6-6 0V64h-38v22c0 6-6 6-6 0z" className="f5" />
        <circle cx={155} cy={66} r={20} className="f7" />
        <path d="M135 62c4-14 30-18 40-4-10-2-26-2-40 4z" className="f5" />
        <circle cx={148} cy={67} r={2.5} className="f5" />
        <circle cx={162} cy={67} r={2.5} className="f5" />
        <path d="M147 75a9 9 0 0 0 16 0" className="ln s5" strokeWidth={3} />
        {/* Right arm, waving from the shoulder */}
        <g className="b-ill-m hs-arm">
          <path d="M174 102l22-34" className="ln s7" strokeWidth={11} />
          <circle cx={198} cy={62} r={8} className="f7" />
        </g>
      </g>
      <path d="M226 74s-10-6-10-13a5 5 0 0 1 10-2 5 5 0 0 1 10 2c0 7-10 13-10 13z" className="f3 b-ill-m hs-heart hs-heart-1" />
      <path d="M246 104s-7-4-7-9a3.5 3.5 0 0 1 7-1.5 3.5 3.5 0 0 1 7 1.5c0 5-7 9-7 9z" className="f2 b-ill-m hs-heart hs-heart-2" />
    </SceneSvg>
  )
}
