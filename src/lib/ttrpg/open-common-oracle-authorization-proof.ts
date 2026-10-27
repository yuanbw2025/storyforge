/** Actual local Run + original human source decision. Imported proof is retained as history, never executable. */
import type { WorkspaceScope } from '../types'
import { db } from '../db/schema'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { assertAgentSkillExecutionBindingIntegrityV2, projectFrozenAgentSkillDefinitionV1 } from '../agent/execution-binding'
import { assertFormalAIEntrySnapshotIntegrityV1 } from '../agent/formal-ai-entry'
import { hashCanonicalValue, canonicalStringify as stable } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { ttrpgOpenScopedKeyV1, assertTtrpgOpenCommonOracleEpochAuthorityV1, assertTtrpgOpenCommonOracleEpochOriginV1 } from './open-coordination'
import { loadTtrpgOpenCommonOracleContextV1, TTRPG_OPEN_COMMON_ORACLE_SOURCE_V1 } from './open-common-oracle-context'
import { parseTtrpgOpenCommonOracleAuthorizationV1, hashTtrpgOpenCommonOracleRequestBasisV1, assertTtrpgOpenCommonOracleRequestSourceV1,
  ttrpgOpenCommonOracleAuthorizationInputV1, ttrpgOpenCommonOracleInputRevisionV1, ttrpgOpenCommonOracleObjectiveV1,
  TTRPG_OPEN_COMMON_ORACLE_SKILL_V1, TTRPG_OPEN_COMMON_ORACLE_STEP_V1, TTRPG_OPEN_COMMON_ORACLE_ENTRY_V1, ttrpgOpenCommonOracleCallMarkerV1 } from './open-common-oracle-request'
