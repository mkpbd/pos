import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAddressesQuery, useMeQuery } from '../../account/api'
import { BootstrapContext } from '../../api'
import { useCartQuery } from '../../cart/api'
import { useLocale } from '../../i18n/locale'
import type { Device } from '../types'
import { campaignTouch, rememberedDistrict, storeDayTime, visitorKind } from './context'
import { AudienceCtx, type AudienceRuntime } from './audience-ctx'
import type { AudienceCampaigns, AudienceContext, AudienceRuleKind } from './types'

/*
 * B13 §1 on the live store: the audience context is gathered after the page mounts (only the
 * sources the page's rules use: the account and address for `account` / `district`, the cart for
 * `cart`, the clock for `time`), and nodes with rules are not drawn until it is complete — no flash
 * of content meant for someone else, and no space reserved. Nodes without rules draw at once.
 */

const MINUTE = 60_000

/**
 * Gathers the visitor's context for the rule kinds a page uses and provides it to the nodes below.
 * Mounted only on pages that have rules.
 */
export function LiveAudienceProvider({
  kinds,
  device,
  timezone,
  campaigns,
  children,
}: {
  kinds: ReadonlySet<AudienceRuleKind>
  device: Device
  timezone: string | null
  campaigns: AudienceCampaigns | null
  children: ReactNode
}) {
  const { locale } = useLocale()
  const bootstrap = useContext(BootstrapContext)
  const needsCustomer = kinds.has('account') || kinds.has('district')
  const needsCart = kinds.has('cart')
  const me = useMeQuery(needsCustomer)
  const signedIn = Boolean(me.data)
  const addresses = useAddressesQuery(kinds.has('district') && signedIn)
  const cart = useCartQuery(needsCart)

  // What only this browser knows (storage, the clock), read once per page (the store renders only in the browser).
  const [local] = useState(() => ({ visitor: visitorKind(), district: rememberedDistrict(), campaign: campaignTouch() }))
  const [now, setNow] = useState(() => Date.now())
  // Time rules are checked again every minute (a "6 PM–11 PM" section appears at six).
  const usesTime = kinds.has('time')
  useEffect(() => {
    if (!usesTime) return
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE)
    return () => window.clearInterval(timer)
  }, [usesTime])

  const zone = timezone || bootstrap?.store.timezone || null
  const waiting = (needsCustomer && me.isLoading) || (kinds.has('district') && signedIn && addresses.isLoading) || (needsCart && cart.isLoading)
  const defaultAddress = addresses.data?.find((address) => address.is_default_shipping) ?? null
  const subtotal = cart.data?.subtotal ?? '0'

  const context = useMemo<AudienceContext | null>(() => {
    if (waiting) return null
    const { day, time } = storeDayTime(new Date(now), zone)
    return {
      visitor: local.visitor,
      account: signedIn ? 'signed_in' : 'guest',
      device,
      district_id: defaultAddress ? String(defaultAddress.district.id) : local.district,
      campaign: local.campaign,
      cart_subtotal: subtotal,
      day,
      time,
      language: locale === 'bn' ? 'bn' : 'en',
    }
  }, [waiting, local, now, zone, signedIn, device, defaultAddress, subtotal, locale])

  const value = useMemo<AudienceRuntime>(() => ({ mode: 'live', context, campaigns }), [context, campaigns])
  return <AudienceCtx value={value}>{children}</AudienceCtx>
}
