import { PRODUCTION_PRODUCT_KINDS_V1, type ProductRuntimeKind } from '../types'

/**
 * ARCH-03 · Session kinds that represent formal upper products.
 *
 * They may only be created from a verified immutable ProductRelease or an
 * explicitly labelled Build Preview. Authoring snapshots and WorldRelease
 * records are inputs to product production, never executable products.
 */
export const FORMAL_PRODUCT_SESSION_KINDS_V1: readonly ProductRuntimeKind[] =
  PRODUCTION_PRODUCT_KINDS_V1

const FORMAL_PRODUCT_SESSION_KIND_SET_V1 = new Set<ProductRuntimeKind>(
  FORMAL_PRODUCT_SESSION_KINDS_V1,
)

export function isFormalProductSessionKindV1(
  kind: ProductRuntimeKind,
): boolean {
  return FORMAL_PRODUCT_SESSION_KIND_SET_V1.has(kind)
}
