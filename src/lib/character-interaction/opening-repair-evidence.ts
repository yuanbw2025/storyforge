import {db} from '../db/schema'
import {canonicalStringify} from '../agent/run/hash'
import {readAgentRunV1} from '../agent/run/event-store'
import {readAgentRunArtifactExactV1, recordAgentRunArtifactV1} from '../memory/artifact-store'
import type {ProductBuildRecordV1, WorkspaceScope} from '../types'
import type {ProductProductionTaskExecutionInputV1} from '../product-production/scheduler'
import {CHAT_OPENING_REPAIR_GATE_V1} from './opening-repair'
import {CHAT_OPENING_REPAIR_GATE_V2} from './opening-repair-patch'
import {CHAT_OPENING_OPTION_REPAIR_GATE_V1, type ChatOpeningRepairPlanV5} from './opening-option-repair'
import {CHAT_OPENING_FACT_CATALOG_KEY, CHAT_OPENING_REFERENCE_GATE_V1, CHAT_OPENING_SOURCE_COMPLETENESS_GATE_V1} from './opening-source-references'

function fail(): never {throw new Error('[chat-opening-repair] 定向修复缺少同一冻结任务的完整原始证据')}

export async function recordChatOpeningRepairV1(input: ProductProductionTaskExecutionInputV1, repair: ChatOpeningRepairPlanV5): Promise<void> {
  if (input.attempt !== 1 || input.taskRunId == null || input.signal.aborted) fail()
  if (await input.beforeAdditionalModelRequest?.() === 'discarded-stale') fail()
  const snapshot = await readAgentRunV1(input.scope, input.taskRunId)
  const step = snapshot.projection.steps[input.task.taskKey]
  if (snapshot.projection.state !== 'running' || step?.status !== 'running' || step.attempt !== 1
    || !snapshot.events.some(event => event.type === 'evidence.artifact.recorded'
      && event.payload.stepId === input.task.taskKey && event.payload.attempt === 1
      && event.payload.artifactKind === 'raw-response' && event.payload.contentHash === repair.rawResponseHash)) fail()
  await recordAgentRunArtifactV1({
    scope: input.scope, runId: input.taskRunId, stepId: input.task.taskKey, attempt: 1,
    artifactKind: 'tool-result', content: canonicalStringify(repair),
    expectedLastSequence: snapshot.projection.lastSequence,
  })
}

