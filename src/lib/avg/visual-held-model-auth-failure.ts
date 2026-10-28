import { db } from '../db/schema'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { assertProductProductionBudgetLedgerV1, frozenProductProductionTaskExecutionIdentityHashV1 } from '../product-production/scheduler'
import { readAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { sha256MediaData } from '../product-production/media-blob-store'
import { hashAvgHistoricalTaskRuntimeBindingV1 } from './task-claim'
import { AVG_VISUAL_PLANNING_ROLES_V1, avgVisualPlanningMethodV1 } from './visual-planning-roles'
import { AVG_VISUAL_PLANNING_ROLES_V5, avgVisualPlanningMethodV5 } from './visual-planning-roles-v5'
import { avgVisualRoleTargetV4 } from './visual-role-proposal'
import { avgVisualRoleTargetV5 } from './visual-role-proposal-v5'
import { avgRecord, avgText } from './protocol-validation'
import type { AvgHistoricalVisualBoundary } from './visual-history-authority'

const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
const code = 'task-executor-nonretryable'
const fail = (): never => { throw new Error('[avg-held-model-auth] 原文字请求、授权拒绝或终态不闭合；保留未知预留') }

/** Only the complete AI transport error envelope retained by the failed Run.
 * A cached Build message, an author assertion, partial JSON, a transport loss
 * or a server error cannot establish an authorization rejection. No fee is inferred. */
function knownRejectionStatus(detail: unknown, allowModelNotFound: boolean): 401 | 403 | 404 {
  const text = avgText(detail, 'authorization rejection', 1000)
  const matched = /^AI API Error \((401|403|404)\): (\{[\s\S]*\})$/.exec(text)
  if (!matched) return fail()
  const body = avgRecord(JSON.parse(matched[2]), ['error'], 'authorization response')
  const keys = Object.keys(body.error && typeof body.error === 'object' ? body.error : {})
  if (!keys.includes('message') || keys.some(key => !['message', 'type', 'param', 'code'].includes(key))) return fail()
  const error = avgRecord(body.error, keys, 'authorization error')
  avgText(error.message, 'authorization message', 900)
  for (const key of keys.filter(key => key !== 'message')) {
    if (error[key] !== null) avgText(error[key], `authorization ${key}`, 200, true)
  }
  if (matched[1] === '404' && (!allowModelNotFound || error.code !== 'model_not_found')) return fail()
  return Number(matched[1]) as 401 | 403 | 404
}

/** Read-only knowledge of a failed V4/V5 text request before image compilation.
 * It does not settle unknown billing, mutate evidence, resume an old Run, copy
 * adoption or authorize a provider call. A separate Brief and start are still required. */
type HeldModelInput = AvgHistoricalVisualBoundary & { taskKey: string; runId: number; attempt: number }
/** Original V1 remains limited to authentication/authorization. */
export async function readAvgHeldVisualModelAuthorizationFailureV1(input: HeldModelInput) {
  const result = await readHeldModelRejection(input, false)
  if (result.status === 404) return fail()
  return { schema: 'storyforge.avg.held-visual-model-auth-failure' as const, version: 1 as const,
    status: result.status, resultKnown: result.resultKnown, usageKnown: result.usageKnown,
    sourceHash: result.sourceHash, failureHash: result.failureHash }
}
/** V2 additionally recognizes only an exact model_not_found HTTP404. This
 * read never settles fees or authorizes an old request or a model fallback. */
export function readAvgHeldVisualModelRejectionV2(input: HeldModelInput) {
  return readHeldModelRejection(input, true)
}
async function readHeldModelRejection(input: HeldModelInput, allowModelNotFound: boolean) {
  const { scope } = input, build = await db.productBuilds.get(input.buildId)
  if (!build?.id || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || build.stateRevision !== input.expectedBuildRevision || build.briefHash !== input.expectedBriefHash || build.planHash !== input.expectedPlanHash
    || build.previewHash || input.attempt !== 1 || !['failed', 'cancelled', 'recovery-required'].includes(build.status)) return fail()
  const row = await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first()
  const production = await db.productProductions.get(build.productionId)
  if (!row || !production || production.productType !== 'avg'
    || !await assertRecordInScope(scope, 'productProductionBriefs', row, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || row.briefHash !== build.briefHash || row.authorizedAt !== build.authorizedAt || !['authorized', 'superseded'].includes(row.status)) return fail()
  const brief = parseProductProductionBriefV3(row.briefJson), planning = brief.avgVisualPlanning
  if (!planning || ![4, 5].includes(planning.version) || await hashProductProductionValueV2(brief) !== build.briefHash) return fail()
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash), task = plan.tasks.find(t => t.taskKey === input.taskKey)
  const roles = planning.version === 5 ? AVG_VISUAL_PLANNING_ROLES_V5 : AVG_VISUAL_PLANNING_ROLES_V1
  const role = roles.find(r => r.skillId === task?.skillId)
  if (!task || !role || !['avg-v4-visual-direction-proposal', 'avg-v4-subject-visual-proposal', 'avg-v5-visual-direction-proposal', 'avg-v5-subject-visual-proposal'].includes(task.kind)
    || task.executionMode !== 'model' || task.maxAttempts !== 1 || task.budgetReservation.modelCalls !== 1 || task.budgetReservation.mediaCalls !== 0
    || !same(task.capabilityRequirementKeys, ['avg.visual.planning.text']) || plan.controlEpoch !== input.controlEpoch
    || plan.buildNumber !== build.buildNumber || await hashProductProductionValueV2(plan) !== build.planHash) return fail()
  assertProductProductionBudgetLedgerV1(build.budgetLedgerJson)
  const ledger = JSON.parse(build.budgetLedgerJson) as { rootClaim?: unknown; rootRunId: number; attempts: Array<{
    taskKey: string; runId: number; attempt: number; controlEpoch: number; outcome: string; errorCode: string | null;
    usageKnown: boolean; usage: unknown; resolution?: string; idempotencyKey: string }>; tasks: Record<string, {
      runId: number; attempt: number; status: string; errorCode: string | null; usage: unknown; candidateHash: string | null;
      terminalReceiptHash: string | null; passedGateIds: string[]; idempotencyKey: string }> }
  const attempts = ledger.attempts.filter(a => a.taskKey === task.taskKey && a.runId === input.runId && a.attempt === 1)
  const attempt = attempts[0], claim = ledger.tasks[task.taskKey], { maximumCostUsd, ...reservation } = task.budgetReservation
  if (ledger.rootClaim != null || attempts.length !== 1 || !attempt || !claim || attempt.usageKnown || attempt.resolution !== undefined
    || attempt.controlEpoch !== input.controlEpoch || attempt.outcome !== 'failed' || attempt.errorCode !== code
    || !same(attempt.usage, { ...reservation, costUsd: maximumCostUsd }) || claim.runId !== input.runId || claim.attempt !== 1
    || claim.status !== 'failed' || claim.errorCode !== code || claim.usage !== null || claim.candidateHash !== null
    || claim.terminalReceiptHash !== null || claim.passedGateIds.length || claim.idempotencyKey !== attempt.idempotencyKey) return fail()
  const child = await readAgentRunV1(scope, input.runId), root = await readAgentRunV1(scope, ledger.rootRunId)
  const boundary = child.contract.scope.productProduction, parent = root.contract.scope.productProduction
  const skill = getAgentSkillV1(task.skillId!), step = child.projection.steps[task.taskKey], frozen = child.contract.executionBindings?.[0]
  if (child.contract.executionBindings?.length !== 1 || !frozen || frozen.version !== 1 || frozen.stepId !== task.taskKey
    || frozen.skillId !== skill.id || frozen.skillVersion !== skill.version || frozen.promptVersion !== skill.promptVersion
    || !same(child.contract.permissions.writeTargets, skill.writeTargets.map(t => ({ table: t.table, fields: [...t.fields], mode: 'candidate-only', ...(t.adoptionExtension ? { adoptionExtension: t.adoptionExtension } : {}) })))
    || child.run.status !== 'failed' || child.projection.state !== 'failed' || Object.keys(child.projection.steps).length !== 1
    || step?.status !== 'failed' || step.attempt !== 1 || step.failureCode !== code
    || child.run.productBuildId !== build.id || child.run.parentRunId !== root.run.id || child.run.parentRelation !== `task:${task.taskKey}`
    || !boundary || boundary.productBuildId !== build.id || boundary.buildNumber !== build.buildNumber || boundary.planHash !== build.planHash
    || boundary.controlEpoch !== input.controlEpoch || boundary.taskKey !== task.taskKey
    || !['failed', 'cancelled'].includes(root.run.status) || root.run.productBuildId !== build.id || root.run.parentRunId !== null
    || !parent || parent.productBuildId !== build.id || parent.buildNumber !== build.buildNumber || parent.planHash !== build.planHash
    || parent.controlEpoch !== input.controlEpoch || parent.taskKey !== '$root') return fail()
  const events = child.events, requested = events.filter(e => e.type === 'model.requested'), sources = events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'source-snapshot')
  const failures = events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'tool-result')
  const steps = events.filter(e => e.type === 'step.failed'), runs = events.filter(e => e.type === 'run.failed')
  const request = requested[0], sourceEvent = sources[0], failureEvent = failures[0], stepFailure = steps[0], runFailure = runs[0]
  if (requested.length !== 1 || sources.length !== 1 || failures.length !== 1 || steps.length !== 1 || runs.length !== 1
    || !request || request.type !== 'model.requested' || request.payload.stepId !== task.taskKey || request.payload.attempt !== 1
    || !sourceEvent || sourceEvent.type !== 'evidence.artifact.recorded' || !failureEvent || failureEvent.type !== 'evidence.artifact.recorded'
    || sourceEvent.payload.stepId !== task.taskKey || sourceEvent.payload.attempt !== 1 || failureEvent.payload.stepId !== task.taskKey || failureEvent.payload.attempt !== 1
    || sourceEvent.sequence <= request.sequence || failureEvent.sequence <= sourceEvent.sequence || failureEvent.payload.byteLength > 4096
    || !stepFailure || stepFailure.type !== 'step.failed' || stepFailure.payload.stepId !== task.taskKey || stepFailure.payload.attempt !== 1
    || stepFailure.payload.code !== code || stepFailure.payload.retryable !== false || stepFailure.sequence <= failureEvent.sequence
    || !runFailure || runFailure.type !== 'run.failed' || runFailure.payload.code !== code || runFailure.payload.retryable !== false || runFailure.sequence <= stepFailure.sequence
    || events.some(e => e.type === 'model.responded' || e.type === 'tool.called' || e.type === 'candidate.persisted'
      || e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'raw-response')) return fail()
  const exact = async (event: typeof sourceEvent) => {
    const text = await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: event.payload.artifactKind, contentHash: event.payload.contentHash })
    const bytes = new TextEncoder().encode(text)
    if (bytes.byteLength !== event.payload.byteLength || await sha256MediaData(bytes.buffer) !== event.payload.contentHash) return fail()
    return text
  }
  const sourceText = await exact(sourceEvent), failureText = await exact(failureEvent)
  const source = avgRecord(JSON.parse(sourceText), ['schema', 'version', 'taskKey', 'targetArtifactKey', 'scopeHash', 'sourceInputHash', 'systemPrompt', 'contextText', 'category', 'maximumOutputTokens', 'binding', 'promptVersion'], 'failed visual model input')
  const binding = avgRecord(source.binding, ['requirementKey', 'adapterId', 'bindingHash', 'provider', 'model'], 'failed visual model route')
  const target = planning.version === 5 ? avgVisualRoleTargetV5(task, planning.scope) : avgVisualRoleTargetV4(task, planning.scope)
  if (source.schema !== 'storyforge.avg.visual-model-input' || source.version !== (planning.version === 5 ? 2 : 1) || source.taskKey !== task.taskKey
    || source.targetArtifactKey !== target || source.scopeHash !== await hashProductProductionValueV2(planning.scope) || source.sourceInputHash !== planning.scope.sourceInputHash
    || source.systemPrompt !== (planning.version === 5 ? avgVisualPlanningMethodV5(role.subjectKind) : avgVisualPlanningMethodV1(role.subjectKind))
    || source.category !== 'product-production' || source.maximumOutputTokens !== task.budgetReservation.outputTokens || source.promptVersion !== skill.promptVersion
    || binding.requirementKey !== 'avg.visual.planning.text' || binding.bindingHash !== brief.capabilityRequirements.find(c => c.requirementKey === binding.requirementKey)?.capabilityHash
    || request.payload.bindingHash !== await frozenProductProductionTaskExecutionIdentityHashV1(task, child)
    || child.contract.runtimeBindingHash !== await hashAvgHistoricalTaskRuntimeBindingV1({ planHash: build.planHash, task, capabilityBindings: [binding as { requirementKey: string; adapterId: string; bindingHash: string }] }, child)) return fail()
  const context = avgText(source.contextText, 'failed visual context', 1_000_000), packet = JSON.parse(context.slice(context.indexOf('{'), context.lastIndexOf('}') + 1))
  if (packet.schema !== 'storyforge.avg.visual-planning-inputs' || packet.version !== planning.version || packet.taskKey !== task.taskKey
    || packet.productionKey !== production.productionKey || packet.buildNumber !== build.buildNumber || packet.planHash !== build.planHash
    || packet.controlEpoch !== plan.controlEpoch || packet.briefHash !== build.briefHash || packet.briefRevision !== row.revision
    || packet.sourcePlanHash !== row.sourcePlanHash || packet.confirmedBriefHash !== row.confirmedBriefHash
    || packet.sourceInputHash !== planning.scope.sourceInputHash || !same(packet.taskBudget, task.budgetReservation)
    || !same(packet.artifacts.map((a: { artifactKey: string }) => a.artifactKey), task.inputArtifactKeys)) return fail()
  const failure = avgRecord(JSON.parse(failureText), ['schema', 'version', 'taskKey', 'detail'], 'failed visual task')
  if (failure.schema !== 'storyforge.product-task-failure' || failure.version !== 1 || failure.taskKey !== task.taskKey) return fail()
  const status = knownRejectionStatus(failure.detail, allowModelNotFound)
  if (await db.productBuildArtifacts.where('buildId').equals(build.id).filter(a => a.producerRunId === input.runId).count()) return fail()
  const freshChild = await readAgentRunV1(scope, input.runId), freshRoot = await readAgentRunV1(scope, ledger.rootRunId)
  if (!same(await db.productBuilds.get(build.id), build) || !same(await db.productProductions.get(production.id!), production)
    || !same(await db.productProductionBriefs.get(row.id!), row) || !same(freshChild.run, child.run) || !same(freshChild.events, child.events)
    || !same(freshRoot.run, root.run) || !same(freshRoot.events, root.events) || await exact(sourceEvent) !== sourceText || await exact(failureEvent) !== failureText) return fail()
  return { schema: 'storyforge.avg.held-visual-model-rejection' as const, version: 2 as const, status,
    reason: status === 404 ? 'model-not-found' as const : 'authorization' as const, resultKnown: true as const, usageKnown: false as const, sourceHash: sourceEvent.payload.contentHash, failureHash: failureEvent.payload.contentHash }
}
