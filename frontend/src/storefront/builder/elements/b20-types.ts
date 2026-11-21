import type { B20Element } from '../types'

export type B20Type = B20Element['type']

/** The B20 element types (contract §1): animated icon and illustration. Props: ../types.ts (B20); rules: B20_* (../validate.ts). */
export const B20_TYPES = ['animated_icon', 'illustration'] as const satisfies readonly B20Type[]

export function isB20Type(type: string): type is B20Type {
  return (B20_TYPES as readonly string[]).includes(type)
}
