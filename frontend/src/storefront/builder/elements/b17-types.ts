import type { B17Element } from '../types'

export type B17Type = B17Element['type']

/**
 * The B17 element types (contract §1). `trust_badges` (extended in B17 with links and up to 8
 * items) stays a B6 type. Props and data shapes: ../types.ts (B17 section); allowed values:
 * B17_ENUMS / B17_LIMITS (../validate.ts) and ORNAMENT_NAMES (./ornaments).
 */
export const B17_TYPES = ['ornament', 'payment_badges', 'delivery_promise', 'bangla_date'] as const satisfies readonly B17Type[]

export function isB17Type(type: string): type is B17Type {
  return (B17_TYPES as readonly string[]).includes(type)
}
