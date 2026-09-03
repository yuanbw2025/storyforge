/**
 * Canonical upper-product identities.
 *
 * Product identity, text-game category and runtime capability are deliberately
 * separate concepts. Adding a product requires an explicit registry change;
 * arbitrary strings and retired product aliases are rejected at every formal
 * handoff.
 */
export const UPPER_PRODUCT_KINDS_V1 = [
  'ttrpg',
  'character-interaction',
  'ai-town',
  'text-adventure',
  'avg',
  'text-open-world',
] as const

export type UpperProductKindV1 = typeof UPPER_PRODUCT_KINDS_V1[number]

/** Products currently connected to the shared production Harness. AI Town is
 * registered as a product boundary, but remains unavailable until its own
 * production and runtime contracts exist. */
export const PRODUCTION_PRODUCT_KINDS_V1 = [
  'ttrpg',
  'character-interaction',
  'text-adventure',
  'avg',
  'text-open-world',
] as const

export type ProductionProductKindV1 = typeof PRODUCTION_PRODUCT_KINDS_V1[number]

/** The complete and only user-visible text-game taxonomy. */
export const TEXT_GAME_PRODUCT_KINDS_V1 = [
  'text-adventure',
  'avg',
  'text-open-world',
] as const

export type TextGameProductKindV1 = typeof TEXT_GAME_PRODUCT_KINDS_V1[number]

export function isUpperProductKindV1(value: unknown): value is UpperProductKindV1 {
  return typeof value === 'string'
    && (UPPER_PRODUCT_KINDS_V1 as readonly string[]).includes(value)
}

export function isProductionProductKindV1(value: unknown): value is ProductionProductKindV1 {
  return typeof value === 'string'
    && (PRODUCTION_PRODUCT_KINDS_V1 as readonly string[]).includes(value)
}

export function isTextGameProductKindV1(value: unknown): value is TextGameProductKindV1 {
  return typeof value === 'string'
    && (TEXT_GAME_PRODUCT_KINDS_V1 as readonly string[]).includes(value)
}
