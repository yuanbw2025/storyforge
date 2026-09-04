import Dexie from 'dexie'

/**
 * Canonical JSON for immutable WorldRevision/WorldRelease payloads.
 *
 * This preserves the ordering algorithm used by every existing
 * semanticContract=3 release. Publishing and verification must import this
 * exact implementation: a different key comparator changes the content hash.
 */
export function canonicalWorldReleaseJsonV1(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalWorldReleaseJsonV1).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalWorldReleaseJsonV1(child)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export async function hashWorldReleaseValueV1(value: unknown): Promise<string> {
  const digestPromise = crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalWorldReleaseJsonV1(value)),
  )
  const digest = Dexie.currentTransaction
    ? await Dexie.waitFor(digestPromise)
    : await digestPromise
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
