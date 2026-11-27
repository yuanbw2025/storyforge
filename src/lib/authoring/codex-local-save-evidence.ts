import type { WorkspaceScope } from '../types'
import type { CodexEntry } from '../types/codex'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import { sha256Text } from '../ai/chapter-memory/text-normalization'

/** The existing manual writer's whitelist; AI fields remain in FIELD_REGISTRY. */
export const CODEX_ENTRY_AUTHOR_FIELDS_V1 = ['categoryId', 'name', 'icon', 'summary', 'description', 'fields', 'refs', 'tags', 'importance', 'cultivationSystemId', 'cultivationStageId', 'importantLocationId', 'order', 'worldGroupId'] as const
export interface CodexLocalSaveWitnessV1 {
  version: 1
  scope: WorkspaceScope
  source: 'database-read' | 'committed-write'
  recordId: number
  resourceUid: string
  revision: number
  valueHash: string
  confirmedAt: number
}
export interface CodexLocalSaveContractV1 { scope: WorkspaceScope; witness: CodexLocalSaveWitnessV1 | null }

export function hashCodexLocalSaveValueV1(row: CodexEntry): Promise<string> {
  return sha256Text(JSON.stringify(CODEX_ENTRY_AUTHOR_FIELDS_V1.map(field => ({
    field, present: Object.prototype.hasOwnProperty.call(row, field), value: row[field],
  }))))
}
/** Called only with the actual scoped DB read, or a checked post-commit read. */
export async function createCodexLocalSaveWitnessV1(row: CodexEntry, scope: WorkspaceScope, source: CodexLocalSaveWitnessV1['source']): Promise<CodexLocalSaveWitnessV1 | null> {
  if (row.id == null || !Number.isSafeInteger(row.id) || row.id < 1 || row.projectId !== scope.projectId
    || (row as CodexEntry & { worldId?: number }).worldId !== scope.worldId || !isPortableResourceUidV1(row.ragDocumentId, 'codex-entry')
    || !Number.isFinite(row.updatedAt)) return null
  let valueHash: string
  try { valueHash = await hashCodexLocalSaveValueV1(row) }
  catch { return null } // An unhashable legacy row remains readable without a success claim.
  return { version: 1, source, scope: { ...scope }, recordId: row.id, resourceUid: row.ragDocumentId,
    revision: row.updatedAt, valueHash, confirmedAt: Date.now() }
}
export function matchingCodexLocalSaveIdentityV1(row: CodexEntry, contract: CodexLocalSaveContractV1) {
  const witness = contract.witness
  return witness?.version === 1 && witness.recordId === row.id && witness.resourceUid === row.ragDocumentId
    && witness.revision === row.updatedAt && row.projectId === contract.scope.projectId
    && (row as CodexEntry & { worldId?: number }).worldId === contract.scope.worldId
    && witness.scope.projectId === contract.scope.projectId && witness.scope.worldId === contract.scope.worldId
    && witness.scope.workId === contract.scope.workId
}
