import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { db } from '../db/schema'
import type { ProductProductionTaskUsageV1 } from '../product-production/scheduler'
import { assertProductProductionBudgetLedgerV1 } from '../product-production/scheduler'
import { readAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { sha256MediaData } from '../product-production/media-blob-store'
import { readAvgHistoricalCompiledImageDefinitionV4, type AvgHistoricalVisualBoundaryV4 } from './visual-image-history'
import { hashAvgTaskRuntimeBindingV1 } from './task-claim'
import { avgRecord, avgText } from './protocol-validation'

const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
const failureCode = 'task-executor-nonretryable'
const fail = (): never => { throw new Error('[avg-held-image] 原请求、领取、终态或明确失败响应不闭合；保留未知预留') }

/** Only the synchronous image adapter's complete JSON 503 error response.
 * Operation-only, omitted, successful, malformed or contradictory bodies
 * cannot establish a definitive failed outcome. This says nothing about fees. */
export function parseAvgHeldImageQueueFailureV4(text: string) {
  if (new TextEncoder().encode(text).byteLength > 32 * 1024) return fail()
  const response = avgRecord(JSON.parse(text), ['schema', 'version', 'status', 'contentType', 'providerRequestId',
    'usage', 'costUsd', 'json', 'rawText', 'binaryBodyHash', 'binaryBodyBase64'], 'held image response')
  if (response.schema !== 'storyforge.avg.image-provider-response' || response.version !== 1 || response.status !== 503
    || typeof response.contentType !== 'string' || !/^application\/json(?:;|$)/i.test(response.contentType)
    || response.usage !== null || response.costUsd !== null || response.json !== null
    || response.binaryBodyHash !== null || response.binaryBodyBase64 !== null) return fail()
  if (response.providerRequestId !== null) avgText(response.providerRequestId, 'provider request id', 200)
  const raw = avgText(response.rawText, 'raw queue failure', 16 * 1024)
  const body = avgRecord(JSON.parse(raw), ['error'], 'queue failure body')
  const errorKeys = Object.keys(body.error && typeof body.error === 'object' ? body.error : {})
  if (errorKeys.some(key => !['message', 'type', 'param', 'code'].includes(key))) return fail()
  const error = avgRecord(body.error, errorKeys, 'queue failure error')
  const message = avgText(error.message, 'queue failure message', 2000)
  for (const key of ['type', 'param']) if (key in error) avgText(error[key], `queue failure ${key}`, 200, true)
  if ('code' in error && error.code !== null && error.code !== 'queue_full') return fail()
  return { status: 503 as const, message, providerRequestId: response.providerRequestId as string | null }
}

type HeldAttempt = { taskKey: string; runId: number; attempt: number; controlEpoch: number; idempotencyKey: string;
  outcome: string; usage: ProductProductionTaskUsageV1 | null; usageKnown: boolean; errorCode: string | null; resolution?: string }
type HeldClaim = { runId: number; attempt: number; status: string; idempotencyKey: string; usage: ProductProductionTaskUsageV1 | null;
  candidateHash: string | null; terminalReceiptHash: string | null; passedGateIds: string[]; errorCode: string | null }

/** Read-only result knowledge for an old held image attempt, not an accounting
 * repair, receipt replacement, old Run replay or permission to start a Build.
 * The exact original reservation remains unknown and is never released here. */
export async function readAvgHeldImageQueueFailureV4(input: AvgHistoricalVisualBoundaryV4 & { taskKey: string; runId: number; attempt: number }) {
  const history = await readAvgHistoricalCompiledImageDefinitionV4(input)
  const { scope, build, plan, planning } = history
  if (input.attempt !== 1 || build.previewHash || !['cancelled', 'failed', 'recovery-required'].includes(build.status)) return fail()
  const task = plan.tasks.find(t => t.taskKey === input.taskKey)
  const requirement = history.proposal.batch.requirements.find(r => input.taskKey === `avg.media.generate.${r.requirementKey}`)
  if (!task || !requirement || task.kind !== 'avg-media-image-generate' || task.executionMode !== 'media-provider'
    || task.maxAttempts !== 1 || task.skillId !== 'avg.compiled-image-request.v1'
    || !same(task.capabilityRequirementKeys, ['avg.media.image']) || task.budgetReservation.modelCalls !== 0 || task.budgetReservation.mediaCalls !== 1
    || !same(task.outputArtifactKeys, [`avg.media.raw.${requirement.requirementKey}`])
    || !['agnes.image-2.1-flash.v1', 'agnes.image-2.5-flash.v1'].includes(planning.imageBinding.adapterId)) return fail()
  assertProductProductionBudgetLedgerV1(build.budgetLedgerJson)
  const ledger = JSON.parse(build.budgetLedgerJson) as { rootClaim?: unknown; rootRunId: number; attempts: HeldAttempt[]; tasks: Record<string, HeldClaim> }
  const attempts = ledger.attempts.filter(a => a.taskKey === input.taskKey && a.runId === input.runId && a.attempt === input.attempt)
  const attempt = attempts[0], claim = ledger.tasks[input.taskKey], { maximumCostUsd, ...reservation } = task.budgetReservation
  if (ledger.rootClaim != null || attempts.length !== 1 || !attempt || !claim || attempt.usageKnown || attempt.resolution !== undefined
    || attempt.controlEpoch !== input.controlEpoch || attempt.outcome !== 'failed' || attempt.errorCode !== failureCode
    || !same(attempt.usage, { ...reservation, costUsd: maximumCostUsd })
    || claim.runId !== input.runId || claim.attempt !== 1 || claim.status !== 'failed' || claim.errorCode !== failureCode
    || claim.idempotencyKey !== attempt.idempotencyKey || claim.usage !== null || claim.candidateHash !== null
    || claim.terminalReceiptHash !== null || claim.passedGateIds.length !== 0) return fail()
  const child = await readAgentRunV1(scope, input.runId), root = await readAgentRunV1(scope, ledger.rootRunId)
  const boundary = child.contract.scope.productProduction, rootBoundary = root.contract.scope.productProduction
  const step = child.projection.steps[input.taskKey], binding = planning.imageBinding, skill = getAgentSkillV1(task.skillId)
  const writes = skill.writeTargets.map(target => ({ table: target.table, fields: [...target.fields], mode: 'candidate-only',
    ...(target.adoptionExtension ? { adoptionExtension: target.adoptionExtension } : {}) }))
  if (!same(child.contract.executionBindings, [{ stepId: input.taskKey, ...createAgentSkillExecutionBindingV1(skill) }])
    || !same(child.contract.permissions.writeTargets, writes)
    || child.run.status !== 'failed' || child.projection.state !== 'failed' || Object.keys(child.projection.steps).length !== 1
    || step?.status !== 'failed' || step.attempt !== 1 || step.failureCode !== failureCode
    || child.run.productBuildId !== build.id || child.run.parentRunId !== root.run.id || child.run.parentRelation !== `task:${input.taskKey}`
    || !boundary || boundary.productBuildId !== build.id || boundary.buildNumber !== build.buildNumber || boundary.planHash !== build.planHash
    || boundary.controlEpoch !== input.controlEpoch || boundary.taskKey !== input.taskKey
    || !['failed', 'cancelled'].includes(root.run.status) || root.run.productBuildId !== build.id || root.run.parentRunId !== null
    || !rootBoundary || rootBoundary.productBuildId !== build.id || rootBoundary.buildNumber !== build.buildNumber || rootBoundary.planHash !== build.planHash
    || rootBoundary.controlEpoch !== input.controlEpoch || rootBoundary.taskKey !== '$root'
    || child.contract.runtimeBindingHash !== await hashAvgTaskRuntimeBindingV1({ planHash: build.planHash, task,
      capabilityBindings: [{ requirementKey: binding.requirementKey, adapterId: binding.adapterId, bindingHash: binding.bindingHash }] })) return fail()
  const calls = child.events.filter(e => e.type === 'tool.called'), raw = child.events.filter(e => e.type === 'evidence.artifact.recorded').filter(e => e.payload.artifactKind === 'raw-response')
  const failures = child.events.filter(e => e.type === 'evidence.artifact.recorded').filter(e => e.payload.artifactKind === 'tool-result')
  const call = calls[0], responseEvent = raw[0], failureEvent = failures[0]
  const stepFailures = child.events.filter(e => e.type === 'step.failed'), runFailures = child.events.filter(e => e.type === 'run.failed')
  const stepFailure = stepFailures[0], runFailure = runFailures[0]
  if (stepFailures.length !== 1 || runFailures.length !== 1 || !stepFailure || !runFailure
    || stepFailure.payload.stepId !== input.taskKey || stepFailure.payload.attempt !== 1 || stepFailure.payload.code !== failureCode
    || stepFailure.payload.retryable !== false || runFailure.payload.code !== failureCode || runFailure.payload.retryable !== false
    || calls.length !== 1 || raw.length !== 1 || failures.length !== 1 || child.events.some(e => e.type === 'model.requested')
    || !call || call.payload.toolName !== 'game-media-provider' || call.payload.stepId !== input.taskKey || call.payload.attempt !== 1
    || call.payload.callHash !== attempt.idempotencyKey || !responseEvent || !failureEvent
    || responseEvent.sequence <= call.sequence || failureEvent.sequence <= responseEvent.sequence
    || stepFailure.sequence <= failureEvent.sequence || runFailure.sequence <= stepFailure.sequence
    || responseEvent.payload.stepId !== input.taskKey || responseEvent.payload.attempt !== 1 || responseEvent.payload.byteLength > 32 * 1024
    || failureEvent.payload.stepId !== input.taskKey || failureEvent.payload.attempt !== 1 || failureEvent.payload.byteLength > 4096) return fail()
  const exact = async (event: typeof responseEvent) => {
    const text = await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: event.payload.artifactKind, contentHash: event.payload.contentHash })
    const bytes = new TextEncoder().encode(text)
    if (bytes.byteLength !== event.payload.byteLength || await sha256MediaData(bytes.buffer) !== event.payload.contentHash) return fail()
    return text
  }
  const rawText = await exact(responseEvent), response = parseAvgHeldImageQueueFailureV4(rawText), failureText = await exact(failureEvent)
  const failure = avgRecord(JSON.parse(failureText), ['schema', 'version', 'taskKey', 'detail'], 'held task failure')
  if (failure.schema !== 'storyforge.product-task-failure' || failure.version !== 1 || failure.taskKey !== input.taskKey
    || !avgText(failure.detail, 'failure detail', 1000).startsWith('[avg-media] 图片响应已保存但未通过原图校验（HTTP 503）；')) return fail()
  if (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!, task.outputArtifactKeys[0]]).count()) return fail()
  const freshChild = await readAgentRunV1(scope, input.runId), freshRoot = await readAgentRunV1(scope, ledger.rootRunId)
  if (!same(freshChild.run, child.run) || !same(freshChild.events, child.events) || !same(freshRoot.run, root.run)
    || !same(await db.productBuilds.get(build.id!), build) || !same(await db.productProductions.get(history.production.id!), history.production)
    || !same(await db.productProductionBriefs.get(history.records.brief.id!), history.records.brief)
    || await exact(responseEvent) !== rawText || await exact(failureEvent) !== failureText) return fail()
  for (const row of history.records.artifacts) if (!same(await db.productBuildArtifacts.get(row.id!), row)) return fail()
  return { schema: 'storyforge.avg.held-image-known-failure' as const, version: 1 as const, buildId: build.id!, buildNumber: build.buildNumber,
    planHash: build.planHash, controlEpoch: input.controlEpoch, taskKey: input.taskKey, runId: input.runId, attempt: 1 as const,
    rawResponseHash: responseEvent.payload.contentHash, failureHash: failureEvent.payload.contentHash, status: response.status,
    resultKnown: true as const, usageKnown: false as const, heldUsage: structuredClone(attempt.usage) }
}
