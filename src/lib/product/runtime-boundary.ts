import type { SimulationSessionKind } from '../types'

/**
 * ARCH-03 · Session kinds that represent formal upper products.
 *
 * They may only be created from a verified immutable GameRelease or an
 * explicitly labelled Build Preview. Authoring snapshots and WorldRelease
 * records are inputs to product production, never executable products.
 */
export const FORMAL_PRODUCT_SESSION_KINDS_V1 = [
  'ttrpg',
  'chatgame',
  'storygame',
  'textadventure',
  'avg',
  'textsimulation',
  'textworld',
] as const satisfies readonly SimulationSessionKind[]

const FORMAL_PRODUCT_SESSION_KIND_SET_V1 = new Set<SimulationSessionKind>(
  FORMAL_PRODUCT_SESSION_KINDS_V1,
)

export function isFormalProductSessionKindV1(
  kind: SimulationSessionKind,
): boolean {
  return FORMAL_PRODUCT_SESSION_KIND_SET_V1.has(kind)
}
