/* Ids and parameters of the texture fill patterns (./texture.tsx draws them). */

/** Pattern spacing per slot pair (slots 1/2 tightest): angle alternates 45° / 135°. */
export const TEXTURE_SPACING = [5, 5, 7, 7, 9, 9, 11, 11]

export function textureId(uid: string, slot: number): string {
  return `${uid}-tex-${slot + 1}`
}

/** The CSS value a mark puts in `--viz-tex`. */
export function textureVar(uid: string, slot: number): string {
  return `url(#${textureId(uid, slot)})`
}

export function textureAngle(slot: number): 45 | 135 {
  return slot % 2 === 0 ? 45 : 135
}
