/** Checks the original local Run, exact human input artifact and current authority before a domain command. */
import type { WorkspaceScope } from '../types'
import { db } from '../db/schema'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { assertAgentSkillExecutionBindingIntegrityV2, projectFrozenAgentSkillDefinitionV1 } from '../agent/execution-binding'
import { assertFormalAIEntrySnapshotIntegrityV1 } from '../agent/formal-ai-entry'
import { assertInstanceBinding } from '../product/runtime-instances'
import { readProductRuntimeState, hashProductRuntimeStateV1 } from '../product/runtime-core'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { assertTtrpgOpenAuthorizationCurrentV1, assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { ttrpgOpenScopedKeyV1 } from './open-coordination'
import { hashTtrpgOpenPublicSituationRequestBasisV1 } from './open-public-situation-request'
import { parseTtrpgOpenPublicSituationAuthorizationV1, ttrpgOpenPublicSituationAuthorizationInputV1,
  TTRPG_OPEN_PUBLIC_SITUATION_SKILL_V1, TTRPG_OPEN_PUBLIC_SITUATION_STEP_V1, TTRPG_OPEN_PUBLIC_SITUATION_ENTRY_V1,
  TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1, ttrpgOpenPublicSituationObjectiveV1, type TtrpgOpenPublicSituationAuthorizationV1 } from './open-public-situation-authorization-contract'
import { ttrpgOpenCallBindingHashV1, type TtrpgOpenAgentEvidenceV1 } from './open-model-call-evidence'
import { TTRPG_OPEN_PUBLIC_SITUATION_SOURCE_V1, loadTtrpgOpenPublicSituationContextV1 } from './open-public-situation-context'

export async function ttrpgOpenPublicSituationInputRevisionV1(input: {
  sessionKey: string; viewerKey: string; authorizationHash: string; sourceVisibilityHash: string; rawInput: string;
  sharingDecision: string; delegationDecision: string; modelIdentity: TtrpgOpenPublicSituationAuthorizationV1['modelIdentity'];
  budget: TtrpgOpenPublicSituationAuthorizationV1['budget']; authorizationCommandId: string;
}) {
  return hashCanonicalValue({ schema: 'storyforge.ttrpg-open-public-situation-input-revision', version: 1,
    triggerKind: TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1, ...input })
}
export async function ttrpgOpenPublicSituationCommandIdentityV1(sessionKey: string, epochKey: string) {
  const reservationCommandId = await ttrpgOpenScopedKeyV1(sessionKey, 'public-situation', [epochKey, 'prepare'])
  return { reservationCommandId, requestKey: await ttrpgOpenScopedKeyV1(sessionKey, 'request', [epochKey, reservationCommandId]) }
}

export async function verifyTtrpgOpenPublicSituationAuthorizationV1(input: {
  scope: WorkspaceScope; sessionId: number; viewerKey: string; authorization: unknown; phase: 'authorize' | 'prepare' | 'dispatch' | 'adopt'
}): Promise<{ grant: TtrpgOpenPublicSituationAuthorizationV1; evidence: TtrpgOpenAgentEvidenceV1; inputRevision: string }> {
  const grant = parseTtrpgOpenPublicSituationAuthorizationV1(input.authorization), b = grant.basis
  const session = await assertInstanceBinding(input.sessionId, input.scope)
  const state = await readProductRuntimeState(input.sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (session.kind !== 'ttrpg' || b.scope.projectId !== input.scope.projectId || b.scope.worldId !== input.scope.worldId
    || b.scope.workId !== input.scope.workId || b.scope.sessionId !== input.sessionId || b.sessionKey !== runtime?.sessionKey
    || b.runtimeSourceHash !== session.runtimeSourceHash || b.requester.viewerKey !== input.viewerKey
    || !runtime?.authorization || !runtime.openRun) throw new Error('[ttrpg-public-situation] 本次授权不属于当前实例、来源或本人')
  const seat = assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization,
    participants: await readTtrpgSessionParticipantsV2(input.sessionId), viewerKey: input.viewerKey })
  assertTtrpgOpenHumanHostV1(runtime.authorization, input.viewerKey)
  if (seat.seatKey !== b.requester.seatKey || seat.revision !== b.requester.seatRevision
    || runtime.authorization.revision !== b.authorizationRevision || runtime.product.safety.status !== 'active'
    || runtime.openRun.stage.status !== 'open' || canonicalStringify([...runtime.authorization.selectedActorKeys].sort()) !== canonicalStringify(b.recipientActorKeys)) {
    throw new Error('[ttrpg-public-situation] 本次席位、接收者或安全授权已变化')
  }
  if (await hashTtrpgOpenPublicSituationRequestBasisV1(b) !== grant.basisHash) throw new Error('[ttrpg-public-situation] 本次共享输入的原字节证明不一致')
  const inputRevision = await ttrpgOpenPublicSituationInputRevisionV1({ sessionKey: b.sessionKey, viewerKey: b.requester.viewerKey,
    authorizationHash: await hashCanonicalValue(runtime.authorization), sourceVisibilityHash: b.sourceVisibilityHash,
    rawInput: b.sharedRequest.text, sharingDecision: b.sharedRequest.decision, delegationDecision: b.delegation.decision,
    modelIdentity: grant.modelIdentity, budget: grant.budget, authorizationCommandId: grant.authorizationCommandId })
  const epochKey = await ttrpgOpenScopedKeyV1(b.sessionKey, 'epoch', [String(b.readEvidence.sequence + 1), inputRevision])
  const identity = await ttrpgOpenPublicSituationCommandIdentityV1(b.sessionKey, epochKey)
  if (epochKey !== b.authorizationEpochKey || identity.requestKey !== b.requestKey || identity.reservationCommandId !== grant.reservationCommandId) {
    throw new Error('[ttrpg-public-situation] 原授权窗口或一次请求身份不一致')
  }
  const epoch = runtime.openRun.coordination.epochs.find(e => e.epochKey === b.authorizationEpochKey)
  if (input.phase === 'authorize') {
    if (runtime.openRun.coordination.activeEpochKey !== null || state.lastSequence !== b.readEvidence.sequence
      || await hashProductRuntimeStateV1(state) !== b.readEvidence.stateHash) throw new Error('[ttrpg-public-situation] 本次授权提交前进度已变化')
  } else if (!epoch || epoch.triggerKind !== TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1 || epoch.status !== 'active'
    || runtime.openRun.coordination.activeEpochKey !== epoch.epochKey || canonicalStringify(epoch.publicSituation) !== canonicalStringify(grant)) {
    throw new Error('[ttrpg-public-situation] 原共同局势窗口已结束或不属于此请求')
  }
  const common = await loadTtrpgOpenPublicSituationContextV1({ ...input, actorKey: 'gm' }, b.runtimeEntityReferencePolicy)
  if (common.visibilityHash !== b.sourceVisibilityHash || common.admissionStateHash !== grant.admissionStateHash) throw new Error('[ttrpg-public-situation] 本次共同资料或实际局面已变化')
  const snapshot = await readInstanceAgentRunV1(input.scope, grant.run.runId), run = snapshot.run
  const bound = snapshot.contract.scope.runtime, binding = snapshot.contract.executionBindings?.find(row => row.stepId === TTRPG_OPEN_PUBLIC_SITUATION_STEP_V1)
  if (run.portableRuntimeOriginJson !== undefined || run.productRuntimeSessionId !== input.sessionId || run.contractHash !== grant.run.contractHash
    || run.contractJson !== grant.run.contractJson || snapshot.contract.objective !== ttrpgOpenPublicSituationObjectiveV1(grant.basisHash, grant.authorizationCommandId)
    || snapshot.contract.version !== 3 || snapshot.contract.executionBoundary !== 'product-runtime' || snapshot.contract.permissions.writeTargets.length
    || canonicalStringify(snapshot.contract.permissions.contextSourceKeys) !== canonicalStringify([TTRPG_OPEN_PUBLIC_SITUATION_SOURCE_V1])
    || !bound || bound.baseSequence !== b.readEvidence.sequence || bound.stateHash !== b.readEvidence.stateHash
    || bound.productRuntimeSessionId !== input.sessionId || bound.visibilityHash !== b.sourceVisibilityHash || bound.releaseHash !== b.runtimeSourceHash
    || snapshot.contract.executionBindings?.length !== 1 || binding?.version !== 2 || binding.skillId !== TTRPG_OPEN_PUBLIC_SITUATION_SKILL_V1
    || binding.formalEntry?.entryId !== TTRPG_OPEN_PUBLIC_SITUATION_ENTRY_V1 || binding.writeTargets.length
    || canonicalStringify(binding.contextSourceKeys) !== canonicalStringify([TTRPG_OPEN_PUBLIC_SITUATION_SOURCE_V1])
    || snapshot.contract.budget.maxModelCalls !== 1 || snapshot.contract.budget.maxToolCalls !== 0 || snapshot.contract.budget.maxAttemptsPerStep !== 1
    || snapshot.contract.budget.maxInputTokens !== grant.budget.maximumInputTokens || snapshot.contract.budget.maxOutputTokens !== binding.maxOutputTokens
    || grant.budget.maximumOutputTokens > binding.maxOutputTokens
    || snapshot.contract.runtimeBindingHash !== await ttrpgOpenCallBindingHashV1({ sessionKey: b.sessionKey, actorKey: 'gm', authorizationEpochKey: epochKey,
      admissionStateHash: grant.admissionStateHash, visibilityHash: b.sourceVisibilityHash, runtimeSourceHash: b.runtimeSourceHash })
    || snapshot.projection.steps[TTRPG_OPEN_PUBLIC_SITUATION_STEP_V1]?.status !== (input.phase === 'adopt' ? 'awaiting_confirmation' : 'running')
    || snapshot.projection.steps[TTRPG_OPEN_PUBLIC_SITUATION_STEP_V1]?.attempt !== 1
    || ['completed', 'failed', 'cancelled'].includes(snapshot.projection.state)
    || input.phase === 'authorize' && snapshot.events.some(event => event.type === 'model.requested')) {
    throw new Error('[ttrpg-public-situation] 授权必须绑定尚有效的原本地 Run，导入历史不能执行')
  }
  await assertAgentSkillExecutionBindingIntegrityV2(binding)
  const entry = await assertFormalAIEntrySnapshotIntegrityV1(binding.formalEntry!, new Map([[binding.skillId, projectFrozenAgentSkillDefinitionV1(binding)]]))
  if (entry.entryId !== TTRPG_OPEN_PUBLIC_SITUATION_ENTRY_V1 || entry.adoptAllowed || entry.executionBoundary !== 'product-runtime') throw new Error('[ttrpg-public-situation] 原公开入口不具有模型写入或采用权限')
  const content = canonicalStringify(ttrpgOpenPublicSituationAuthorizationInputV1(grant))
  const artifact = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([input.scope.projectId, 'source-snapshot', grant.inputArtifactHash]).first()
  if (await sha256Text(content) !== grant.inputArtifactHash || !artifact || artifact.retentionState !== 'available'
    || artifact.content !== content || await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'source-snapshot', contentHash: grant.inputArtifactHash }) !== content
    || !snapshot.events.some(event => event.type === 'evidence.artifact.recorded' && event.payload.stepId === TTRPG_OPEN_PUBLIC_SITUATION_STEP_V1
      && event.payload.attempt === 1 && event.payload.artifactKind === 'source-snapshot' && event.payload.contentHash === grant.inputArtifactHash
      && event.payload.byteLength === artifact.byteLength)) throw new Error('[ttrpg-public-situation] 缺少原本地 Run 的逐字共享选择工件')
  const events = await db.agentRunEvents.where('runId').equals(run.id).sortBy('sequence')
  const current = await db.agentRuns.get(run.id)
  if (canonicalStringify(current) !== canonicalStringify(run) || events.length !== snapshot.events.length
    || events.some((event, index) => event.sequence !== snapshot.events[index].sequence
      || canonicalStringify(JSON.parse(event.payloadJson)) !== canonicalStringify(snapshot.events[index].payload))) throw new Error('[ttrpg-public-situation] 原授权证据读取期间已变化')
  return { grant, inputRevision, evidence: { run, events, artifacts: [artifact] } }
}
