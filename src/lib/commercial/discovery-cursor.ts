import type { ProductionProductKindV1 } from '../types'

const CURSOR_PREFIX = 'sf-discovery-v1.'
const MAXIMUM_CURSOR_LENGTH = 2_048

export interface CommercialDiscoveryCursorV1 {
  version: 1
  productType: ProductionProductKindV1 | null
  query: string
  updatedAt: number
  listingId: string
}

export function normalizeCommercialDiscoveryQueryV1(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  const padding = '='.repeat((4 - value.length % 4) % 4)
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

export function encodeCommercialDiscoveryCursorV1(input: {
  productType?: ProductionProductKindV1
  query?: string
  updatedAt: number
  listingId: string
}): string {
  const payload: CommercialDiscoveryCursorV1 = {
    version: 1,
    productType: input.productType ?? null,
    query: normalizeCommercialDiscoveryQueryV1(input.query),
    updatedAt: input.updatedAt,
    listingId: input.listingId,
  }
  return `${CURSOR_PREFIX}${encodeBase64Url(JSON.stringify(payload))}`
}

export function parseCommercialDiscoveryCursorV1(input: {
  value: unknown
  productType?: ProductionProductKindV1
  query?: string
}): CommercialDiscoveryCursorV1 | null {
  if (typeof input.value !== 'string' || input.value.length > MAXIMUM_CURSOR_LENGTH
    || !input.value.startsWith(CURSOR_PREFIX)) return null
  const decoded = decodeBase64Url(input.value.slice(CURSOR_PREFIX.length))
  if (decoded == null) return null
  let value: unknown
  try { value = JSON.parse(decoded) } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const expected = ['version', 'productType', 'query', 'updatedAt', 'listingId']
  if (Object.keys(row).length !== expected.length
    || Object.keys(row).some(key => !expected.includes(key))
    || row.version !== 1
    || (row.productType !== null && typeof row.productType !== 'string')
    || typeof row.query !== 'string' || row.query.length > 500
    || !Number.isSafeInteger(row.updatedAt) || Number(row.updatedAt) < 0
    || typeof row.listingId !== 'string'
    || !/^listing\.[A-Za-z0-9._:-]+$/.test(row.listingId) || row.listingId.length > 200) return null
  const parsed: CommercialDiscoveryCursorV1 = {
    version: 1,
    productType: row.productType as ProductionProductKindV1 | null,
    query: row.query,
    updatedAt: Number(row.updatedAt),
    listingId: row.listingId,
  }
  if (parsed.productType !== (input.productType ?? null)
    || parsed.query !== normalizeCommercialDiscoveryQueryV1(input.query)) return null
  return encodeCommercialDiscoveryCursorV1({
    productType: parsed.productType ?? undefined,
    query: parsed.query,
    updatedAt: parsed.updatedAt,
    listingId: parsed.listingId,
  }) === input.value ? parsed : null
}

export function isCommercialListingAfterCursorV1(
  listing: { updatedAt: number; listingId: string },
  cursor: CommercialDiscoveryCursorV1,
): boolean {
  return listing.updatedAt < cursor.updatedAt
    || (listing.updatedAt === cursor.updatedAt && listing.listingId > cursor.listingId)
}

export function compareCommercialDiscoveryOrderV1(
  left: { updatedAt: number; listingId: string },
  right: { updatedAt: number; listingId: string },
): number {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? -1 : 1
  return left.listingId < right.listingId ? -1 : left.listingId > right.listingId ? 1 : 0
}
