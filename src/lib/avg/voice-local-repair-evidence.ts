import Dexie, { type Transaction } from 'dexie'
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { readAvgAdoptedGeneratedVoiceChoiceV1, readAvgAdoptedGeneratedVoiceChoiceV2, readFrozenAvgStageMembershipV1 } from './author-artifacts'
import type { AvgVoiceLocalRepairV2 } from './voice-local-repair-contract'
import { parseAvgGeneratedVoiceSource } from './stage-processed-voice-source-contract'

const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
type RepairRead = { scope: WorkspaceScope; productionId: number; sourceBuildId: number; repair: AvgVoiceLocalRepairV2 }
const snapshotProofs = new WeakMap<Transaction, Map<string, Awaited<ReturnType<typeof readAdoptionUncached>>>>()

/** Reuse only a successfully proved value inside one immutable read snapshot.
 * No pending Promise, read/write transaction or later snapshot is cached. */
export async function readAvgVoiceLocalRepairAdoptionV2(input: RepairRead) {
  const captured: RepairRead = { scope: { projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId },
    productionId: input.productionId, sourceBuildId: input.sourceBuildId, repair: structuredClone(input.repair) }
  let snapshot = Dexie.currentTransaction
  while (snapshot?.parent) snapshot = snapshot.parent
  const key = JSON.stringify(captured), cache = snapshot?.active && snapshot.mode === 'readonly' ? snapshotProofs.get(snapshot) : undefined
  const found = cache?.get(key)
  if (found) return structuredClone(found)
  const result = await readAdoptionUncached(captured)
  if (snapshot?.active && snapshot.mode === 'readonly') {
    const values = snapshotProofs.get(snapshot) ?? new Map<string, typeof result>()
    values.set(key, structuredClone(result)); snapshotProofs.set(snapshot, values)
  }
  return result
}

/** Actual old adoption and exact current preview, not a portable locator's
 * self-assertion. This is read-only and never reopens either frozen Run. */
async function readAdoptionUncached(input: RepairRead) {
  const { scope, repair: r } = input
  const read = r.adoptedChoice.payloadVersion === 2 ? readAvgAdoptedGeneratedVoiceChoiceV2 : readAvgAdoptedGeneratedVoiceChoiceV1
  const adopted = await read({ scope, buildId: input.sourceBuildId, controlEpoch: r.sourceControlEpoch, ...r.adoptedChoice })
  if (adopted.productionKey !== r.sourceProductionKey || adopted.authorReceiptHash !== r.adoptedChoice.authorReceiptHash
    || adopted.choice.version !== r.adoptedChoice.payloadVersion || !same(adopted.rawProof, r.retained[0].proof)) {
    throw new Error('[avg-voice-repair] 返修不能替换原配音的采用、原件或加工来源')
  }
  const parent = await db.productBuilds.where('[productionId+buildNumber]').equals([input.productionId, r.parentBuildNumber]).first()
  if (!parent?.id || !await assertRecordInScope(scope, 'productBuilds', parent, { owner: 'work' })
    || parent.previewHash !== r.parentPreviewHash || parent.manifestHash !== r.parentManifestHash) {
    throw new Error('[avg-voice-repair] 局部返修的准确预览基线已变化')
  }
  const frozen = await readFrozenAvgStageMembershipV1({ scope, buildId: parent.id,
    expectedBuildRevision: parent.stateRevision, controlEpoch: parent.controlEpoch })
  const stage = frozen.payload
  const current = frozen.inputs.find(e => same({ artifactKey: e.artifactKey, version: e.version, contentHash: e.contentHash }, adopted.artifact)
    && e.authorReceiptHash === adopted.authorReceiptHash)
  const inherited = stage?.inheritedVoices?.find(e => e.source.productionKey === adopted.productionKey
    && e.source.raw.buildNumber === r.sourceBuildNumber && same(e.source.choice, { ...adopted.artifact, authorReceiptHash: adopted.authorReceiptHash }))
  if (!stage || !same(stage.stage.assets.find(a => a.assetKey === adopted.asset.assetKey), adopted.asset)
    || !(current || inherited)) throw new Error('[avg-voice-repair] 该句不是当前已确认预览中的准确已采用配音')
  const source = parseAvgGeneratedVoiceSource({ schema: 'storyforge.avg.generated-voice-source', version: adopted.choice.version,
    productionKey: adopted.productionKey, requirementKey: adopted.choice.requirementKey, requestIdentityHash: adopted.choice.requestIdentityHash,
    raw: adopted.rawProof, review: { ...adopted.review.artifact, authorReceiptHash: adopted.review.authorReceiptHash },
    choice: { ...adopted.artifact, authorReceiptHash: adopted.authorReceiptHash },
    ...('processingProof' in adopted ? { processing: adopted.processingProof } : {}) })
  return { ...adopted, parent, source }
}
