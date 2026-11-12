import { createContextManifestV1, createContextManifestV2FromV1 } from '../../src/lib/agent/run/context-manifest'
import { appendAgentRunEventV1, createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { finalizeContextGatewayAttemptEvidenceV1, recordContextGatewayPreflightEvidenceV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { executeContextGatewayV1 } from '../../src/lib/context-gateway/execution'
import { db } from '../../src/lib/db/schema'
import {
  aggregateProductSourceManifestFromExactRunsV1, assertFormalProductProductionStartV1,
  createConfirmedProductBriefV1, createWorldReferenceV1, freezeProductSourcePlanV1,
  portableProductSourcePlanV1, resolveProductSourceReadBoundaryV1,
  TTRPG_WORLD_REQUIREMENT_ADAPTER_V1, validateProductSourceManifestV1,
} from '../../src/lib/product/source'
import type { AgentRunEventPayloadByTypeV1, AgentRunEventTypeV1, ProductSourcePlanV1, WorkspaceScope } from '../../src/lib/types'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentProductWorld } from './current-product-world'


async function sourceWorld() {
  const { scope } = await createWorkspace({
    name: '018 无故事来源世界', genres: [], status: 'drafting', description: '',
    targetWordCount: 10_000, enableMultiWorld: false,
  }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const now = Date.now()
  await db.worldviews.add(stampNewRecord(scope, 'worldviews', {
    projectId: scope.projectId, summary: '孤岛港口', createdAt: now, updatedAt: now,
  }, { owner: 'world' }))
  const revision = await createWorldRevision({ scope, label: '018 WorldRelease' })
  return { scope, release: await publishWorldRevision(revision.id!) }
}

async function planFor(releaseId: number, active: boolean, missingStrategy: ProductSourcePlanV1['missingStrategy'] = 'block') {
  return freezeProductSourcePlanV1({
    worldReference: await createWorldReferenceV1(releaseId),
    adapter: TTRPG_WORLD_REQUIREMENT_ADAPTER_V1,
    productInstanceKey: 'campaign:conditional-018',
    goal: {
      selectedAreas: ['foundation'], selectedContextKinds: ['worldview-field'], selectedResourceKinds: [],
      selectedResourceCount: 1, participantCount: 0, includeSelectedRelations: true,
      inheritStoryContinuity: active, allowCrossWorld: false,
    },
    missingStrategy, createdAt: 10,
  })
}

function storyRequirement(plan: ProductSourcePlanV1) {
  return plan.requirements.find(rule => rule.key === 'story-continuity')!
}

async function start(sourcePlan: ProductSourcePlanV1) {
  const confirmedBrief = await createConfirmedProductBriefV1({
    productType: 'ttrpg', productInstanceKey: sourcePlan.productInstanceKey, sourcePlan,
    briefRevision: 1, authorStartRevision: 1, confirmedAt: 11, briefContentHash: 'a'.repeat(64),
  })
  return assertFormalProductProductionStartV1({ sourcePlan, confirmedBrief, authorStartRevision: 1 })
}

// Persist a real deterministic Gateway attempt in the same evidence chain as production.
async function persistRead(scope: WorkspaceScope, sourcePlan: ProductSourcePlanV1, extraKeys: string[] = []) {
  const boundary = await resolveProductSourceReadBoundaryV1(sourcePlan)
  const keys = [...new Set([...boundary.mandatoryResourceKeys, ...extraKeys])]
  const execution = await executeContextGatewayV1({
    skill: getAgentSkillV1('product-production.consult.v1'), scope, resourceScope: boundary.sourceScope,
    accessPolicyOverride: sourcePlan.gatewayPolicy, allowedResourceKeys: keys,
    mandatoryResourceKeys: keys, mandatoryFullResourceKeys: keys, additionalReadsEnabled: false,
  })
  let run = await createAgentRunV1({ scope, contract: {
    version: 1, objective: '018 条件读取证据', workflowKind: 'direct-generation', runtimeBindingHash: 'b'.repeat(64),
    scope: { projectId: scope.projectId, worldGroupId: null }, permissions: { contextSourceKeys: ['worldRelease'], writeTargets: [] },
    budget: { maxModelCalls: 1, maxToolCalls: 200, maxInputTokens: 100000, maxOutputTokens: 1000, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'read', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'terminal', kind: 'terminal', verifier: 'conditional-read-fixture-v1', criterionIds: ['read'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
  } })
  const append = async <T extends AgentRunEventTypeV1>(type: T, payload: AgentRunEventPayloadByTypeV1[T]) => {
    run = await appendAgentRunEventV1({ scope, runId: run.run.id, type, payload, expectedLastSequence: run.projection.lastSequence })
  }
  await append('step.scheduled', { stepId: 'read' })
  await append('step.started', { stepId: 'read', attempt: 1 })
  const v1 = await createContextManifestV1({
    version: 1, runId: run.run.id, stepId: 'read', attempt: 1, scope: { projectId: scope.projectId, worldGroupId: null },
    inputBudget: 100000, totalInputTokens: execution.contextPacket.tokenCount,
    sources: [{ key: 'worldRelease', status: 'included', contentHash: execution.contextPacket.contentHash, tokens: execution.contextPacket.tokenCount }],
  })
  const baseManifest = await createContextManifestV2FromV1({ manifest: v1, scope })
  const preflight = await recordContextGatewayPreflightEvidenceV1({
    scope, runId: run.run.id, stepId: 'read', attempt: 1, contextPacket: execution.contextPacket,
    selector: execution.selector, renderedRequest: { purpose: 'conditional-read' },
    sourceSnapshots: execution.sourceSnapshots, toolTranscript: execution.toolTranscript, expectedLastSequence: run.projection.lastSequence,
  })
  run = preflight.snapshot
  const toolName = 'conditional-read-fixture'
  await append('tool.called', { stepId: 'read', attempt: 1, toolName, callHash: preflight.evidence.promptHash })
  const rawResponse = { packetHash: execution.contextPacket.packetHash }
  const candidateHash = await hashCanonicalValue(rawResponse)
  await append('tool.returned', { stepId: 'read', attempt: 1, toolName, resultHash: candidateHash })
  const { manifest } = await finalizeContextGatewayAttemptEvidenceV1({
    scope, runId: run.run.id, stepId: 'read', attempt: 1, baseManifest, preflight: preflight.evidence,
    selector: execution.selector, sufficiency: execution.sufficiency, retrievalTrace: execution.retrievalTrace,
    gatewayVersionHash: execution.contextPacket.gatewayVersionHash, policyHash: execution.session.policyHash,
    rawResponse, candidateHash, executionBoundary: { kind: 'tool', toolName }, expectedLastSequence: run.projection.lastSequence,
  })
  return { runId: run.run.id, stepId: 'read', attempt: 1, manifestHash: manifest.manifestHash }
}

async function withHistoricalStoryStatus(plan: ProductSourcePlanV1, status: 'missing' | 'insufficient' | 'conflict') {
  if (status === 'missing') return plan
  // The official adapter's minimum is one and its catalog resolver cannot produce conflict.
  // Exercise compatible V1 wire statuses over the same frozen owner, policy and rule.
  const historical = structuredClone(plan)
  storyRequirement(historical).status = status
  const { planHash: _hash, ...body } = historical
  const { localReleaseRecordId: _locator, ...portableReference } = body.worldReference
  return { ...body, planHash: await hashCanonicalValue({ ...body, worldReference: portableReference }) }
}


async function requireSourceFailure(action: () => Promise<unknown>, code: string) {
  try { await action() } catch (cause) {
    const error = cause as { code?: string; message?: string }
    if (error.code !== code || !error.message?.includes('已激活条件')) throw cause
    return { code: error.code, message: error.message }
  }
  throw new Error(`SFQA018 expected ${code} before new execution/publication`)
}

/** Exercise the public source gate and real Gateway evidence in native IndexedDB.
 * Every tool read is deterministic; there is no provider transport or model. */
export async function exerciseSfqa018NativeV1() {
  if (await db.projects.count()) throw new Error('SFQA018 requires a fresh disposable browser database')
  const { scope, release } = await sourceWorld()
  const failures = []
  for (const status of ['missing', 'insufficient', 'conflict'] as const) {
    const plan = await withHistoricalStoryStatus(await planFor(release.id!, true), status)
    if (plan.readiness === 'blocked') throw new Error('Fixture must isolate a conditional gap from stable-required readiness')
    const bytes = JSON.stringify(await portableProductSourcePlanV1(plan))
    const pointer = await persistRead(scope, plan)
    const beforeRuns = await db.agentRuns.count(), beforeBuilds = await db.productBuilds.count()
    const startError = await requireSourceFailure(() => start(plan), 'source-plan-blocked')
    const publishError = await requireSourceFailure(() => aggregateProductSourceManifestFromExactRunsV1({
      scope, sourcePlan: plan, runContextManifests: [pointer],
    }), 'required-source-evidence')
    if (beforeRuns !== await db.agentRuns.count() || beforeBuilds !== await db.productBuilds.count()
      || bytes !== JSON.stringify(await portableProductSourcePlanV1(plan))) throw new Error('Rejected gate mutated its plan or created production state')
    failures.push({ status, startError, publishError })
  }
  const controls = []
  for (const [active, strategy] of [[false, 'block'], [true, 'degrade-explicitly']] as const) {
    const plan = await planFor(release.id!, active, strategy)
    const bytes = JSON.stringify(await portableProductSourcePlanV1(plan))
    const pointer = await persistRead(scope, plan)
    await start(plan)
    const manifest = await aggregateProductSourceManifestFromExactRunsV1({ scope, sourcePlan: plan, runContextManifests: [pointer] })
    await validateProductSourceManifestV1({ sourcePlan: plan, sourceManifest: manifest })
    if (bytes !== JSON.stringify(await portableProductSourcePlanV1(plan))) throw new Error('Compatible V1 control rewrote its plan')
    controls.push({ active, strategy, outcome: manifest.requirementOutcomes.find(row => row.requirementKey === 'story-continuity')?.status })
  }
  const owned = await seedCurrentProductWorld('018 native matched story world')
  const matched = await planFor(owned.release.id!, true)
  const story = storyRequirement(matched)
  if (story.status !== 'matched') throw new Error('Native matched-story fixture is incomplete')
  await start(matched)
  const withoutStory = await persistRead(owned.scope, matched)
  await requireSourceFailure(() => aggregateProductSourceManifestFromExactRunsV1({ scope: owned.scope,
    sourcePlan: matched, runContextManifests: [withoutStory] }), 'required-source-evidence')
  const withStory = await persistRead(owned.scope, matched, story.matchedResourceKeys.slice(0, 1))
  const complete = await aggregateProductSourceManifestFromExactRunsV1({ scope: owned.scope,
    sourcePlan: matched, runContextManifests: [withStory] })
  const outcome = complete.requirementOutcomes.find(row => row.requirementKey === story.key)
  if (outcome?.status !== 'matched' || JSON.stringify(outcome.evidenceResourceKeys) !== JSON.stringify(story.matchedResourceKeys.slice(0, 1))) {
    throw new Error('Native publication did not use the exact actually read story resource')
  }
  const blockedPlan = await planFor(release.id!, true)
  const compatible = await planFor(release.id!, true, 'degrade-explicitly')
  const oldRead = await persistRead(scope, compatible)
  const legacy = await aggregateProductSourceManifestFromExactRunsV1({ scope, sourcePlan: compatible,
    runContextManifests: [oldRead], createdAt: 20 })
  const { manifestHash: _hash, ...oldBody } = legacy
  const body = { ...oldBody, sourcePlanHash: blockedPlan.planHash }
  const frozen = { ...body, manifestHash: await hashCanonicalValue(body) }
  const planBytes = JSON.stringify(await portableProductSourcePlanV1(blockedPlan)), manifestBytes = JSON.stringify(frozen)
  const reread = await validateProductSourceManifestV1({ sourcePlan: JSON.parse(planBytes), sourceManifest: JSON.parse(manifestBytes) })
  const legacyUnchanged = JSON.stringify(reread) === manifestBytes
    && JSON.stringify(await portableProductSourcePlanV1(JSON.parse(planBytes))) === planBytes
  if (!legacyUnchanged) throw new Error('Historical V1 wire/hash changed during read')
  return { failures, controls, matched: outcome, legacyUnchanged, builds: await db.productBuilds.count(),
    modelRequestedEvents: (await db.agentRunEvents.toArray()).filter(row => row.type === 'model.requested').length }
}
