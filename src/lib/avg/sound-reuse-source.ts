import Dexie from 'dexie'
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { verifyHistoricalAvgSoundArtifactV1 } from '../product-production/artifact-store'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import type { AvgSoundLocalRepairV1 } from './sound-local-repair-contract'
import { avgRecord } from './protocol-validation'

/** Materialize the exact producer already proved by the registered Context.
 * No new authority: callers must first obtain actual scheduler/Context input.
 * Stable portable content is compared again; host IDs never enter Context. */
export async function readAvgSoundReuseRetainedArtifactV1(input: {
  scope: WorkspaceScope; repair: AvgSoundLocalRepairV1; raw: boolean; packet: unknown
}) {
  const packet = input.packet as { version?: unknown; operation?: unknown; retainedArtifact?: unknown }
  const expected = avgRecord(packet.retainedArtifact, ['artifactKey', 'version', 'contentHash', 'kind', 'mediaKind',
    'mimeType', 'byteSize', 'payload', 'metadata', 'rights'], 'retained sound Context artifact')
  const source = input.repair.source, locator = input.raw ? source.raw : source.compiled
  if (packet.version !== 2 || packet.operation !== (input.raw ? 'reuse-original-sound' : 'reuse-original-sound-requirements')
    || expected.artifactKey !== locator.artifactKey || expected.version !== locator.version || expected.contentHash !== locator.contentHash) {
    throw new Error('[avg-sound-repair] 登记上下文原件与返修准确引用不一致')
  }
  const owners = await db.productProductions.where('workId').equals(input.scope.workId)
    .filter(p => p.productType === 'avg' && p.productionKey === source.productionKey).limit(2).toArray()
  const production = owners[0], build = production?.id
    ? await db.productBuilds.where('[productionId+buildNumber]').equals([production.id, source.buildNumber]).first() : null
  if (owners.length !== 1 || !production?.id || !build?.id || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })
    || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' }) || build.stateRevision !== input.repair.sourceBuildRevision
    || build.briefHash !== source.briefHash || build.planHash !== source.planHash || build.controlEpoch !== source.controlEpoch) {
    throw new Error('[avg-sound-repair] 登记上下文原件在读取期间已变化或跨作品')
  }
  const row = await verifyHistoricalAvgSoundArtifactV1({ scope: input.scope, buildId: build.id,
    expectedBuildRevision: build.stateRevision, expectedBriefHash: build.briefHash, expectedPlanHash: build.planHash, sourceControlEpoch: source.controlEpoch,
    artifactKey: locator.artifactKey, version: locator.version, contentHash: locator.contentHash })
  const projected = { artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash, kind: row.kind,
    mediaKind: row.mediaKind, mimeType: row.mimeType, byteSize: row.byteSize,
    payload: JSON.parse(row.payloadJson), metadata: JSON.parse(row.metadataJson), rights: JSON.parse(row.rightsJson) }
  if (canonicalProductProductionJsonV2(projected) !== canonicalProductProductionJsonV2(expected)
    || (input.raw ? row.kind !== 'audio' || row.mimeType !== 'audio/wav' || row.blobObjectId === null
      : row.kind !== 'asset-manifest' || row.blobObjectId !== null)) {
    throw new Error('[avg-sound-repair] 当前原件包络必须与实际登记来源完全一致')
  }
  let data: ArrayBuffer | null = null
  if (input.raw) {
    const blob = await db.mediaBlobObjects.get(row.blobObjectId!)
    if (!blob || !await assertRecordInScope(input.scope, 'mediaBlobObjects', blob, { owner: 'work' })
      || blob.contentHash !== row.contentHash || blob.mimeType !== row.mimeType || blob.byteSize !== row.byteSize) {
      throw new Error('[avg-sound-repair] 原件物理字节必须属于同作品的准确WAV')
    }
    const read = () => readVerifiedMediaBlobObjectData(blob)
    data = await (Dexie.currentTransaction ? Dexie.waitFor(Dexie.ignoreTransaction(read), 20_000) : read())
  }
  if (canonicalProductProductionJsonV2(await db.productBuilds.get(build.id)) !== canonicalProductProductionJsonV2(build)
    || canonicalProductProductionJsonV2(await db.productProductions.get(production.id)) !== canonicalProductProductionJsonV2(production)) {
    throw new Error('[avg-sound-repair] 原件在读取期间已stale')
  }
  return { row, data }
}
