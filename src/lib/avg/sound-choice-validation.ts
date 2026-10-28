import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductBuildRecordV1, WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { verifyAcceptedProductBuildArtifactV1, verifyHistoricalAvgSoundArtifactV1 } from '../product-production/artifact-store'
import { readAvgSoundRawProducerSourceV1 } from './sound-production-admission'
import { parseAvgAuthorSoundChoiceV1 } from './sound-choice-contract'
import { AVG_SOUND_COMPILED_KEY_V1 } from './sound-production-plan'
import type { AvgRawSoundPayloadV1 } from './sound-review'
import { parseAvgExecutableStageV1 } from './stage-contract'

type Ref = { artifactKey: string; version: number; contentHash: string }
export interface AvgSoundChoiceValidationV1 {
  schema: 'storyforge.avg.sound-choice-validation'; version: 1; choiceHash: string
  rawReceiptHash: string; responseEvidenceHash: string; requestSnapshotHash: string
  contentHash: string; requestIdentityHash: string; compiled: Ref; rightsHash: string
  reviewReceiptHash: string
}
/** Active source read only. Reuses sealed admission's actual decoder and
 * original HTTP/claim/compiled-source checks; no network, playback or choice.
 * Imported or stopped records cannot acquire current author authority here. */
export async function readAvgRawSoundSourceV1(input: { scope: WorkspaceScope; buildId: number; raw: Ref }) {
  const scope = await resolveScope({ scope: input.scope }), build = await db.productBuilds.get(input.buildId)
  if (!build?.id || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) throw new Error('[avg-sound] 声音版本不存在或跨Work')
  const frozen = ['validating', 'preview-ready', 'release-ready', 'released'].includes(build.status) && !!build.packageHash && !!build.previewHash && !!build.rootTerminalReceiptHash
  const exact = (reference: Ref) => frozen ? verifyHistoricalAvgSoundArtifactV1({ scope, buildId: build.id!,
    expectedBuildRevision: build.stateRevision, expectedBriefHash: build.briefHash, expectedPlanHash: build.planHash,
    sourceControlEpoch: build.controlEpoch, ...reference }) : verifyAcceptedProductBuildArtifactV1({ scope, buildId: build.id!, ...reference })
  const row = await exact(input.raw)
  const briefRow = await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first()
  if (!briefRow || !await assertRecordInScope(scope, 'productProductionBriefs', briefRow, { owner: 'work' })) throw new Error('[avg-sound] 缺少准确声音Brief')
  const brief = parseProductProductionBriefV3(briefRow.briefJson), plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
  const task = plan.tasks.find(t => t.outputArtifactKeys.includes(row.artifactKey))
  if (!brief.avgSoundPlanning || !(frozen ? ['authorized', 'superseded'] : ['authorized']).includes(briefRow.status) || briefRow.briefHash !== build.briefHash || briefRow.authorizedAt !== build.authorizedAt
    || await hashProductProductionValueV2(brief) !== build.briefHash || !row.artifactKey.startsWith('avg.sound.raw.') || !task
    || !['avg-sound-music-generate', 'avg-sound-library-import', 'avg-sound-raw-reuse'].includes(task.kind)
    || await hashProductProductionValueV2(plan) !== build.planHash) throw new Error('[avg-sound] 声音不是准确当前producer版本')
  const proofInput = { scope, build: build as ProductBuildRecordV1 & { id: number }, task, producerRunId: row.producerRunId!, artifact: row }
  const load = () => import('./sound-reuse-admission')
  const admission = brief.avgSoundPlanning.version === 2
    ? await (Dexie.currentTransaction ? Dexie.waitFor(Dexie.ignoreTransaction(load)) : load()) : null
  const observation = admission
    ? await admission.assertAvgSoundReuseProducerV1(proofInput, brief)
    : await readAvgSoundRawProducerSourceV1(proofInput, brief)
  if (!observation) throw new Error('[avg-sound-repair] 原声音读取需要准确raw复验结果')
  const payload = JSON.parse(row.payloadJson) as AvgRawSoundPayloadV1
  const asset = parseAvgExecutableStageV1({ version: 1, cues: [], assets: [JSON.parse(row.metadataJson)] }).assets[0]!
  const refs = JSON.parse(row.qualityJson).inputs as Ref[], compiledRef = refs.find(r => r.artifactKey === AVG_SOUND_COMPILED_KEY_V1)
  if (!compiledRef || row.blobObjectId === null) throw new Error('[avg-sound] 原声音缺少实际编译输入或物理Blob')
  const compiled = await exact(compiledRef)
  const current = await exact(input.raw), after = await db.productBuilds.get(build.id)
  if (canonicalProductProductionJsonV2(current) !== canonicalProductProductionJsonV2(row)
    || canonicalProductProductionJsonV2(build) !== canonicalProductProductionJsonV2(after)) throw new Error('[avg-sound] 原声音在读取期间已stale')
  return { raw: row, compiled, payload, asset, blobObjectId: row.blobObjectId, ...observation,
    validation: { rawReceiptHash: row.producerReceiptHash!, responseEvidenceHash: payload.responseEvidenceHash,
      requestSnapshotHash: payload.requestSnapshotHash, contentHash: row.contentHash, requestIdentityHash: payload.requirement.identityHash,
      compiled: compiledRef, rightsHash: await hashProductProductionValueV2(JSON.parse(row.rightsJson)) } }
}
export async function readAvgChosenSoundSourceV1(input: { scope: WorkspaceScope; buildId: number; choice: unknown }) {
  const choice = parseAvgAuthorSoundChoiceV1(input.choice), selected = await readAvgRawSoundSourceV1({ ...input, raw: choice.raw })
  if (choice.requirementKey !== selected.payload.requirement.template.requirementKey || choice.requestIdentityHash !== selected.payload.requirement.identityHash
    || canonicalProductProductionJsonV2(choice.asset) !== canonicalProductProductionJsonV2(selected.asset)) throw new Error('[avg-sound] 声音选择与准确需求、原字节、来源或许可不一致')
  return { ...selected, validation: { schema: 'storyforge.avg.sound-choice-validation' as const, version: 1 as const,
    ...selected.validation, choiceHash: await hashProductProductionValueV2(choice) } }
}
