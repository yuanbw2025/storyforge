import { hashCanonicalValue } from '../agent/run/hash'
import type { ImportTarget } from '../types/import-session'
import type { WorkspaceScope } from '../types/world-ownership'

/** Structural view shared with local privacy classification. These are the
 * original import binding fields; no migration or target inference occurs. */
export interface DocumentImportChunkBindingSessionV1 {
  readonly id?: number
  readonly targetScope: WorkspaceScope
  readonly importTarget: ImportTarget
  readonly targetWorldGroupId?: number | null
  readonly fileHash: string
  readonly chunks: readonly { readonly sourceTextHash?: string }[]
}

export function documentImportChunkBindingProjectionV1(
  session: DocumentImportChunkBindingSessionV1, index: number, claimKey: string,
) {
  return {
    owner: session.targetScope, importTarget: session.importTarget,
    worldGroupId: session.targetWorldGroupId ?? null, fileHash: session.fileHash,
    sessionId: session.id, chunkIndex: index, sourceTextHash: session.chunks[index].sourceTextHash, claimKey,
  }
}

export function hashDocumentImportChunkBindingV1(
  session: DocumentImportChunkBindingSessionV1, index: number, claimKey: string,
): Promise<string> {
  return hashCanonicalValue(documentImportChunkBindingProjectionV1(session, index, claimKey))
}
