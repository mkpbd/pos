/*
 * B20 Theme → "Add to cart" effects (store-wide, theme `effects`): what shoppers see when a product
 * goes into the cart — the product picture flies to the cart, only the cart count bumps, or
 * nothing — and the button's brief "Added" check. A small stage previews the choice (Web
 * Animations on transform / opacity; still under "reduce motion"). Part of the theme form: the
 * values are saved with the draft and go live when the theme is published.
 */

import { useEffect, useRef, useState } from 'react'
import { CheckIcon, PlayIcon, ShoppingCartIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { TileGroup } from '@/features/store-builder/inspector/b18-motion-tiles'
import { prefersReducedMotion } from '@/features/store-builder/inspector/b18-motion'
import type { AddToCartEffect, ThemeEffects } from '@/storefront/types'
import { ADD_TO_CART_EFFECTS } from '../theme-form'

const ADD_TO_CART_LABELS: Record<AddToCartEffect, { label: string; hint: string }> = {
  fly: { label: 'Fly to cart', hint: 'A small copy of the product picture flies into the cart, then the cart count bumps.' },
  bump: { label: 'Bump the cart', hint: 'Only the cart count bumps.' },
  none: { label: 'None', hint: 'The cart count changes without any movement.' },
}

const canAnimate = (el: Element | null): el is HTMLElement => !!el && typeof (el as HTMLElement).animate === 'function'

/** Plays one run of the effect on the preview's parts (nothing under "reduce motion"). */
function playEffect(effect: AddToCartEffect, parts: { button: HTMLElement | null; flyer: HTMLElement | null; cart: HTMLElement | null; count: HTMLElement | null }): Animation[] {
  if (prefersReducedMotion()) return []
  const runs: Animation[] = []
  const add = (el: HTMLElement | null, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
    if (!canAnimate(el)) return null
    try {
      const run = el.animate(keyframes, options)
      runs.push(run)
      return run
    } catch {
      return null
    }
  }
  const bump = (delay: number) => add(parts.count, [{ transform: 'scale(1)' }, { transform: 'scale(1.45)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 360, delay, easing: 'ease-out' })
  if (effect === 'fly' && parts.flyer && parts.button && parts.cart) {
    // From the button's middle to the cart's, on a curve (up first, then down into the cart).
    const from = parts.button.getBoundingClientRect()
    const to = parts.cart.getBoundingClientRect()
    const dx = to.left + to.width / 2 - (from.left + from.width / 2)
    const dy = to.top + to.height / 2 - (from.top + from.height / 2)
    add(
      parts.flyer,
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 28}px) scale(0.8)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.35)`, opacity: 0.2 },
      ],
      { duration: 600, easing: 'ease-in-out', fill: 'none' },
    )
    bump(600)
  } else if (effect === 'bump' || effect === 'fly') {
    bump(0)
  }
  return runs
}

/** The preview: a product card's button and the header cart. */
function EffectPreview({ effects, playToken }: { effects: ThemeEffects; playToken: number }) {
  const button = useRef<HTMLButtonElement>(null)
  const flyer = useRef<HTMLSpanElement>(null)
  const cart = useRef<HTMLSpanElement>(null)
  const count = useRef<HTMLSpanElement>(null)
  const [items, setItems] = useState(2)
  const [added, setAdded] = useState(false)
  const [seenToken, setSeenToken] = useState(playToken)
  if (seenToken !== playToken) {
    setSeenToken(playToken)
    setItems((n) => (n >= 9 ? 3 : n + 1))
    setAdded(effects.button_feedback)
  }

  // Played once per press / choice (the token), with the effect in force at that moment.
  const effect = useRef(effects.add_to_cart)
  useEffect(() => {
    effect.current = effects.add_to_cart
  })
  useEffect(() => {
    if (playToken === 0) return
    const runs = playEffect(effect.current, { button: button.current, flyer: flyer.current, cart: cart.current, count: count.current })
    const timer = setTimeout(() => setAdded(false), 1200)
    return () => {
      clearTimeout(timer)
      for (const run of runs) run.cancel()
    }
  }, [playToken])

  return (
    <div aria-hidden className="relative flex h-28 items-center justify-between overflow-hidden rounded-md border bg-muted/30 px-4" data-testid="cart-effect-preview">
      <div className="flex w-32 flex-col gap-1.5 rounded-md border bg-background p-2 shadow-xs">
        <span className="relative block h-8 rounded-sm bg-primary/20">
          <span ref={flyer} className="absolute inset-x-8 inset-y-1 rounded-sm bg-primary/70" data-testid="cart-effect-flyer" />
        </span>
        {/* Both labels share one cell, so the button keeps its size when "Added" shows. */}
        <span ref={button} className="grid rounded-sm bg-primary px-2 py-1 text-center text-xs font-medium text-primary-foreground">
          <span className={cn('col-start-1 row-start-1', added && 'invisible')}>Add to cart</span>
          <span className={cn('col-start-1 row-start-1 inline-flex items-center justify-center gap-1', !added && 'invisible')} data-testid="cart-effect-added">
            <CheckIcon className="size-3" /> Added
          </span>
        </span>
      </div>
      <span ref={cart} className="relative inline-flex size-10 items-center justify-center rounded-full border bg-background">
        <ShoppingCartIcon className="size-5" />
        <span ref={count} className="absolute -top-1 -right-1 inline-flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground tabular-nums" data-testid="cart-effect-count">
          {items}
        </span>
      </span>
    </div>
  )
}

/** A tiny drawing of each choice in its tile. */
function EffectTile({ effect }: { effect: AddToCartEffect }) {
  return (
    <span aria-hidden className="pointer-events-none relative flex h-8 w-full items-center justify-between rounded-sm bg-muted/60 px-2" data-tile-art>
      <span className="block h-3 w-5 rounded-[2px] bg-primary/70" />
      {effect === 'fly' && <span className="absolute left-1/2 top-1 h-3 w-6 -translate-x-1/2 rounded-t-full border-x border-t border-dashed border-primary/70" />}
      <span className="relative">
        <ShoppingCartIcon className="size-4" />
        {effect !== 'none' && <span className="absolute -top-1 -right-1 size-2 rounded-full bg-primary ring-2 ring-primary/30" />}
      </span>
    </span>
  )
}

export function CartEffectsCard({ value, onChange, disabled, className }: { value: ThemeEffects; onChange: (value: ThemeEffects) => void; disabled?: boolean; className?: string }) {
  const [playToken, setPlayToken] = useState(0)
  const play = () => setPlayToken((t) => t + 1)
  return (
    <Card data-testid="cart-effects-card" className={className}>
      <CardHeader>
        <CardTitle>Add to cart</CardTitle>
        <CardDescription>What shoppers see when they add a product to the cart, on every page of your store.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <TileGroup<AddToCartEffect>
            label="Add to cart animation"
            tooltip="Shoppers who ask their device for less motion see the cart count change without movement."
            value={value.add_to_cart}
            columns={3}
            testId="add-to-cart-effect"
            options={ADD_TO_CART_EFFECTS.map((effect) => ({ value: effect, label: ADD_TO_CART_LABELS[effect].label, title: ADD_TO_CART_LABELS[effect].hint, disabled }))}
            onChange={(add_to_cart) => {
              onChange({ ...value, add_to_cart })
              play()
            }}
            renderTile={(option) => <EffectTile effect={option.value} />}
          />
          <p className="text-sm text-muted-foreground" data-testid="add-to-cart-hint">
            {ADD_TO_CART_LABELS[value.add_to_cart].hint}
          </p>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Switch id="button-feedback" checked={value.button_feedback} onCheckedChange={(button_feedback) => onChange({ ...value, button_feedback })} disabled={disabled} />
              <Label htmlFor="button-feedback">Button feedback</Label>
            </div>
            <p className="pl-11 text-sm text-muted-foreground">The button shows “Added” with a tick for a moment, without changing its size.</p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <EffectPreview effects={value} playToken={playToken} />
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={play}>
            <PlayIcon aria-hidden /> Play preview
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
