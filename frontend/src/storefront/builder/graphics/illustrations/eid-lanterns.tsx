import { sparklePath } from './scene-paths'
import { SceneSvg, type SceneProps } from './scene'

/* An Eid night: three lanterns sway on their strings under a crescent moon; stars twinkle. */

const CSS = `
.b-ill .el-lantern{transform-origin:50% 0;animation:b-ill-el-sway 2.4s ease-in-out var(--b-ill-n,1)}
.b-ill .el-lantern-2{animation-delay:.1s}
.b-ill .el-lantern-3{animation-delay:.2s}
.b-ill .el-star{animation:b-ill-el-star 2.4s ease-in-out var(--b-ill-n,1)}
.b-ill .el-star-2{animation-delay:.2s}
.b-ill .el-glow{animation:b-ill-el-glow 2.4s ease-in-out var(--b-ill-n,1)}
@keyframes b-ill-el-sway{0%,100%{transform:rotate(0)}25%{transform:rotate(6deg)}50%{transform:rotate(-5deg)}75%{transform:rotate(3deg)}}
@keyframes b-ill-el-star{0%,100%{opacity:1;transform:scale(1)}30%{opacity:.3;transform:scale(.5)}60%{opacity:1;transform:scale(1.25)}}
@keyframes b-ill-el-glow{0%,100%{opacity:.9}50%{opacity:.45}}
`

function Lantern({ x, top, length, size, index }: { x: number; top: number; length: number; size: number; index: number }) {
  const y = top + length
  const w = size
  const h = size * 1.5
  return (
    <g className={`b-ill-m el-lantern el-lantern-${index}`}>
      <path d={`M${x} ${top}V${y}`} className="ln s2" strokeWidth={2} />
      <circle cx={x} cy={y + 2} r={4} className="f2" />
      <path d={`M${x - w * 0.35} ${y + 6}h${w * 0.7}l${w * 0.15} ${h * 0.14}h${-w}z`} className="f2" />
      <rect x={x - w / 2} y={y + 6 + h * 0.14} width={w} height={h * 0.62} rx={w * 0.22} className="f1" />
      <rect x={x - w * 0.24} y={y + 6 + h * 0.22} width={w * 0.48} height={h * 0.46} rx={w * 0.2} className="f2 b-ill-m el-glow" />
      <path d={`M${x - w / 2} ${y + 6 + h * 0.76}h${w}l${-w * 0.15} ${h * 0.12}h${-w * 0.7}z`} className="f2" />
      <path d={`M${x} ${y + 6 + h * 0.88}v${h * 0.12}`} className="ln s2" strokeWidth={3} />
    </g>
  )
}

export default function EidLanterns({ palette }: SceneProps) {
  return (
    <SceneSvg name="eid_lanterns" palette={palette} css={CSS}>
      <rect x={12} y={12} width={296} height={216} rx={28} className="f5" />
      <circle cx={250} cy={66} r={26} className="f2" />
      <circle cx={262} cy={58} r={23} className="f5" />
      <path d={sparklePath(200, 44, 7)} className="f6 b-ill-m el-star el-star-1" />
      <path d={sparklePath(284, 120, 6)} className="f6 b-ill-m el-star el-star-2" />
      <path d={sparklePath(40, 140, 6)} className="f6 b-ill-m el-star el-star-1" />
      <circle cx={222} cy={104} r={2.5} className="f6" opacity={0.7} />
      <circle cx={52} cy={196} r={2} className="f6" opacity={0.6} />
      <path d="M12 200h296v0a28 28 0 0 1-28 28H40a28 28 0 0 1-28-28z" className="f1" opacity={0.55} />
      <path d="M118 200v-26a42 42 0 0 1 84 0v26z" className="f1" opacity={0.75} />
      <path d="M160 132v-10" className="ln s2" strokeWidth={3} />
      <path d="M86 200v-54l6-8 6 8v54zM222 200v-54l6-8 6 8v54z" className="f1" opacity={0.75} />
      <Lantern x={70} top={12} length={30} size={34} index={1} />
      <Lantern x={130} top={12} length={58} size={26} index={2} />
      <Lantern x={186} top={12} length={20} size={30} index={3} />
    </SceneSvg>
  )
}
