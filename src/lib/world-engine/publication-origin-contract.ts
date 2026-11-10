import { isWorkspaceUid } from '../memory/identity'
import { isPublicWorldCode } from '../workspace/identity'
import type { WorldRevisionOriginV1 } from '../types/world-release'

export function assertWorldRevisionOriginV1(value: unknown): asserts value is WorldRevisionOriginV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('[world-publication-origin] 来源记录无效')
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'contentHash,kind,sourceWorkspaceUid,version,worldCode'
    || row.version !== 1 || !['author-seal', 'reference-cache'].includes(String(row.kind))
    || !isWorkspaceUid(row.sourceWorkspaceUid) || !isPublicWorldCode(row.worldCode)
    || typeof row.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.contentHash)) {
    throw Error('[world-publication-origin] 来源记录字段或身份无效')
  }
}

export function assertWorldRevisionOriginRowV1(row: Record<string, unknown>): void {
  if (Object.prototype.hasOwnProperty.call(row, 'publicationOrigin')) assertWorldRevisionOriginV1(row.publicationOrigin)
}
