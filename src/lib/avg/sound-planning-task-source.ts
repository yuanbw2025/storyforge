import type { ProductProductionBriefV3 } from '../types'
import type { ProductProductionTaskExecutionInputV1 } from '../product-production/scheduler'
import { db } from '../db/schema'
import { assertRecordInScope } from '../workspace/scope'
import { assembleContext } from '../registry/assemble-context'
import { preserveProductProductionContextV1 } from '../product-production/context'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { assertAvgTaskHarnessClaimV1, hashAvgTaskRuntimeBindingV1 } from './task-claim'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { combineProductProductionContextV1 } from '../product-production/scheduler'
import { productProductionTaskUsesWorldGatewayV1 } from '../product-production/source-contracts'
import { readRunningContextGatewayRequestV1 } from '../context-gateway/attempt-evidence'
import { canonicalStringify } from '../agent/run/hash'
import { AVG_SOUND_CONTEXT_V1 } from './sound-production-brief'

export async function readAvgSoundPlanningExecutionSourcesV1(input: ProductProductionTaskExecutionInputV1, brief: ProductProductionBriefV3) {
  const planning = brief.avgSoundPlanning, build = await db.productBuilds.get(input.buildId)
  if (!planning || !build || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' }) || !(['avg-assembly-integrate', 'avg-assembly-verify'].includes(input.task.kind) ? ['building', 'integrating'] : ['building']).includes(build.status)
    || build.productionId !== input.productionId || build.buildNumber !== input.buildNumber || build.controlEpoch !== input.controlEpoch
    || build.planHash !== input.planHash || build.briefHash !== await hashProductProductionValueV2(brief)) throw new Error('[avg-sound-plan] 执行来源或完整Brief已stale')
  const claim = await assertAvgTaskHarnessClaimV1(input, build.budgetLedgerJson)
  await (await import('./visual-planning-restart')).assertAvgSoundOtherRequestsKnownV1(input.scope, build)
  if (claim.child.contract.runtimeBindingHash !== await hashAvgTaskRuntimeBindingV1(input)) throw new Error('[avg-sound-plan] 本次路由不是实际Harness claim')
  const normal = await assembleContext({ projectId: input.scope.projectId, scope: input.scope,
    productProductionId: input.productionId, productBuildId: input.buildId, productProductionTaskKey: input.task.taskKey,
    productArtifactKeys: input.task.inputArtifactKeys, sourceKeys: [AVG_SOUND_CONTEXT_V1],
    inputBudgetTokens: input.task.budgetReservation.inputTokens, sourceTransformer: preserveProductProductionContextV1 })
  let assembled = normal
  if (productProductionTaskUsesWorldGatewayV1(input.task)) {
    const original = await readRunningContextGatewayRequestV1({ scope: input.scope, runId: input.taskRunId!, stepId: input.task.taskKey, attempt: input.attempt })
    assembled = combineProductProductionContextV1({ assembled: normal, worldContent: original.contextPacket.content,
      worldContentHash: original.contextPacket.contentHash, worldTokens: original.contextPacket.tokenCount, inputBudget: input.task.budgetReservation.inputTokens })
    if (original.renderedRequestJson !== canonicalStringify({ schema: 'storyforge.product-production-task-request', version: 1,
      taskKey: input.task.taskKey, planHash: input.planHash, executionMode: input.task.executionMode, contextText: assembled.text,
      inputArtifacts: input.inputArtifacts.map(r => ({ artifactKey: r.artifactKey, contentHash: r.contentHash })) })) throw new Error('[avg-sound-plan] 世界Gateway原预检请求与准确组装输入不一致')
  }
  if (assembled.text !== input.contextText || assembled.overBudgetAfterTrim || normal.segments.length !== 1
    || canonicalProductProductionJsonV2(normal.included) !== canonicalProductProductionJsonV2([AVG_SOUND_CONTEXT_V1])
    || !assembled.sourceEvidence?.length || assembled.sourceEvidence.some(s => s.status !== 'included' || s.delivery !== 'full')) throw new Error('[avg-sound-plan] 实际上下文不是完整登记投影：' + JSON.stringify({
      sameText: assembled.text === input.contextText, overBudget: assembled.overBudgetAfterTrim, segments: assembled.segments.length,
      included: assembled.included, evidence: assembled.sourceEvidence?.map(s => ({ key: s.key, status: s.status, delivery: s.delivery })) }))
  const packet = JSON.parse(normal.segments[0].content) as { artifacts: Array<{ artifactKey: string; version: number; contentHash: string }> }
  const supplied = input.inputArtifacts.map(r => ({ artifactKey: r.artifactKey, version: r.version, contentHash: r.contentHash }))
  const refs = input.task.inputArtifactKeys.map(key => supplied.find(r => r.artifactKey === key))
  if (supplied.length !== refs.length || new Set(supplied.map(r => r.artifactKey)).size !== refs.length || refs.some(r => !r)
    || canonicalProductProductionJsonV2(packet.artifacts) !== canonicalProductProductionJsonV2(refs)) throw new Error('[avg-sound-plan] Harness准确依赖与作者来源不一致')
  for (const row of input.inputArtifacts) {
    if (row.kind === 'image' || row.kind === 'audio') {
      const actual = await verifyAcceptedProductBuildArtifactV1({ scope: input.scope, buildId: input.buildId, artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash })
      if (canonicalProductProductionJsonV2(actual) !== canonicalProductProductionJsonV2(row)) throw new Error('[avg-sound-plan] 实际媒体依赖与Harness输入不同')
    } else if (await hashProductProductionValueV2(JSON.parse(row.payloadJson)) !== row.contentHash) throw new Error('[avg-sound-plan] 依赖字节已损坏')
  }
  return { ...claim, planning, build, refs, packet }
}