import { ttrpgOpenCallBindingHashV1 } from './open-model-call-evidence'
import { readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { ttrpgOpenCommonOracleAuthorizationCheckpointV1 } from './open-common-oracle-request'

export async function ttrpgOpenCommonOracleCommandIdentityV1(sessionKey: string, epochKey: string) {
  const reservationCommandId = await ttrpgOpenScopedKeyV1(sessionKey, 'common-oracle', [epochKey, 'prepare'])
  return { reservationCommandId, requestKey: await ttrpgOpenScopedKeyV1(sessionKey, 'request', [epochKey, reservationCommandId]) }
}
export async function verifyTtrpgOpenCommonOracleAuthorizationV1(input: {
  scope: WorkspaceScope; sessionId: number; viewerKey: string; authorization: unknown; phase: 'authorize' | 'prepare' | 'dispatch' | 'review'
}) {
  const grant = parseTtrpgOpenCommonOracleAuthorizationV1(input.authorization), basis = grant.basis
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'party' } })
  const { session, state, stateHash, runtime, authorization, source } = loaded
  const seat = assertTtrpgOpenHumanHostV1(authorization, input.viewerKey)
  if (basis.sessionKey !== runtime.sessionKey || basis.runtimeSourceHash !== source.runtimeSourceHash || basis.rulePackContentHash !== runtime.product.rulePackContentHash
    || basis.requester.viewerKey !== input.viewerKey || basis.requester.seatKey !== seat.seatKey || basis.requester.seatRevision !== seat.revision
    || basis.authorizationRevision !== authorization.revision || stable(basis.recipientActorKeys) !== stable([...authorization.selectedActorKeys].sort())
    || runtime.product.safety.status !== 'active' || runtime.openRun!.stage.status !== 'open' || grant.worldTurn !== runtime.openRun!.worldTime.worldTurn
    || await hashTtrpgOpenCommonOracleRequestBasisV1(basis) !== grant.basisHash) throw new Error('共同事实的本人、席位、原来源、范围或安全授权已经失效')
  const inputRevision = await ttrpgOpenCommonOracleInputRevisionV1({ basisHash: grant.basisHash, authorizationHash: await hashCanonicalValue(authorization), viewerKey: input.viewerKey, authorizationCommandId: grant.authorizationCommandId })
  const epochKey = await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'epoch', [String(basis.readEvidence.sequence + 1), inputRevision])
  const identity = await ttrpgOpenCommonOracleCommandIdentityV1(runtime.sessionKey, epochKey)
  if (grant.epochKey !== epochKey || grant.requestKey !== identity.requestKey || grant.reservationCommandId !== identity.reservationCommandId) throw new Error('共同事实的原窗口或单次请求身份不一致')
  if (input.phase === 'authorize') {
    assertTtrpgOpenCommonOracleEpochAuthorityV1(runtime, input.viewerKey)
    if (runtime.openRun!.coordination.activeEpochKey || state.lastSequence !== basis.readEvidence.sequence || stateHash !== basis.readEvidence.stateHash) throw new Error('共同事实提交前原切点已变化')
  } else {
    const epoch = runtime.openRun!.coordination.epochs.find(row => row.epochKey === epochKey)
    if (!epoch || epoch.status !== 'active' || runtime.openRun!.coordination.activeEpochKey !== epochKey || stable(epoch.commonOracle) !== stable(grant)
      || epoch.authorizationHash !== await hashCanonicalValue(authorization)) throw new Error('共同事实的原准确窗口已关闭或失效')
    assertTtrpgOpenCommonOracleEpochOriginV1(runtime, epoch)
  }
  const context = await loadTtrpgOpenCommonOracleContextV1({ ...input, actorKey: 'gm' })
  await assertTtrpgOpenCommonOracleRequestSourceV1(basis, context)
  if (context.admissionStateHash !== grant.admissionStateHash) throw new Error('共同事实的原实际状态已变化')
  const snapshot = await readInstanceAgentRunV1(input.scope, grant.run.runId), run = snapshot.run, contract = snapshot.contract
  const bound = contract.scope.runtime, binding = contract.executionBindings?.find(row => row.stepId === TTRPG_OPEN_COMMON_ORACLE_STEP_V1)
  if (run.portableRuntimeOriginJson !== undefined || run.productRuntimeSessionId !== input.sessionId || run.projectId !== input.scope.projectId
    || run.contractHash !== grant.run.contractHash || run.contractJson !== grant.run.contractJson
    || contract.objective !== ttrpgOpenCommonOracleObjectiveV1(grant.basisHash, grant.authorizationCommandId)
    || contract.version !== 3 || contract.executionBoundary !== 'product-runtime' || contract.permissions.writeTargets.length
    || stable(contract.permissions.contextSourceKeys) !== stable([TTRPG_OPEN_COMMON_ORACLE_SOURCE_V1])
    || !bound || bound.productRuntimeSessionId !== input.sessionId || bound.baseSequence !== basis.readEvidence.sequence || bound.stateHash !== basis.readEvidence.stateHash
    || bound.releaseHash !== session.runtimeSourceHash || bound.visibilityHash !== basis.sourceVisibilityHash
    || contract.executionBindings?.length !== 1 || binding?.version !== 2 || binding.skillId !== TTRPG_OPEN_COMMON_ORACLE_SKILL_V1
    || projectFrozenAgentSkillDefinitionV1(binding).promptVersion !== 'ttrpg-open-common-oracle-interpret-v1'
    || binding.formalEntry?.entryId !== TTRPG_OPEN_COMMON_ORACLE_ENTRY_V1 || binding.writeTargets.length
    || stable(binding.contextSourceKeys) !== stable([TTRPG_OPEN_COMMON_ORACLE_SOURCE_V1])
    || contract.budget.maxModelCalls !== 1 || contract.budget.maxToolCalls !== 0 || contract.budget.maxAttemptsPerStep !== 1
    || contract.budget.maxInputTokens !== basis.budget.maximumInputTokens || contract.budget.maxOutputTokens !== binding.maxOutputTokens
    || basis.budget.maximumOutputTokens > binding.maxOutputTokens
    || contract.runtimeBindingHash !== await ttrpgOpenCallBindingHashV1({ sessionKey: runtime.sessionKey, actorKey: 'gm', authorizationEpochKey: epochKey,
      admissionStateHash: grant.admissionStateHash, visibilityHash: basis.sourceVisibilityHash, runtimeSourceHash: basis.runtimeSourceHash, commonOracle: ttrpgOpenCommonOracleCallMarkerV1(grant) })
    || snapshot.projection.steps[TTRPG_OPEN_COMMON_ORACLE_STEP_V1]?.status !== (input.phase === 'review' ? 'awaiting_confirmation' : 'running')
    || snapshot.projection.steps[TTRPG_OPEN_COMMON_ORACLE_STEP_V1]?.attempt !== 1 || ['completed', 'failed', 'cancelled'].includes(snapshot.projection.state)
    || input.phase === 'authorize' && snapshot.events.some(event => event.type === 'model.requested')) throw new Error('共同事实必须保留原本地 Run；导入、缺失、终态或换约记录不能执行')
  await assertAgentSkillExecutionBindingIntegrityV2(binding)
  const entry = await assertFormalAIEntrySnapshotIntegrityV1(binding.formalEntry!, new Map([[binding.skillId, projectFrozenAgentSkillDefinitionV1(binding)]]))
  if (entry.entryId !== TTRPG_OPEN_COMMON_ORACLE_ENTRY_V1 || entry.adoptAllowed || entry.executionBoundary !== 'product-runtime') throw new Error('共同事实的原入口不能代替真人确认')
  const checkpointJson = stable(ttrpgOpenCommonOracleAuthorizationCheckpointV1(grant))
  let checkpoint: Awaited<ReturnType<typeof readLatestVerifiedAgentRunCheckpointV1>>
  try { checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, run.id, { owner: 'instance' }) }
  catch { throw new Error('共同事实原本地授权检查点已经损坏或不属于此实例') }
  const resume = checkpoint?.resumePayload as Record<string, unknown> | null | undefined
  const original = Boolean(checkpoint) && stable(resume) === checkpointJson
  const candidate = input.phase === 'review' && resume?.schema === 'storyforge.ttrpg-open-common-oracle-candidate' && resume.version === 1 && resume.portable === false
    && resume.basisHash === grant.basisHash && resume.runId === run.id && resume.requestKey === grant.requestKey && resume.epochKey === grant.epochKey
    && resume.viewerKey === input.viewerKey && resume.productRuntimeSessionId === input.sessionId && resume.actorKey === 'gm'
    && snapshot.events.some(row => row.type === 'candidate.persisted' && row.payload.stepId === TTRPG_OPEN_COMMON_ORACLE_STEP_V1 && row.payload.candidateHash === resume.candidateHash)
  if (!checkpoint || !original && !candidate) throw new Error('共同事实缺少原本地且不可跨端恢复的准确授权检查点')
  const bytes = stable(ttrpgOpenCommonOracleAuthorizationInputV1(grant))
  const artifact = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([input.scope.projectId, 'source-snapshot', grant.inputArtifactHash]).first()
  if (!artifact || artifact.retentionState !== 'available' || artifact.content !== bytes || await sha256Text(bytes) !== grant.inputArtifactHash
    || await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'source-snapshot', contentHash: grant.inputArtifactHash }) !== bytes
    || !snapshot.events.some(event => event.type === 'evidence.artifact.recorded' && event.payload.stepId === TTRPG_OPEN_COMMON_ORACLE_STEP_V1
      && event.payload.attempt === 1 && event.payload.artifactKind === 'source-snapshot' && event.payload.contentHash === grant.inputArtifactHash
      && event.payload.byteLength === artifact.byteLength)) throw new Error('共同事实缺少原本地 Run 的准确授权工件')
  const events = await db.agentRunEvents.where('runId').equals(run.id).sortBy('sequence')
  if (stable(await db.agentRuns.get(run.id)) !== stable(run) || events.length !== snapshot.events.length
    || events.some((event, index) => event.sequence !== snapshot.events[index].sequence || stable(JSON.parse(event.payloadJson)) !== stable(snapshot.events[index].payload))) throw new Error('共同事实的原 Run 读取期间已经变化')
  await loaded.assertCurrent()
  return { grant, inputRevision, snapshot, context, content: loaded.content, evidence: { run, events, artifacts: [artifact] } }
}

