import { db } from '../db/schema'
import type { WorkspaceScope, ProductBuildArtifactRecordV1 } from '../types'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { readProductProductionDetailsV1 } from '../product-production/service'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { readAvgDraftV1 } from './draft-service'
import { stageAvgAuthorArtifactV1 } from './author-artifacts'
import { avgSoundProductionExecutionReadyV1 } from './sound-production-brief'
import { readAvgSoundProposalEvidenceV1 } from './sound-planning-evidence'
import { validateAvgSoundPlanSemanticV1, type AvgSoundRoleProposalV1 } from './sound-role-proposal'
import { readAvgRawSoundSourceV1 } from './sound-choice-validation'
import { AVG_SOUND_COMPILED_KEY_V1, AVG_SOUND_PLAN_KEY_V1, AVG_SOUND_PROPOSAL_KEY_V1 } from './sound-production-plan'
import type { AvgSoundReviewIssuesV3 } from './sound-review-contract'
import type { AvgAuthorSoundChoiceV1 } from './sound-choice-contract'

type Ref = Pick<ProductBuildArtifactRecordV1, 'artifactKey' | 'version' | 'contentHash'>
const ref = (r: Ref): Ref => ({ artifactKey: r.artifactKey, version: r.version, contentHash: r.contentHash })
const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

async function current(input: { scope: WorkspaceScope; productionId: number }, write = false) {
  if (write && !avgSoundProductionExecutionReadyV1()) throw new Error('[avg-sound] 正式声音工作流尚未开放')
  const scope = await resolveScope({ scope: input.scope })
  const details = await readProductProductionDetailsV1(scope, input.productionId, ['avg'])
  const build = details.build, brief = details.executionBrief
  if (!build?.id || !brief?.avgSoundPlanning) throw new Error('[avg-sound] 缺少准确原声音制作版本')
  if (write && (details.production.status !== 'producing' || details.brief?.revision !== build.briefRevision
    || !['authorized', 'building', 'integrating'].includes(build.status) || build.previewHash
    || (await readAvgDraftV1(scope)).productionId !== input.productionId)) throw new Error('[avg-sound] 本次声音版本已停止、封存或待开始方案已变化')
  return { scope, details, build: build as typeof build & { id: number }, brief }
}
async function stillCurrent(s: Awaited<ReturnType<typeof current>>, row: ProductBuildArtifactRecordV1) {
  const build = await db.productBuilds.get(s.build.id), production = await db.productProductions.get(s.details.production.id!)
  if (!same(build, s.build) || !same(production, s.details.production)) throw new Error('[avg-sound] 声音读取期间准确制作来源已变化')
  const artifact = await verifyAcceptedProductBuildArtifactV1({ scope: s.scope, buildId: s.build.id, ...ref(row) })
  if (!same(await db.productBuilds.get(s.build.id), s.build) || !same(await db.productProductions.get(s.details.production.id!), s.details.production)
    || !same(artifact, row)) throw new Error('[avg-sound] 声音读取期间准确制作来源已变化')
}

/** Read only, including when the public factory is closed. Reuses the original
 * producer, response and physical Work Blob proof. No import alias or Key. */
export async function readAvgSoundCandidateV1(input: { scope: WorkspaceScope; productionId: number; raw: Ref }) {
  const s = await current(input)
  const selected = await readAvgRawSoundSourceV1({ scope: s.scope, buildId: s.build.id, raw: input.raw })
  const blob = await db.mediaBlobObjects.get(selected.blobObjectId)
  if (!blob || !await assertRecordInScope(s.scope, 'mediaBlobObjects', blob, { owner: 'work' })
    || blob.contentHash !== selected.asset.contentHash || blob.byteSize !== selected.asset.byteSize || blob.mimeType !== selected.asset.mimeType) throw new Error('[avg-sound] 原声音Blob与已验证原始字节不一致')
  const data = await readVerifiedMediaBlobObjectData(blob)
  await stillCurrent(s, selected.raw)
  return { ...selected, data, sourceKey: `${s.scope.projectId}:${s.scope.workId}:${s.build.id}:${s.build.controlEpoch}:${input.raw.artifactKey}:${input.raw.version}:${input.raw.contentHash}:${selected.payload.requirement.identityHash}` }
}

