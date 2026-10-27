/** Explicit human request → one original local Run → domain authorization. No model transport. */
import type { WorkspaceScope } from '../types'
import { db } from '../db/schema'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { createAgentRunV1, appendAgentRunEventV1, readInstanceAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { createAgentSkillExecutionBindingV2 } from '../agent/execution-binding'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { freezeFormalAIEntryBindingV1 } from '../agent/formal-ai-entry'
import { recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { readProductRuntimeState } from '../product/runtime-core'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { loadTtrpgOpenPublicSituationContextV1, TTRPG_OPEN_PUBLIC_SITUATION_SOURCE_V1 } from './open-public-situation-context'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { assertTtrpgOpenAuthorizationCurrentV1, assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { assertInstanceBinding } from '../product/runtime-instances'
import { assertTtrpgOpenSituationEpochAuthorityV1, ttrpgOpenScopedKeyV1, ttrpgOpenEpochBudgetForTriggerV1 } from './open-coordination'
import { ttrpgOpenPublicSituationInputRevisionV1, ttrpgOpenPublicSituationCommandIdentityV1 } from './open-public-situation-authorization-proof'
import { parseTtrpgOpenPublicSituationRequestBasisV1, hashTtrpgOpenPublicSituationRequestBasisV1, TTRPG_OPEN_PUBLIC_SITUATION_REQUEST_POLICY_V1 } from './open-public-situation-request'
import { parseTtrpgOpenPublicSituationAuthorizationV1, ttrpgOpenPublicSituationAuthorizationInputV1,
  TTRPG_OPEN_PUBLIC_SITUATION_SKILL_V1, TTRPG_OPEN_PUBLIC_SITUATION_STEP_V1, TTRPG_OPEN_PUBLIC_SITUATION_ENTRY_V1,
  TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1, ttrpgOpenPublicSituationObjectiveV1, readTtrpgOpenPublicSituationObjectiveV1 } from './open-public-situation-authorization-contract'
import { authorizeTtrpgOpenPublicSituationV1, type FormalTtrpgCommandEnvelope } from './runtime-commands'
import { ttrpgOpenCallBindingHashV1 } from './open-model-call-evidence'
import * as p from './open-contract-parse'

export interface TtrpgOpenPublicSituationAuthorizationInputV1 extends FormalTtrpgCommandEnvelope {
  scope: WorkspaceScope; viewerKey: string; rawInput: string;
  sharingDecision: 'share-this-request-with-current-party'; delegationDecision: 'draft-only' | 'adopt-this-one-candidate';
  modelIdentity: { provider: string; model: string }; maximumOutputTokens: number; maximumCostUsd: number;
  includeRuntimeEntities?: boolean;
}
export async function createTtrpgOpenPublicSituationAuthorizationV1(input: TtrpgOpenPublicSituationAuthorizationInputV1) {
  input = { ...input, scope: { ...input.scope } }
  if (input.includeRuntimeEntities !== undefined && typeof input.includeRuntimeEntities !== 'boolean') p.fail('请明确选择是否使用本局共同可知的已创建实例')
  const policy = TTRPG_OPEN_PUBLIC_SITUATION_REQUEST_POLICY_V1
  p.literal(input.sharingDecision, policy.sharingDecision, '明确共享本次输入')
  const delegationDecision = p.oneOf(input.delegationDecision, policy.delegationDecisions, '本次采用选择')
  if (typeof input.rawInput !== 'string' || !input.rawInput.trim() || input.rawInput.length > 20_000) p.fail('本次共享输入为空或过长')
  const rawInput = input.rawInput, viewerKey = p.key(input.viewerKey, 'public requester'), authorizationCommandId = p.key(input.commandId, 'public authorization command')
  const model = p.record(input.modelIdentity, ['provider', 'model'], 'public model identity')
  if (typeof model.provider !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(model.provider)) p.fail('public model provider: 无效身份')
  const modelIdentity = { provider: model.provider, model: p.text(model.model, 'public model', 200) }
  const maximumOutputTokens = p.integer(input.maximumOutputTokens, 'public output limit', 1), maximumCostUsd = p.number(input.maximumCostUsd, 'public cost limit', 0, 1000)
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, authorizationCommandId]).first()
  if (prior) {
    await assertInstanceBinding(input.sessionId, input.scope)
    const current = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
    if (!current?.authorization) throw new Error('[ttrpg-public-situation] 当前本人席位未获授权')
    assertTtrpgOpenAuthorizationCurrentV1({ authorization: current.authorization,
      participants: await readTtrpgSessionParticipantsV2(input.sessionId), viewerKey })
    assertTtrpgOpenHumanHostV1(current.authorization, viewerKey)
    const epoch = JSON.parse(prior.payloadJson).epoch, grant = parseTtrpgOpenPublicSituationAuthorizationV1(epoch?.publicSituation)
    const b = grant.basis, owner = await db.agentRuns.get(grant.run.runId)
    if (prior.type !== 'ttrpg.open.epoch.started' || prior.baseSequence !== input.baseSequence || prior.baseStateHash !== input.baseStateHash
      || b.scope.projectId !== input.scope.projectId || b.scope.worldId !== input.scope.worldId || b.scope.workId !== input.scope.workId
      || b.scope.sessionId !== input.sessionId || b.requester.viewerKey !== viewerKey || b.sharedRequest.text !== rawInput
      || b.sharedRequest.decision !== input.sharingDecision || b.delegation.decision !== delegationDecision
      || Boolean(b.runtimeEntityReferencePolicy) !== Boolean(input.includeRuntimeEntities)
      || current.authorization.revision !== b.authorizationRevision
      || canonicalStringify(grant.modelIdentity) !== canonicalStringify(modelIdentity) || grant.budget.maximumOutputTokens !== maximumOutputTokens
      || grant.budget.maximumCostUsd !== maximumCostUsd || !owner || owner.portableRuntimeOriginJson !== undefined || owner.contractHash !== grant.run.contractHash) {
      throw new Error('[ttrpg-public-situation] 原命令已绑定其他请求，或导入记录不具有活授权')
    }
    return { runId: grant.run.runId, requestKey: b.requestKey, epochKey: b.authorizationEpochKey, grant, event: prior }
  }
  const context = await loadTtrpgOpenPublicSituationContextV1({ ...input, actorKey: 'gm' }, input.includeRuntimeEntities ? 'current-common-entities' : undefined)
  if (context.readEvidence.sequence !== input.baseSequence || context.readEvidence.stateHash !== input.baseStateHash) throw new Error('[ttrpg-public-situation] 本次请求入口已变化')
  const state = await readProductRuntimeState(input.sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.authorization || !runtime.openRun || runtime.openRun.coordination.activeEpochKey !== null) throw new Error('[ttrpg-public-situation] 需要独立空闲窗口')
  assertTtrpgOpenSituationEpochAuthorityV1(runtime, viewerKey)
  const seat = assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization,
    participants: await readTtrpgSessionParticipantsV2(input.sessionId), viewerKey })
  const skill = getAgentSkillV1(TTRPG_OPEN_PUBLIC_SITUATION_SKILL_V1)
  const epochBudget = ttrpgOpenEpochBudgetForTriggerV1(runtime.epochBudget, TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1)
  // Freeze this new one-call grant within the author's existing epoch total.
  // The old 16k ceiling could reject complete JSON requests despite capacity.
  // Replayed grants return above with their exact original limits unchanged.
  const maximumInputTokens = epochBudget.maximumTokens - maximumOutputTokens - 2000
  if (epochBudget.maximumCalls !== 1 || maximumInputTokens < 1 || maximumOutputTokens > skill.maxOutputTokens
    || maximumCostUsd > epochBudget.maximumCostUsd) throw new Error('[ttrpg-public-situation] 本次请求没有明确且足够的一次调用预算')
  const budget = { maximumInputTokens, maximumOutputTokens, maximumCostUsd }
  const inputRevision = await ttrpgOpenPublicSituationInputRevisionV1({ sessionKey: runtime.sessionKey, viewerKey,
    authorizationHash: await hashCanonicalValue(runtime.authorization), sourceVisibilityHash: context.visibilityHash,
    rawInput, sharingDecision: input.sharingDecision, delegationDecision, modelIdentity, budget, authorizationCommandId })
  const epochKey = await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'epoch', [String(input.baseSequence + 1), inputRevision])
  const { requestKey, reservationCommandId } = await ttrpgOpenPublicSituationCommandIdentityV1(runtime.sessionKey, epochKey)
  const basis = parseTtrpgOpenPublicSituationRequestBasisV1({ schema: 'storyforge.ttrpg-open-public-situation-request-basis', version: 1,
    purpose: policy.purpose, scope: { projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId, sessionId: input.sessionId },
    sessionKey: runtime.sessionKey, runtimeSourceHash: context.readEvidence.runtimeSourceHash, authorizationRevision: runtime.authorization.revision,
    requester: { viewerKey, seatKey: seat.seatKey, seatRevision: seat.revision }, authorizationEpochKey: epochKey, requestKey,
    readEvidence: { sequence: input.baseSequence, stateHash: input.baseStateHash }, recipientActorKeys: context.frame.recipientActorKeys,
    sourceVisibilityHash: context.visibilityHash, sharedRequest: { text: rawInput, inputHash: await sha256Text(rawInput), decision: input.sharingDecision },
    delegation: { decision: delegationDecision, maximumCandidates: 1, maximumCalls: 1, maximumAiActions: 0 },
    ...(context.runtimeEntityReferencePolicy ? { runtimeEntityReferencePolicy: context.runtimeEntityReferencePolicy } : {}) })
  const basisHash = await hashTtrpgOpenPublicSituationRequestBasisV1(basis)
  const request = { basis, basisHash, admissionStateHash: context.admissionStateHash, modelIdentity, budget, authorizationCommandId, reservationCommandId }
  const content = canonicalStringify(ttrpgOpenPublicSituationAuthorizationInputV1(request)), inputArtifactHash = await sha256Text(content)
  const objective = ttrpgOpenPublicSituationObjectiveV1(basisHash, authorizationCommandId)
  const original = (await db.agentRuns.where('productRuntimeSessionId').equals(input.sessionId).toArray())
    .filter(row => readTtrpgOpenPublicSituationObjectiveV1(JSON.parse(row.contractJson).objective)?.authorizationCommandId === authorizationCommandId)
  if (original.some(row => row.portableRuntimeOriginJson !== undefined || JSON.parse(row.contractJson).objective !== objective)) {
    throw new Error('[ttrpg-public-situation] 原准备属于导入历史或已变化输入，须用新的操作明确发起本次请求')
  }
  if (original.length > 1) throw new Error('[ttrpg-public-situation] 原请求存在多个本地 Run，不能任意选择或重建')
  let snapshot: AgentRunSnapshotV1 = original.length ? await readInstanceAgentRunV1(input.scope, original[0].id!) : await createAgentRunV1({
    scope: input.scope, productRuntimeSessionId: input.sessionId, worldGroupId: null,
    contract: { version: 3, executionBoundary: 'product-runtime', objective, workflowKind: 'direct-generation',
      scope: { projectId: input.scope.projectId, worldGroupId: null, runtime: { productRuntimeSessionId: input.sessionId,
        baseSequence: input.baseSequence, stateHash: input.baseStateHash, visibilityHash: context.visibilityHash, releaseHash: context.readEvidence.runtimeSourceHash } },
      permissions: { contextSourceKeys: [TTRPG_OPEN_PUBLIC_SITUATION_SOURCE_V1], writeTargets: [] },
      runtimeBindingHash: await ttrpgOpenCallBindingHashV1({ sessionKey: runtime.sessionKey, actorKey: 'gm', authorizationEpochKey: epochKey,
        admissionStateHash: context.admissionStateHash, visibilityHash: context.visibilityHash, runtimeSourceHash: context.readEvidence.runtimeSourceHash }),
      executionBindings: [{ stepId: TTRPG_OPEN_PUBLIC_SITUATION_STEP_V1, ...await createAgentSkillExecutionBindingV2(skill),
        formalEntry: await freezeFormalAIEntryBindingV1(TTRPG_OPEN_PUBLIC_SITUATION_ENTRY_V1) }],
      budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: maximumInputTokens, maxOutputTokens: skill.maxOutputTokens, maxAttemptsPerStep: 1 },
      acceptance: [{ id: 'public-situation.protocol', kind: 'deterministic-check', required: true }],
      verificationPlan: [{ id: 'public-situation.terminal', kind: 'terminal', verifier: skill.promptVersion, criterionIds: ['public-situation.protocol'] }],
      failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' } } })
  try {
    if (['completed', 'failed', 'cancelled'].includes(snapshot.projection.state)) throw new Error('[ttrpg-public-situation] 原准备已经结束，不能在同一授权下重建请求')
    const append = async (type: 'step.scheduled' | 'step.started', payload: unknown) => {
      snapshot = await appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: snapshot.run.id,
        type, payload, expectedLastSequence: snapshot.projection.lastSequence } as Parameters<typeof appendAgentRunEventV1>[0])
    }
    if (!snapshot.projection.steps[TTRPG_OPEN_PUBLIC_SITUATION_STEP_V1]) await append('step.scheduled', { stepId: TTRPG_OPEN_PUBLIC_SITUATION_STEP_V1 })
    if (snapshot.projection.steps[TTRPG_OPEN_PUBLIC_SITUATION_STEP_V1]?.status === 'scheduled') await append('step.started', { stepId: TTRPG_OPEN_PUBLIC_SITUATION_STEP_V1, attempt: 1 })
    if (!snapshot.events.some(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'source-snapshot' && event.payload.contentHash === inputArtifactHash)) {
      snapshot = (await recordAgentRunArtifactV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: snapshot.run.id,
        stepId: TTRPG_OPEN_PUBLIC_SITUATION_STEP_V1, attempt: 1, artifactKind: 'source-snapshot', content, expectedLastSequence: snapshot.projection.lastSequence })).snapshot
    }
    const grant = parseTtrpgOpenPublicSituationAuthorizationV1({ schema: 'storyforge.ttrpg-open-public-situation-authorization', version: 1,
      ...request, inputArtifactHash, run: { runId: snapshot.run.id, contractHash: snapshot.run.contractHash, contractJson: snapshot.run.contractJson } })
    const event = await authorizeTtrpgOpenPublicSituationV1({ ...input, viewerKey, authorization: grant })
    return { runId: snapshot.run.id, requestKey, epochKey, grant, event }
  } catch (error) {
    const committed = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, authorizationCommandId]).first()
    const owner = committed ? JSON.parse(committed.payloadJson).epoch?.publicSituation?.run : null
    // A committed grant wins an interrupted return. Never destroy that original local Run.
    if (owner?.runId !== snapshot.run.id || owner?.contractHash !== snapshot.run.contractHash) {
      const latest = await readInstanceAgentRunV1(input.scope, snapshot.run.id)
      if (!['completed', 'failed', 'cancelled'].includes(latest.projection.state)) await appendAgentRunEventV1({ scope: input.scope,
        productRuntimeSessionId: input.sessionId, runId: snapshot.run.id, type: 'run.failed',
        payload: { code: 'ttrpg-public-situation-authorization-incomplete', retryable: false }, expectedLastSequence: latest.projection.lastSequence })
    }
    throw error
  }
}
