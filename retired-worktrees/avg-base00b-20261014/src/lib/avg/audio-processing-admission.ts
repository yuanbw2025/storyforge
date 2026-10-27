import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductBuildRecordV1, ProductProductionPlanTaskV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { readAgentRunV1 } from '../agent/run/event-store'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { assembleContext } from '../registry/assemble-context'
import { preserveProductProductionContextV1 } from '../product-production/context'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { assertAvgAudioProcessingBriefV1 } from './audio-production-brief'
import { parseAvgProcessedAudioPayloadV1 } from './processed-audio-contract'
import { parseAvgAudioProductionProcessingPlanV1 } from './audio-production-contract'
import { assertAvgAudioProcessingTaskShapeV1 } from './audio-production-topology'
import { readAvgAudioProcessingRawSourceV1 } from './audio-processing-raw-source'
import { inspectAvgProcessedAudioSourceV1, type AvgProcessedAudioStoredFieldsV1 } from './processed-audio-source'
import { hashAvgTaskRuntimeBindingV1 } from './task-claim'
import { AVG_TASK_CONTEXT_SOURCE_V1 } from './task-context'
import { AVG_SOUND_CONTEXT_V1 } from './sound-production-brief'

const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

/** Extra AVG checks inside the existing sealed-producer transaction. Its
 * caller must first prove the exact completed checkpoint, candidate and root
 * receipt. No second writer or new provider/author authority is created. */
export async function assertAvgProcessedAudioProducerAdmissionV1(value: {
  scope: WorkspaceScope; build: ProductBuildRecordV1 & { id: number }
  task: ProductProductionPlanTaskV3; producerRunId: number; artifact: AvgProcessedAudioStoredFieldsV1
}) {
  const input = structuredClone(value), { scope, build, task } = input
  const current = await db.productBuilds.get(build.id), production = await db.productProductions.get(build.productionId)
  const row = await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first()
  if (!current || !production || !row || !same(current, build)
    || !await assertRecordInScope(scope, 'productBuilds', current, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productProductionBriefs', row, { owner: 'work' })
    || production.productType !== 'avg' || production.status !== 'producing'
    || production.currentBuildNumber !== build.buildNumber || production.controlEpoch !== build.controlEpoch
    || !['building', 'integrating'].includes(build.status) || row.status !== 'authorized'
    || row.briefHash !== build.briefHash || row.authorizedAt !== build.authorizedAt) {
    throw new Error('[avg-audio-process] 加工接收缺少准确同Work的当前Build与已授权Brief')
  }
  const brief = parseProductProductionBriefV3(row.briefJson)
  assertAvgAudioProcessingBriefV1(brief)
  if (!brief.avgAudioProcessing || await hashProductProductionValueV2(brief) !== build.briefHash) {
    throw new Error('[avg-audio-process] 加工接收没有准确冻结配方')
  }
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
  assertAvgAudioProcessingTaskShapeV1(task, plan.tasks, 'avg')
  if (await hashProductProductionValueV2(plan) !== build.planHash
    || !same(plan.tasks.find(t => t.taskKey === task.taskKey), task)
    || plan.buildNumber !== build.buildNumber || plan.controlEpoch !== build.controlEpoch) {
    throw new Error('[avg-audio-process] 加工producer不属于准确本地零调用Plan')
  }
  const payload = await parseAvgProcessedAudioPayloadV1(input.artifact.payloadJson)
  const processing = parseAvgAudioProductionProcessingPlanV1(brief.avgAudioProcessing)
  const entry = processing.entries.find(e => e.domain === payload.domain && e.requirementKey === payload.requirementKey)
  if (!entry || task.outputArtifactKeys[0] !== input.artifact.artifactKey) throw new Error('[avg-audio-process] 加工接收不能替换冻结需求或输出')
  const original = await readAvgAudioProcessingRawSourceV1({ scope, buildId: build.id, brief, domain: entry.domain, raw: payload.raw })
  if (original.row.buildId !== build.id || original.row.controlEpoch !== build.controlEpoch
    || original.row.status !== 'accepted' || original.row.producerReceiptHash !== payload.raw.producerReceiptHash) {
    throw new Error('[avg-audio-process] 加工接收缺少准确同版本原producer')
  }
  const key = entry.domain === 'voice' ? AVG_TASK_CONTEXT_SOURCE_V1 : AVG_SOUND_CONTEXT_V1
  const context = await assembleContext({ projectId: scope.projectId, scope, productProductionId: build.productionId,
    productBuildId: build.id, productProductionTaskKey: task.taskKey, productArtifactKeys: task.inputArtifactKeys,
    sourceKeys: [key], inputBudgetTokens: task.budgetReservation.inputTokens, sourceTransformer: preserveProductProductionContextV1 })
  if (context.overBudgetAfterTrim || context.segments.length !== 1 || !same(context.included, [key])
    || !context.sourceEvidence?.length || context.sourceEvidence.some(s => s.status !== 'included' || s.delivery !== 'full')) {
    throw new Error('[avg-audio-process] 加工接收缺少完整登记上下文')
  }
  const packet = JSON.parse(context.segments[0].content) as { artifacts: Array<{ artifactKey: string; version: number; contentHash: string }> }
  const refs: Array<{ artifactKey: string; version: number; contentHash: string }> = []
  for (const artifactKey of task.inputArtifactKeys) {
    const rows = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id, artifactKey])
      .filter(r => r.status === 'accepted' && r.controlEpoch === build.controlEpoch).limit(2).toArray()
    if (rows.length !== 1) throw new Error('[avg-audio-process] 加工接收依赖缺失或重复')
    const artifact = rows[0]!
    refs.push({ artifactKey, version: artifact.version, contentHash: artifact.contentHash })
    if (artifactKey === original.row.artifactKey && !same(artifact, original.row)) throw new Error('[avg-audio-process] 原音频producer在接收期间变化')
  }
  if (!Array.isArray(packet.artifacts) || !same(packet.artifacts.map(r => ({ artifactKey: r.artifactKey,
    version: r.version, contentHash: r.contentHash })), refs)) throw new Error('[avg-audio-process] 加工上下文依赖与当前准确输入不一致')
  const producer = await readAgentRunV1(scope, input.producerRunId)
  if (producer.run.productBuildId !== build.id || producer.contract.runtimeBindingHash !== await hashAvgTaskRuntimeBindingV1({
    planHash: build.planHash, task, capabilityBindings: [],
  })) throw new Error('[avg-audio-process] 加工producer缺少准确本地Harness绑定')
  const hash = sha256Text(context.text)
  const sourceContextHash = Dexie.currentTransaction ? await Dexie.waitFor(hash) : await hash
  await inspectAvgProcessedAudioSourceV1({ scope, entry, original, row: input.artifact, sourceContextHash })
  const after = await db.productBuilds.get(build.id), owner = await db.productProductions.get(build.productionId)
  if (!same(after, build) || !same(owner, production)) throw new Error('[avg-audio-process] 加工接收期间版本或生产状态已变化')
}