export async function readAvgSoundProposalV1(input: { scope: WorkspaceScope; productionId: number; proposal: Ref }) {
  const s = await current(input)
  if (input.proposal.artifactKey !== AVG_SOUND_PROPOSAL_KEY_V1) throw new Error('[avg-sound] 不是本次声音方案岗位')
  const row = await verifyAcceptedProductBuildArtifactV1({ scope: s.scope, buildId: s.build.id, ...input.proposal })
  const evidence = await readAvgSoundProposalEvidenceV1(s.scope, row)
  const original = JSON.parse(row.payloadJson) as AvgSoundRoleProposalV1
  const payload = await validateAvgSoundPlanSemanticV1(original.payload, s.brief.avgSoundPlanning!.scope)
  await stillCurrent(s, row)
  return { row, payload, evidence }
}

/** Existing author candidate/adoption chain, not a second write or inference
 * entry. The original task validates exact proposal inputs and author edits. */
export async function stageAvgSoundPlanV1(input: { scope: WorkspaceScope; productionId: number; proposal: Ref; payload: unknown; declaration: string }) {
  const s = await current(input, true)
  if (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.build.id, AVG_SOUND_COMPILED_KEY_V1]).filter(r => r.status === 'accepted').count()) {
    throw new Error('[avg-sound] 本批声音已编译，请保留原方案并在明确新版本中修订')
  }
  await readAvgSoundProposalV1(input)
  return stageAvgAuthorArtifactV1({ scope: s.scope, buildId: s.build.id, expectedBuildRevision: s.build.stateRevision,
    controlEpoch: s.build.controlEpoch, taskKey: 'avg.author.sound-plan', artifactKey: AVG_SOUND_PLAN_KEY_V1,
    kind: 'narrative', payload: input.payload, declaration: input.declaration })
}

export async function stageAvgSoundReviewV1(input: { scope: WorkspaceScope; productionId: number; raw: Ref; report: AvgSoundReviewIssuesV3; declaration: string }) {
  const s = await current(input, true), selected = await readAvgSoundCandidateV1(input)
  const key = selected.payload.requirement.template.requirementKey
  return stageAvgAuthorArtifactV1({ scope: s.scope, buildId: s.build.id, expectedBuildRevision: s.build.stateRevision,
    controlEpoch: s.build.controlEpoch, taskKey: `avg.author.sound-review.${key}`, artifactKey: `avg.review.audio.${key}`,
    kind: 'quality-report', payload: input.report, declaration: input.declaration })
}

export async function stageAvgSoundChoiceV1(input: { scope: WorkspaceScope; productionId: number; raw: Ref; declaration: string }) {
  const s = await current(input, true), selected = await readAvgSoundCandidateV1(input)
  const key = selected.payload.requirement.template.requirementKey
  const reviews = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.build.id, `avg.review.audio.${key}`]).filter(r => r.status === 'accepted').toArray()
  if (reviews.length !== 1) throw new Error('[avg-sound] 需要准确唯一已采用的声音观察')
  const review = reviews[0]
  if (!await assertRecordInScope(s.scope, 'productBuildArtifacts', review, { owner: 'work' })) throw new Error('[avg-sound] 声音观察跨Work')
  // This row identifies the requested review; it is author-owned, not a model
  // producer. The original author task below re-proves its adoption receipt,
  // all checks, exact compiled/raw inputs and concurrency before any write.
  const payload: AvgAuthorSoundChoiceV1 = { schema: 'storyforge.avg.sound-choice', version: 1, requirementKey: key,
    requestIdentityHash: selected.payload.requirement.identityHash, raw: ref(selected.raw), review: ref(review), asset: selected.asset, declaration: input.declaration }
  return stageAvgAuthorArtifactV1({ scope: s.scope, buildId: s.build.id, expectedBuildRevision: s.build.stateRevision,
    controlEpoch: s.build.controlEpoch, taskKey: `avg.author.sound-choice.${key}`, artifactKey: `avg.sound.choice.${key}`,
    kind: 'presentation', payload, declaration: input.declaration })
}
