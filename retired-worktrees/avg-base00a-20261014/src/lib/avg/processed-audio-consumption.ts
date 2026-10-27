import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { assertAvgAudioProcessingBriefV1 } from './audio-production-brief'
import { avgAudioProcessingTaskKeyV1, avgProcessedAudioArtifactKeyV1, type AvgAudioProcessingDomainV1 } from './audio-production-contract'
import { assertAvgAudioProcessingTaskShapeV1 } from './audio-production-topology'
import { readAvgAudioProcessingRawSourceV1 } from './audio-processing-raw-source'
import { inspectAvgProcessedAudioSourceV1 } from './processed-audio-source'
import { avgHash, avgKey } from './protocol-validation'

type Ref = { artifactKey: string; version: number; contentHash: string }
const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

/** Active author decisions only. Both sealed producers, the authorized
 * recipe, current Plan and exact original/derived physical WAVs are proved.
 * This does not select a historical mode or grant audition/adoption rights. */
export async function readAvgCurrentProcessedAudioSourceV1(input: {
  scope: WorkspaceScope; buildId: number; domain: AvgAudioProcessingDomainV1
  requirementKey: string; raw: Ref; processed: Ref
}) {
  const frozen = structuredClone(input), key = avgKey(frozen.requirementKey, 'processed audio requirement')
  if (frozen.raw.artifactKey !== `avg.${frozen.domain}.raw.${key}`
    || frozen.processed.artifactKey !== avgProcessedAudioArtifactKeyV1(frozen.domain, key)) {
    throw new Error('[avg-audio-process] 审听来源须绑定准确原件及独立加工版本')
  }
  const build = await db.productBuilds.get(frozen.buildId)
  const production = build ? await db.productProductions.get(build.productionId) : null
  const stored = build ? await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first() : null
  if (!build?.id || !production || !stored
    || !await assertRecordInScope(frozen.scope, 'productBuilds', build, { owner: 'work' })
    || !await assertRecordInScope(frozen.scope, 'productProductions', production, { owner: 'work' })
    || !await assertRecordInScope(frozen.scope, 'productProductionBriefs', stored, { owner: 'work' })
    || production.productType !== 'avg' || production.status !== 'producing'
    || production.currentBuildNumber !== build.buildNumber || production.controlEpoch !== build.controlEpoch
    || !['building', 'integrating'].includes(build.status) || build.previewHash
    || stored.status !== 'authorized' || stored.authorizedAt !== build.authorizedAt || stored.briefHash !== build.briefHash) {
    throw new Error('[avg-audio-process] 加工审听或选用须属于准确当前已授权制作，历史版本只准独立只读')
  }
  const brief = parseProductProductionBriefV3(stored.briefJson)
  assertAvgAudioProcessingBriefV1(brief)
  const entry = brief.avgAudioProcessing?.entries.find(e => e.domain === frozen.domain && e.requirementKey === key)
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
  const task = plan.tasks.find(t => t.taskKey === avgAudioProcessingTaskKeyV1(frozen.domain, key))
  if (!entry || !task || await hashProductProductionValueV2(brief) !== build.briefHash
    || await hashProductProductionValueV2(plan) !== build.planHash) throw new Error('[avg-audio-process] 加工审听缺少准确冻结配方与生产图')
  assertAvgAudioProcessingTaskShapeV1(task, plan.tasks, 'avg')
  const original = await readAvgAudioProcessingRawSourceV1({ scope: frozen.scope, buildId: build.id, brief,
    domain: frozen.domain, raw: frozen.raw })
  const row = await verifyAcceptedProductBuildArtifactV1({ scope: frozen.scope, buildId: build.id, ...frozen.processed })
  // Quality is part of the exact sealed checkpoint candidate above. Do not
  // rebuild its historic context using mutable local IDs or new DB state.
  const sourceContextHash = avgHash(JSON.parse(row.qualityJson).sourceContextHash, 'sealed processed context')
  const inspected = await inspectAvgProcessedAudioSourceV1({ scope: frozen.scope, entry, original, row, sourceContextHash })
  if (row.controlEpoch !== build.controlEpoch || row.producerRunId === original.row.producerRunId
    || !row.producerReceiptHash || inspected.payload.requestIdentityHash !== original.requestIdentityHash) {
    throw new Error('[avg-audio-process] 加工审听不能借原producer或其他请求代签')
  }
  const after = await db.productBuilds.get(build.id), owner = await db.productProductions.get(build.productionId)
  const current = await verifyAcceptedProductBuildArtifactV1({ scope: frozen.scope, buildId: build.id, ...frozen.processed })
  if (!same(after, build) || !same(owner, production) || !same(current, row)) {
    throw new Error('[avg-audio-process] 审听来源读取期间原件、加工版本或制作状态已变化')
  }
  return { ...inspected, row, original, entry, build, brief, sourceContextHash }
}