/** Registered repair-feedback source for the second attempt of this exact run. */
export async function readChatOpeningAutomaticRepairFeedbackV1(input: {
  scope: WorkspaceScope
  build: ProductBuildRecordV1
  taskKey: string
}) {
  if (input.taskKey !== 'content.product-module') return null
  const ledger = JSON.parse(input.build.budgetLedgerJson)
  const taskEntry = ledger.tasks?.[input.taskKey]
  if (!taskEntry?.runId) return null
  const snapshot = await readAgentRunV1(input.scope, taskEntry.runId)
  const step = snapshot.projection.steps[input.taskKey]
  if (!step || step.attempt < 2) return null
  const binding = snapshot.contract.executionBindings?.find(item => item.stepId === input.taskKey)
  if (!binding || !['chat-situation-production-v7', 'chat-situation-production-v8', 'chat-situation-production-v9', 'chat-situation-production-v10', 'chat-situation-production-v11', 'chat-situation-production-v12', 'chat-situation-production-v13', 'chat-situation-production-v14'].includes(binding.promptVersion)) return null
  const completeSourceFacts = ['chat-situation-production-v11', 'chat-situation-production-v12', 'chat-situation-production-v13', 'chat-situation-production-v14'].includes(binding.promptVersion)
  const optionRepair = completeSourceFacts || binding.promptVersion === 'chat-situation-production-v10'
  const sourceReferences = optionRepair || binding.promptVersion === 'chat-situation-production-v9'
  const patchRepair = sourceReferences || binding.promptVersion === 'chat-situation-production-v8'
  const boundary = snapshot.contract.scope.productProduction
  const plan = JSON.parse(input.build.planJson)
  const task = plan.tasks?.find((item: {taskKey: string}) => item.taskKey === input.taskKey)
  if (binding.skillId !== 'character.chat-situation-production'
    || !task?.acceptanceGateIds.includes(patchRepair ? CHAT_OPENING_REPAIR_GATE_V2 : CHAT_OPENING_REPAIR_GATE_V1)
    || task.acceptanceGateIds.includes(patchRepair ? CHAT_OPENING_REPAIR_GATE_V1 : CHAT_OPENING_REPAIR_GATE_V2)
    || sourceReferences !== task.acceptanceGateIds.includes(CHAT_OPENING_REFERENCE_GATE_V1)
    || optionRepair !== task.acceptanceGateIds.includes(CHAT_OPENING_OPTION_REPAIR_GATE_V1)
    || completeSourceFacts !== task.acceptanceGateIds.includes(CHAT_OPENING_SOURCE_COMPLETENESS_GATE_V1)
    || sourceReferences && !task.inputArtifactKeys.includes(CHAT_OPENING_FACT_CATALOG_KEY)
    || snapshot.projection.state !== 'running' || step.status !== 'running' || step.attempt !== 2
    || !boundary || boundary.productBuildId !== input.build.id || boundary.buildNumber !== input.build.buildNumber
    || boundary.controlEpoch !== input.build.controlEpoch || boundary.planHash !== input.build.planHash
    || boundary.taskKey !== input.taskKey
    || snapshot.run.productBuildId !== input.build.id || snapshot.run.parentRelation !== `task:${input.taskKey}`
    || snapshot.run.parentRunId !== ledger.rootRunId
    || task.budgetReservation.modelCalls !== 2 || task.maxAttempts !== 2
    || !snapshot.events.some(event => event.type === 'step.failed' && event.payload.stepId === input.taskKey
      && event.payload.attempt === 1 && event.payload.retryable && event.payload.action === 'retry')
    || !ledger.attempts?.some((entry: {runId: number; attempt: number; taskKey: string; controlEpoch: number; outcome: string; usageKnown: boolean; usage: {modelCalls: number}}) =>
      entry.runId === snapshot.run.id && entry.attempt === 1 && entry.taskKey === input.taskKey
      && entry.controlEpoch === input.build.controlEpoch && entry.outcome === 'failed'
      && entry.usageKnown && entry.usage.modelCalls === 1)) fail()
  const evidence: Array<{kind: string; contentHash: string; content: string}> = []
  for (const event of snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.stepId !== input.taskKey
      || event.payload.attempt !== 1 || !['raw-response', 'tool-result'].includes(event.payload.artifactKind)) continue
    evidence.push({
      kind: event.payload.artifactKind, contentHash: event.payload.contentHash,
      content: await readAgentRunArtifactExactV1({
        projectId: input.scope.projectId, artifactKind: event.payload.artifactKind, contentHash: event.payload.contentHash,
      }),
    })
  }
  const tools = evidence.filter(item => item.kind === 'tool-result').map(item => JSON.parse(item.content))
  const repairs = tools.filter(item => item.schema === 'storyforge.chat-opening-targeted-repair')
  const failures = tools.filter(item => item.schema === 'storyforge.product-task-failure')
  const raw = evidence.filter(item => item.kind === 'raw-response')
  if (repairs.length !== 1 || failures.length !== 1 || raw.length !== 1
    || repairs[0].version !== (completeSourceFacts ? 5 : optionRepair ? 4 : sourceReferences ? 3 : patchRepair ? 2 : 1) || repairs[0].rawResponseHash !== raw[0].contentHash
    || failures[0].taskKey !== input.taskKey || failures[0].detail !== repairs[0].error) fail()
  return {
    schema: 'storyforge.product-production.repair-feedback', version: 1,
    taskKey: input.taskKey, authorRepairNote: null, authorDraftJson: null,
    automaticOpeningRepair: repairs[0] as ChatOpeningRepairPlanV5,
    previous: {
      runId: snapshot.run.id, contractHash: snapshot.run.contractHash,
      controlEpoch: boundary.controlEpoch, attempt: 1, evidence,
    },
  }
}

/** Require the exact registered packet to have reached the actual model input. */
export async function requireDeliveredChatOpeningRepairV1(input: ProductProductionTaskExecutionInputV1) {
  const build = await db.productBuilds.get(input.buildId)
  if (!build || build.productionId !== input.productionId) fail()
  const packet = await readChatOpeningAutomaticRepairFeedbackV1({scope: input.scope, build, taskKey: input.task.taskKey})
  if (!packet || packet.previous.runId !== input.taskRunId || input.attempt !== 2) fail()
  const delivered = input.contextText.split(/\n\s*\n/g).flatMap(segment => {
    try {
      const value = JSON.parse(segment)
      return value?.schema === 'storyforge.product-production.repair-feedback' ? [value] : []
    } catch {return []}
  })
  if (delivered.length !== 1 || canonicalStringify(delivered[0]) !== canonicalStringify(packet)) fail()
  return {repair: packet.automaticOpeningRepair, raw: packet.previous.evidence.find(item => item.kind === 'raw-response')!.content}
}
