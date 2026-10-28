import { db } from '../db/schema'
import type { ProductProductionBriefV3 } from '../types'
import type { ProductProductionTaskExecutionInputV1 } from '../product-production/scheduler'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { assembleContext } from '../registry/assemble-context'
import { preserveProductProductionContextV1 } from '../product-production/context'
import { productProductionTaskUsesWorldGatewayV1 } from '../product-production/source-contracts'
import { assertAvgTaskHarnessClaimV1, hashAvgTaskRuntimeBindingV1 } from './task-claim'
import { assertAvgAudioProcessingBriefV1 } from './audio-production-brief'
import { assertAvgAudioProcessingTaskShapeV1 } from './audio-production-topology'
import { parseAvgAudioProductionProcessingPlan, avgAudioProcessingTaskKeyV1 } from './audio-production-contract'
import { AVG_TASK_CONTEXT_SOURCE_V1 } from './task-context'
import { AVG_SOUND_CONTEXT_V1 } from './sound-production-brief'
import { readAvgAudioProcessingRawSourceV1 } from './audio-processing-raw-source'

const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

/** Actual current read through existing registered Context and sealed raw
 * readers. No synthetic input filtering, copied claim, model call, author
 * adoption or licence grant. Frozen historical release reading is separate. */
export async function readAvgAudioProcessingSourcesV1(input: ProductProductionTaskExecutionInputV1, brief: ProductProductionBriefV3) {
  assertAvgAudioProcessingBriefV1(brief)
  if (!brief.avgAudioProcessing || input.task.kind !== 'avg-audio-process' || input.capabilityBindings.length
    || input.signal.aborted || !input.contextText.trim()) throw new Error('[avg-audio-process] 缺少准确本地任务、冻结声明或登记上下文')
  const processing = parseAvgAudioProductionProcessingPlan(brief.avgAudioProcessing)
  const entry = processing.entries.find(e => avgAudioProcessingTaskKeyV1(e.domain, e.requirementKey) === input.task.taskKey)
  const build = await db.productBuilds.get(input.buildId), production = await db.productProductions.get(input.productionId)
  if (!entry || !build || !production
    || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })
    || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })
    || build.productionId !== input.productionId || build.buildNumber !== input.buildNumber || build.status !== 'building'
    || build.controlEpoch !== input.controlEpoch || build.planHash !== input.planHash
    || build.briefHash !== await hashProductProductionValueV2(brief) || production.productType !== 'avg'
    || production.status !== 'producing' || production.controlEpoch !== input.controlEpoch
    || production.currentBuildNumber !== input.buildNumber) throw new Error('[avg-audio-process] 加工不属于准确当前Work/Build/已授权Brief')
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
  assertAvgAudioProcessingTaskShapeV1(input.task, plan.tasks, 'avg')
  if (await hashProductProductionValueV2(plan) !== build.planHash || plan.buildNumber !== input.buildNumber
    || plan.controlEpoch !== input.controlEpoch || !same(plan.tasks.find(t => t.taskKey === input.task.taskKey), input.task)
    || productProductionTaskUsesWorldGatewayV1(input.task)) throw new Error('[avg-audio-process] 加工任务或实际确定性输入域与冻结Plan不一致')
  const claim = await assertAvgTaskHarnessClaimV1(input, build.budgetLedgerJson, null)
  if (claim.child.contract.runtimeBindingHash !== await hashAvgTaskRuntimeBindingV1(input)) throw new Error('[avg-audio-process] 加工缺少准确root/子Run与本地零调用runtime绑定')
  const key = entry.domain === 'voice' ? AVG_TASK_CONTEXT_SOURCE_V1 : AVG_SOUND_CONTEXT_V1
  const context = await assembleContext({ projectId: input.scope.projectId, scope: input.scope,
    productProductionId: input.productionId, productBuildId: input.buildId, productProductionTaskKey: input.task.taskKey,
    productArtifactKeys: input.task.inputArtifactKeys, sourceKeys: [key],
    inputBudgetTokens: input.task.budgetReservation.inputTokens, sourceTransformer: preserveProductProductionContextV1 })
  if (context.text !== input.contextText || context.overBudgetAfterTrim || context.segments.length !== 1
    || !same(context.included, [key]) || !context.sourceEvidence?.length
    || context.sourceEvidence.some(s => s.status !== 'included' || s.delivery !== 'full')) {
    throw new Error('[avg-audio-process] 加工上下文不是完整登记的准确原件引用/请求hash/冻结配方')
  }
  const packet = JSON.parse(context.segments[0].content) as { artifacts: Array<{ artifactKey: string; version: number; contentHash: string }> }
  const refs = input.task.inputArtifactKeys.map(key => {
    const found = input.inputArtifacts.filter(r => r.artifactKey === key)
    if (found.length !== 1) throw new Error('[avg-audio-process] 加工Harness准确输入缺失或重复')
    return found[0]!
  })
  const reference = (r: typeof refs[number]) => ({ artifactKey: r.artifactKey, version: r.version, contentHash: r.contentHash })
  if (refs.length !== input.inputArtifacts.length || !Array.isArray(packet.artifacts)
    || !same(packet.artifacts.map(r => ({ artifactKey: r.artifactKey, version: r.version, contentHash: r.contentHash })), refs.map(reference))) {
    throw new Error('[avg-audio-process] 加工输入与登记上下文的准确依赖不一致')
  }
  for (const row of refs) {
    const actual = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([input.buildId, row.artifactKey])
      .filter(r => r.status === 'accepted' && r.controlEpoch === input.controlEpoch).limit(2).toArray()
    if (actual.length !== 1 || !same(actual[0], row)) throw new Error('[avg-audio-process] 加工不能替换已采用依赖、原producer或元数据')
  }
  const rawKey = 'avg.' + entry.domain + '.raw.' + entry.requirementKey
  const original = refs.find(r => r.artifactKey === rawKey)
  if (!original) throw new Error('[avg-audio-process] 加工缺少准确同Build原音频')
  const raw = await readAvgAudioProcessingRawSourceV1({ scope: input.scope, buildId: input.buildId,
    brief, domain: entry.domain, raw: reference(original) })
  const current = await db.productBuilds.get(input.buildId), owner = await db.productProductions.get(input.productionId)
  if (!same(raw.row, original) || !current || !owner || current.stateRevision !== build.stateRevision
    || current.controlEpoch !== input.controlEpoch || current.planHash !== build.planHash || current.briefHash !== build.briefHash
    || current.status !== 'building' || owner.status !== 'producing' || owner.controlEpoch !== input.controlEpoch
    || owner.currentBuildNumber !== input.buildNumber || owner.currentBriefRevision !== production.currentBriefRevision) {
    throw new Error('[avg-audio-process] 加工来源读取期间原件、Brief或制作状态已变化')
  }
  return { entry, raw, build, refs: refs.map(reference) }
}
