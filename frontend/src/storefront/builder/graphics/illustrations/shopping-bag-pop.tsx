import { BACKDROP, sparklePath } from './scene-paths'
import { SceneSvg, type SceneProps } from './scene'

/* A shopping bag bounces and its goodies pop out (a star, a heart, a little box), sparkles twinkle. */

const CSS = `
.b-ill .sb-bag{transform-origin:50% 100%;animation:b-ill-sb-bag 2.4s ease-out var(--b-ill-n,1)}
.b-ill .sb-item{animation:b-ill-sb-item 2.4s cubic-bezier(.34,1.56,.64,1) var(--b-ill-n,1) both}
.b-ill .sb-item-2{animation-delay:.1s}
.b-ill .sb-item-3{animation-delay:.2s}
.b-ill .sb-spark{animation:b-ill-sb-spark 2.4s ease-in-out var(--b-ill-n,1)}
.b-ill .sb-shadow{transform-origin:50% 50%;animation:b-ill-sb-shadow 2.4s ease-out var(--b-ill-n,1)}
@keyframes b-ill-sb-bag{0%,45%,100%{transform:translateY(0) scale(1)}10%{transform:translateY(4px) scale(1.04,.94)}24%{transform:translateY(-16px) scale(.98,1.03)}36%{transform:translateY(0) scale(1.02,.98)}}
@keyframes b-ill-sb-shadow{0%,45%,100%{transform:scale(1)}24%{transform:scale(.8)}}
@keyframes b-ill-sb-item{0%,18%{opacity:0;transform:translateY(46px) scale(.3)}46%{opacity:1;transform:translateY(-6px) scale(1.06)}58%,100%{opacity:1;transform:translateY(0) scale(1)}}
@keyframes b-ill-sb-spark{0%,40%,100%{opacity:1;transform:scale(1)}55%{opacity:.3;transform:scale(.5)}70%{opacity:1;transform:scale(1.2)}}
`

export default function ShoppingBagPop({ palette }: SceneProps) {
  return (
    <SceneSvg name="shopping_bag_pop" palette={palette} css={CSS}>
      <path d={BACKDROP} className="f4" />
      <ellipse cx={160} cy={214} rx={70} ry={8} className="f5 b-ill-m sb-shadow" opacity={0.14} />
      <g className="b-ill-m sb-item sb-item-1">
        <path d="M118 54l7 14 15 2-11 10 3 15-14-7-14 7 3-15-11-10 15-2z" className="f2" />
      </g>
      <g className="b-ill-m sb-item sb-item-2">
        <path d="M160 70s-20-12-20-26a10 10 0 0 1 20-4 10 10 0 0 1 20 4c0 14-20 26-20 26z" className="f3" />
      </g>
      <g className="b-ill-m sb-item sb-item-3">
        <rect x={186} y={52} width={32} height={30} rx={4} className="f1" transform="rotate(12 202 67)" />
        <path d="M202 52v30" className="ln s6" strokeWidth={4} transform="rotate(12 202 67)" />
      </g>
      <g className="b-ill-m sb-bag">
        <path d="M136 96V84a24 24 0 0 1 48 0v12" className="ln s5" strokeWidth={8} />
        <path d="M104 96h112l12 110a6 6 0 0 1-6 7H98a6 6 0 0 1-6-7z" className="f1" />
        <path d="M104 96h112l2 18H102z" className="f5" opacity={0.18} />
        <circle cx={160} cy={156} r={24} className="f6" />
        <path d="M160 168s-12-7-12-15a6 6 0 0 1 12-2 6 6 0 0 1 12 2c0 8-12 15-12 15z" className="f3" />
      </g>
      <path d={sparklePath(84, 108, 10)} className="f2 b-ill-m sb-spark" />
      <path d={sparklePath(238, 120, 8)} className="f3 b-ill-m sb-spark" />
      <path d={sparklePath(250, 70, 6)} className="f2 b-ill-m sb-spark" />
    </SceneSvg>
  )
}
