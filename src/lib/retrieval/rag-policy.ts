import { parseEntryFields } from '../types/codex'
import type { RagDocumentPolicy } from '../types/rag-library'

/** Author viewing is independent from this automatic/model-input permission. */
export function isRagSelectionEnabledV1(policy: RagDocumentPolicy | undefined, fields: readonly string[] = []): boolean {
  return policy?.enabled !== false && fields.every(field => policy?.fields?.[field]?.enabled !== false)
}

/** A raw Codex JSON field contains its custom fields too. Reading that raw
 * container cannot bypass a switch on one of its actual stored children. */
export function ragSourceFieldPolicyKeysV1(table: string, field: string, rawFields?: unknown): string[] {
  if (table !== 'codexEntries' || field !== 'fields') return [field]
  const stored = parseEntryFields(typeof rawFields === 'string' ? rawFields : undefined)
  return ['fields', ...Object.keys(stored).sort().map(key => `custom.${key}`)]
}
