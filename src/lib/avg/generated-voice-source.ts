import Dexie from 'dexie'
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { readAvgAdoptedGeneratedVoiceChoiceV1 } from './author-artifacts'
import { parseAvgGeneratedVoiceSourceV1, type AvgGeneratedVoiceSourceV1 } from './stage-voice-source-contract'

type Evidence = Awaited<ReturnType<typeof readAvgAdoptedGeneratedVoiceChoiceV1>>
const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
const sourceOf = (e: Evidence) => parseAvgGeneratedVoiceSourceV1({ schema: 'storyforge.avg.generated-voice-source', version: 1,
  productionKey: e.productionKey, requirementKey: e.choice.requirementKey, requestIdentityHash: e.choice.requestIdentityHash,
  raw: e.rawProof, review: { ...e.review.artifact, authorReceiptHash: e.review.authorReceiptHash },
  choice: { ...e.artifact, authorReceiptHash: e.authorReceiptHash } })

/** An explicit reviewable locator from an actual adopted voice. No import
 * alias, new Blob, author adoption, cost settlement or provider call is made. */
export async function prepareAvgAdoptedGeneratedVoiceV1(input: { scope: WorkspaceScope; choiceId: number }) {
  const scope = await resolveScope({ scope: input.scope }), row = await db.productBuildArtifacts.get(input.choiceId)
  if (!row?.id || row.status !== 'accepted' || !row.artifactKey.startsWith('avg.voice.choice.')
    || !await assertRecordInScope(scope, 'productBuildArtifacts', row, { owner: 'work' })) throw new Error('[avg-voice] 请选择当前作品准确的已采用配音')
  const evidence = await readAvgAdoptedGeneratedVoiceChoiceV1({ scope, buildId: row.buildId, controlEpoch: row.controlEpoch,
    artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash })
  return { asset: evidence.asset, source: sourceOf(evidence), requirement: evidence.requirement,
    sourceWorldContentHash: evidence.sourceWorldContentHash }
}

/** Reads only the exact original audio and adoption chain, including after
 * supersession or portable import. The caller separately proves its new line
 * consumer and obtains a new stage adoption; old Runs never become writable. */
export async function readAvgAdoptedGeneratedVoiceV1(input: { scope: WorkspaceScope; source: AvgGeneratedVoiceSourceV1 }) {
  const scope = await resolveScope({ scope: input.scope }), source = parseAvgGeneratedVoiceSourceV1(input.source)
  const productions = await db.productProductions.where('workId').equals(scope.workId)
    .filter(row => row.productType === 'avg' && row.productionKey === source.productionKey).limit(2).toArray()
  const production = productions[0]
  if (productions.length !== 1 || !production?.id || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })) {
    throw new Error('[avg-voice] 配音制作来源不存在、重复或跨作品')
  }
  const build = await db.productBuilds.where('[productionId+buildNumber]').equals([production.id, source.raw.buildNumber]).first()
  if (!build?.id || build.briefHash !== source.raw.briefHash || build.planHash !== source.raw.planHash
    || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) throw new Error('[avg-voice] 配音来源的准确版本已变化')
  const evidence = await readAvgAdoptedGeneratedVoiceChoiceV1({ scope, buildId: build.id,
    controlEpoch: source.raw.controlEpoch, ...source.choice })
  if (!same(sourceOf(evidence), source)) throw new Error('[avg-voice] 配音的 producer、原审听或作者采用证明已变化')
  const blob = await db.mediaBlobObjects.get(evidence.blobObjectId)
  if (!blob?.id || !await assertRecordInScope(scope, 'mediaBlobObjects', blob, { owner: 'work' })
    || blob.contentHash !== evidence.asset.contentHash || blob.mimeType !== 'audio/wav'
    || blob.byteSize !== evidence.asset.byteSize) throw new Error('[avg-voice] 沿用配音缺少同作品的准确原音频')
  const readData = () => readVerifiedMediaBlobObjectData(blob)
  const data = Dexie.currentTransaction ? await Dexie.waitFor(Dexie.ignoreTransaction(readData), 20_000) : await readData()
  return { asset: evidence.asset, source, requirement: evidence.requirement, preset: evidence.preset,
    sourceWorldContentHash: evidence.sourceWorldContentHash, blobObjectId: blob.id, data }
}