/** Cancellation needs the original owner and local Run, never renewed AI read permission or a replacement Run. */
export async function readTtrpgOpenEmptyCommonOracleOwnerV1(input: { scope: WorkspaceScope; sessionId: number; viewerKey: string; epochKey: string }) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  assertTtrpgOpenHumanHostV1(loaded.authorization, input.viewerKey)
  const epoch = loaded.runtime.openRun!.coordination.epochs.find(row => row.epochKey === input.epochKey), grant = epoch?.commonOracle
  if (!epoch || !grant || epoch.viewerKey !== input.viewerKey || grant.basis.requester.viewerKey !== input.viewerKey
    || epoch.startedRef.sessionKey !== loaded.runtime.sessionKey || loaded.runtime.openRun!.coordination.calls.some(call => call.authorizationEpochKey === epoch.epochKey)) throw new Error('此窗口不是本人的空共同事实授权，须处理原请求回执')
  const candidate = await db.agentRuns.get(grant.run.runId)
  // Missing/imported/foreign records cannot execute. Closing owned zero-call authority must never mutate such a record.
  if (!candidate || candidate.projectId !== input.scope.projectId || candidate.portableRuntimeOriginJson !== undefined || candidate.productRuntimeSessionId !== input.sessionId
    || candidate.contractJson !== grant.run.contractJson || candidate.contractHash !== grant.run.contractHash) {
    await loaded.assertCurrent()
    return { local: false as const, loaded, epoch, grant, evidence: undefined }
  }
  const snapshot = await readInstanceAgentRunV1(input.scope, grant.run.runId), run = snapshot.run
  if (snapshot.events.some(row => row.type === 'run.cancelled' && row.payload.reason === 'project-import-nonportable-checkpoint')) {
    await loaded.assertCurrent()
    return { local: false as const, loaded, epoch, grant, evidence: undefined }
  }
  const events = await db.agentRunEvents.where('runId').equals(run.id).sortBy('sequence')
  if (stable(await db.agentRuns.get(run.id)) !== stable(run) || events.length !== snapshot.events.length) throw new Error('原空窗口 Run 读取期间已经变化')
  await loaded.assertCurrent()
  return { local: true as const, loaded, epoch, grant, snapshot, evidence: { run, events, artifacts: [] } }
}
