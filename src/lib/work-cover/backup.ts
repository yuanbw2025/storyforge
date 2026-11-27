import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { sha256BinaryV1 } from '../media/blob-store'
import { assertWorkCoverCandidateHashV1, assertWorkCoverPortableRowV1, parseWorkCoverImageCandidateV1 } from './contracts'
import { assertCoverRepairEvidenceV1 } from './repair-proof'
import { verifyPortableAgentRunProjectionV1, verifyPortableCompletedAgentRunEvidenceV1 } from '../agent/run/ledger-portability'
import type { WorkCoverAssetV1 } from './types'

type Row = Record<string, unknown>
function fail(): never { throw new Error('[work-cover] 备份封面 owner、引用或不可变证据不一致') }
function rows(value: Record<string, unknown>, key: string): Row[] {
  const list = value[key]
  if (!Array.isArray(list)) fail()
  return list as Row[]
}
function index(list: Row[]) { return new Map(list.map(row => [row._exportId, row])) }
function requireRow(map: Map<unknown, Row>, id: unknown): Row { const row = map.get(id); if (!row) fail(); return row }
function sameOwner(left: Row, right: Row) { if (left._workOwnerExportId !== right._workOwnerExportId) fail() }
function decode(raw: unknown, mime: unknown): ArrayBuffer {
  if (typeof raw !== 'string' || !raw.startsWith(`data:${mime};base64,`) || raw.length > 36 * 1024 * 1024) fail()
  let binary: string
  try { binary = atob(raw.slice(raw.indexOf(',') + 1)) } catch { fail() }
  return Uint8Array.from(binary, char => char.charCodeAt(0)).buffer
}

/** Registry-owned scalar remaps are checked by the shared preflight. Here we
 * verify content/lineage together, before any import transaction allocates IDs. */
