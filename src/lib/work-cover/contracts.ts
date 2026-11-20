import { hashCanonicalValue } from '../agent/run/hash'
import { extractExactArtifactOwnerRootsV1 } from '../memory/artifact-roots'
import { isWorkCode } from '../memory/identity'
import type { WorkCoverImageCandidateV1 } from './types'

export const WORK_COVER_MAX_RESPONSE_BYTES_V1 = 36 * 1024 * 1024
export const WORK_COVER_MAX_PROMPT_CHARS_V1 = 8_000
export const WORK_COVER_LAYOUT_V1 = null
const HASH = /^[a-f0-9]{64}$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
function fail(): never { throw new Error('[work-cover] 封面记录或证据损坏') }
function text(row: Record<string, unknown>, key: string, max = 200): string {
  const value = row[key]
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail()
  return value
}
function hash(row: Record<string, unknown>, key: string) { if (!HASH.test(text(row, key))) fail() }
function uuid(row: Record<string, unknown>, key: string) { if (!UUID.test(text(row, key))) fail() }
function integer(row: Record<string, unknown>, key: string, min = 0) {
  if (!Number.isSafeInteger(row[key]) || (row[key] as number) < min) fail()
}
function parse(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') fail()
  let value: unknown
  try { value = JSON.parse(raw) } catch { fail() }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  return value as Record<string, unknown>
}

export function parseWorkCoverBriefV1(raw: string) {
  const brief = parse(raw)
  if (Object.keys(brief).sort().join(',') !== 'prompt,selectedText,version' || brief.version !== 1) fail()
  text(brief, 'prompt', WORK_COVER_MAX_PROMPT_CHARS_V1)
  if (brief.selectedText !== null) {
    const selected = brief.selectedText as Record<string, unknown>
    if (!selected || typeof selected !== 'object' || Object.keys(selected).sort().join(',') !== 'chapterId,end,start,textHash') fail()
    integer(selected, 'chapterId', 1); integer(selected, 'start'); integer(selected, 'end', 1); hash(selected, 'textHash')
    if ((selected.end as number) <= (selected.start as number) || (selected.end as number) - (selected.start as number) > 8_000) fail()
  }
  return brief as unknown as import('./types').WorkCoverBriefV1
}

export function parseWorkCoverImageCandidateV1(raw: string): WorkCoverImageCandidateV1 {
  const row = parse(raw)
  if (Object.keys(row).sort().join(',') !== 'assetKey,attempt,blobHash,briefHash,candidateHash,dispatchKey,ordinal,providerReceiptHash,responseHash,rights,routeHash,schema,workCode'
    || row.schema !== 'storyforge.work-cover.image-candidate@1' || row.attempt !== 1 || row.ordinal !== 0
    || !isWorkCode(row.workCode) || row.rights !== 'provider-terms-unverified') fail()
  uuid(row, 'assetKey'); uuid(row, 'dispatchKey')
  for (const field of ['blobHash', 'briefHash', 'candidateHash', 'providerReceiptHash', 'responseHash', 'routeHash']) hash(row, field)
  return row as unknown as WorkCoverImageCandidateV1
}

export async function assertWorkCoverCandidateHashV1(candidate: WorkCoverImageCandidateV1) {
  parseWorkCoverImageCandidateV1(JSON.stringify(candidate))
  const { candidateHash, ...preimage } = candidate
  if (await hashCanonicalValue(preimage) !== candidateHash) fail()
}

/** Row-local preflight is registered on PROJECT_TABLES; FK/owner coordinates
 * are checked by the shared portable reference validator. */
export function assertWorkCoverPortableRowV1(kind: 'draft' | 'asset' | 'adoption', row: Record<string, unknown>) {
  if (row.version !== 1 || !isWorkCode(row.workCode)) fail()
  if (row.layoutHash !== null) fail()
  if (kind === 'draft') {
    uuid(row, 'draftKey'); integer(row, 'revision', 1); integer(row, 'expectedWorkUpdatedAt')
    parseWorkCoverBriefV1((row.briefJson ?? row._selectedChapterRefs) as string); hash(row, 'briefHash')
    if (row.layoutJson !== 'null') fail()
    if (row.renderManifestHash !== null) hash(row, 'renderManifestHash')
  } else if (kind === 'asset') {
    uuid(row, 'assetKey'); hash(row, 'blobHash')
    if (!['uploaded-original', 'generated-original', 'rendered-cover'].includes(row.role as string)
      || !['image/png', 'image/jpeg', 'image/webp'].includes(row.mimeType as string) || row.ordinal !== 0
      || !['author-upload', 'provider-terms-unverified'].includes(row.rights as string)) fail()
    for (const key of ['width', 'height', 'byteSize']) integer(row, key, 1)
    if ((row.width as number) > 16_384 || (row.height as number) > 16_384
      || (row.width as number) * (row.height as number) > 32 * 1024 * 1024 || (row.byteSize as number) > 25 * 1024 * 1024) fail()
    if (row.role === 'uploaded-original') {
      if (row.rights !== 'author-upload' || row.candidateJson !== null
        || row.sourceRunId != null || row._sourceRunExportId != null) fail()
    } else if (row.role === 'generated-original') {
      if (row.rights !== 'provider-terms-unverified' || row.candidateJson === null) fail()
      if (row.sourceRunId != null) integer(row, 'sourceRunId', 1)
      else integer(row, '_sourceRunExportId') // Portable export coordinates start at zero.
    } else fail() // No derived rendering mode is implemented by the identity-only foundation.
    if (row.candidateJson !== null) {
      const candidate = parseWorkCoverImageCandidateV1(row.candidateJson as string)
      if (candidate.workCode !== row.workCode || candidate.assetKey !== row.assetKey || candidate.blobHash !== row.blobHash) fail()
    }
  } else {
    uuid(row, 'operationKey'); uuid(row, 'draftKey'); integer(row, 'draftRevision', 1)
    for (const field of ['candidateHash', 'renderManifestHash', 'oldCoverHash', 'newCoverHash', 'receiptHash']) hash(row, field)
    integer(row, 'adoptedAt')
  }
  if (kind !== 'draft') {
    // Foundation admission remains closed until the repaired typed origin is validated.
    if (row.materializationRunId != null || row._materializationRunExportId != null || row.repairEvidenceJson != null) fail()
    if (typeof row.exactArtifactRefsJson !== 'string') fail()
    extractExactArtifactOwnerRootsV1(row, [{ field: 'exactArtifactRefsJson', path: [] }])
  }
}
