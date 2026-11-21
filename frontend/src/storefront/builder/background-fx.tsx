import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { REDUCED_MOTION_QUERY, useMediaQuery } from '../components/use-media-query'
import { ambientMotionOn, useLongMotion, useMotionMode, usePausedMotion } from './motion-pause'
import { planBackgroundFx, type FxParticle, type FxPlan } from './background-fx-model'
import { useOnScreen } from './background-fx-observer'
import type { BackgroundFx } from './types'

/*
 * B20 moving backgrounds: a decorative layer (aria-hidden, inert, no pointer events, clipped to
 * the node) behind a section's or inner row's content. CSS and SVG only — no canvas: particles are
 * absolutely positioned spans whose transform / opacity animate (gradient_flow moves the
 * background-position of one large gradient). The keyframes always carry a negative delay, so a
 * stopped layer is a still, already spread-out frame: that is what reduced motion, the shopper's
 * "Pause animations", an off-screen layer and the editor canvas (without "Preview motion") show.
 * Moving for longer than 5 s, a live layer offers the Pause toggle. It fades in after the first
 * paint and takes no space (no layout shift). The node's background overlay is drawn by the scrim
 * right after it (picture → moving things → overlay → content), so the overlay applies once.
 */

function particleStyle(particle: FxParticle, plan: FxPlan): CSSProperties {
  return {
    '--x': `${particle.x}%`,
    '--y': `${particle.y}%`,
    '--s': `${particle.size}px`,
    '--d': `${particle.duration}s`,
    '--dl': `${particle.delay}s`,
    '--dx': `${particle.dx}px`,
    '--dy': `${particle.dy}px`,
    '--r': `${particle.rotate}deg`,
    '--o': particle.opacity,
    '--c': plan.colors[particle.color] ?? plan.colors[0],
  } as CSSProperties
}

/** A paper lantern (24 × 40): string, cap, glowing body, tassel. */
function Lantern() {
  return (
    <svg viewBox="0 0 24 40" focusable="false" className="b-fx-lantern">
      <path d="M12 0v6" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      <rect x="8" y="6" width="8" height="3" rx="1" fill="currentColor" />
      <ellipse cx="12" cy="20" rx="9" ry="11" fill="currentColor" opacity="0.85" />
      <ellipse cx="12" cy="20" rx="4" ry="8" fill="#fff" opacity="0.28" />
      <rect x="8" y="30" width="8" height="3" rx="1" fill="currentColor" />
      <path d="M12 33v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The moving background of one node. `seed` (the node id) fixes the placement; `preview` (the
 * editor's type tiles) runs it regardless of the canvas mode and without announcing long motion.
 */
export function BackgroundFxLayer({ fx, seed, preview = false }: { fx: BackgroundFx; seed: string; preview?: boolean }) {
  const mode = useMotionMode()
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY)
  const paused = usePausedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const ambient = preview || ambientMotionOn(mode)
  const onScreen = useOnScreen(ref, ambient && !reduced)
  // Shoppers can pause it: it moves for longer than 5 s.
  useLongMotion(!preview && mode === 'live' && !reduced)
  // Nothing of it on the first paint: it fades in once the page is drawn (`data-ready`).
  useEffect(() => {
    const show = () => ref.current?.setAttribute('data-ready', '')
    if (typeof requestAnimationFrame === 'undefined') return show()
    const frame = requestAnimationFrame(show)
    return () => cancelAnimationFrame(frame)
  }, [])

  const { type, density, speed } = fx
  const colorKey = fx.colors?.join(',') ?? ''
  const plan = useMemo(
    () =>
      planBackgroundFx(
        {
          type,
          density,
          speed,
          colors: colorKey ? (colorKey.split(',') as BackgroundFx['colors']) : undefined,
        },
        seed,
      ),
    [type, density, speed, colorKey, seed],
  )
  const running = ambient && !reduced && !paused && onScreen
  const flow = plan.motion === 'flow'
  const gradientStyle = flow
    ? ({
        '--d': `${plan.flowSeconds}s`,
        '--c1': plan.colors[0],
        '--c2': plan.colors[1] ?? plan.colors[0],
        '--c3': plan.colors[2] ?? plan.colors[0],
      } as CSSProperties)
    : undefined

  return (
    <>
      <div ref={ref} className="b-fx" aria-hidden inert data-fx={plan.kind} data-motion={plan.motion} data-state={running ? 'running' : 'paused'} data-testid="builder-bg-fx">
        {flow ? (
          <div className="b-fx-gradient" style={gradientStyle} />
        ) : (
          plan.particles.map((particle, index) => (
            <span key={index} className="b-fx-p" data-v={particle.variant} style={particleStyle(particle, plan)}>
              {plan.kind === 'lanterns' ? <Lantern /> : null}
            </span>
          ))
        )}
      </div>
      {/* The node's background overlay (compile-styles `--b-fx-scrim`): above the moving things, below the content, there from the first paint. */}
      <div className="b-fx-scrim" aria-hidden data-testid="builder-bg-fx-scrim" />
    </>
  )
}