export async function assertWorkCoverBackupV1(value: Record<string, unknown>) {
  const drafts = rows(value, 'workCoverDrafts'), assets = rows(value, 'workCoverAssets'), adoptions = rows(value, 'workCoverAdoptions')
  const works = index(rows(value, 'works')), blobs = index(rows(value, 'mediaBlobObjects'))
  const draftMap = index(drafts), assetMap = index(assets), runs = index(rows(value, 'agentRuns'))
  const unique = new Set<string>()
  const draftOwners = new Set<unknown>()
  function owner(row: Row) {
    const work = requireRow(works, row._workOwnerExportId)
    if (row.workCode !== work.code || work.kind !== 'novel' || work.novelProfile !== 'long') fail()
    return work
  }
  function key(row: Row, field: string) { const identity = `${field}:${row[field]}`; if (unique.has(identity)) fail(); unique.add(identity) }
  function run(row: Row, field: string) { if (row[field] != null) sameOwner(row, requireRow(runs, row[field])) }
  for (const row of drafts) {
    assertWorkCoverPortableRowV1('draft', row); owner(row); key(row, 'draftKey'); run(row, '_lastRunExportId')
    if (draftOwners.has(row._workOwnerExportId)) fail()
    draftOwners.add(row._workOwnerExportId)
    for (const field of ['_selectedAssetExportId', '_adoptedAssetExportId']) if (row[field] != null) sameOwner(row, requireRow(assetMap, row[field]))
    // With no selected chapter, exact brief evidence is unchanged by remapping.
    const brief = JSON.parse((row.briefJson ?? row._selectedChapterRefs) as string)
    if (brief.selectedText === null && await hashCanonicalValue(brief) !== row.briefHash) fail()
  }
  for (const row of assets) {
    assertWorkCoverPortableRowV1('asset', row); owner(row); key(row, 'assetKey'); run(row, '_sourceRunExportId'); run(row, '_materializationRunExportId')
    const blob = requireRow(blobs, row._blobObjectExportId)
    sameOwner(row, blob)
    if (row.blobHash !== blob.contentHash || row.mimeType !== blob.mimeType || row.byteSize !== blob.byteSize
      || row.width !== blob.width || row.height !== blob.height || await sha256BinaryV1(decode(blob.data, blob.mimeType)) !== row.blobHash) fail()
    if (row._parentAssetExportId != null) {
      const parent = requireRow(assetMap, row._parentAssetExportId); sameOwner(row, parent)
      if (parent === row) fail()
      const seen = new Set<unknown>([row._exportId]); let current: Row = parent
      while (true) {
        if (seen.has(current._exportId)) fail()
        seen.add(current._exportId)
        if (current._parentAssetExportId == null) break
        current = requireRow(assetMap, current._parentAssetExportId); sameOwner(row, current)
      }
    }
    if (row.candidateJson !== null) {
      const candidate = parseWorkCoverImageCandidateV1(row.candidateJson as string)
      await assertWorkCoverCandidateHashV1(candidate)
      if (candidate.schema === 'storyforge.work-cover.repaired-image-candidate@1') {
        const source = requireRow(runs, row._sourceRunExportId), proof = requireRow(runs, row._materializationRunExportId)
        if (source === proof) fail()
        for (const item of [source, proof]) if (item._worldGroupExportId != null || item._conversationExportId != null
          || item._nodeRunExportId != null || item._productBuildExportId != null || item._productRuntimeSessionExportId != null) fail()
        const events = rows(value, 'agentRunEvents')
        const verifiedSource = await verifyPortableAgentRunProjectionV1(source, events.filter(event => event._agentRunExportId === source._exportId))
        const verifiedProof = await verifyPortableCompletedAgentRunEvidenceV1(proof, events.filter(event => event._agentRunExportId === proof._exportId))
        await assertCoverRepairEvidenceV1(row as unknown as WorkCoverAssetV1,
          { contractJson: source.contractJson as string, events: verifiedSource.events }, { contractJson: proof.contractJson as string, events: verifiedProof.events })
        const artifacts = rows(value, 'agentRunArtifacts')
        for (const ref of JSON.parse(row.exactArtifactRefsJson as string) as Row[]) {
          const artifact = artifacts.find(item => item.artifactKind === ref.artifactKind && item.contentHash === ref.contentHash)
          if (!artifact || artifact.retentionState !== 'available' || typeof artifact.content !== 'string'
            || await sha256BinaryV1(new TextEncoder().encode(artifact.content).buffer) !== ref.contentHash) fail()
        }
      }
    }
  }
  for (const row of adoptions) {
    assertWorkCoverPortableRowV1('adoption', row); owner(row); key(row, 'operationKey'); run(row, '_sourceRunExportId'); run(row, '_materializationRunExportId')
    const draft = requireRow(draftMap, row._draftExportId), original = requireRow(assetMap, row._originalAssetExportId), final = requireRow(assetMap, row._finalAssetExportId)
    for (const target of [draft, original, final]) sameOwner(row, target)
    if (draft.draftKey !== row.draftKey || original !== final || original.blobHash !== row.newCoverHash
      || final._sourceRunExportId !== row._sourceRunExportId
      || (final._materializationRunExportId ?? null) !== (row._materializationRunExportId ?? null)) fail()
    const descriptor = { rendererId: 'identity-v1', sourceBlobHash: final.blobHash, outputBlobHash: final.blobHash,
      mimeType: final.mimeType, width: final.width, height: final.height, byteSize: final.byteSize }
    if ((final.byteSize as number) > 5 * 1024 * 1024 || (final.width as number) * (final.height as number) > 20_000_000
      || (requireRow(blobs, final._blobObjectExportId).data as string).length > 7_000_000
      || row.renderManifestJson !== canonicalStringify(descriptor) || await hashCanonicalValue(descriptor) !== row.renderManifestHash) fail()
    const candidateHash = final.candidateJson === null
      ? await hashCanonicalValue({ origin: 'upload', assetKey: final.assetKey, blobHash: final.blobHash })
      : parseWorkCoverImageCandidateV1(final.candidateJson as string).candidateHash
    if (row.candidateHash !== candidateHash || await hashCanonicalValue({
      version: 1, operationKey: row.operationKey, workCode: row.workCode, draftKey: row.draftKey,
      draftRevision: row.draftRevision, expectedWorkUpdatedAt: row.expectedWorkUpdatedAt, assetKey: final.assetKey,
      candidateHash, oldCoverHash: row.oldCoverHash, newCoverHash: row.newCoverHash,
      renderManifestJson: row.renderManifestJson, renderManifestHash: row.renderManifestHash, adoptedAt: row.adoptedAt,
    }) !== row.receiptHash) fail()
  }
}
