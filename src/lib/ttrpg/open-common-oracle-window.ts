import { createAgentRunV1, appendAgentRunEventV1, readInstanceAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { createAgentSkillExecutionBindingV2 } from '../agent/execution-binding'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { freezeFormalAIEntryBindingV1 } from '../agent/formal-ai-entry'
import { recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { hashCanonicalValue } from '../agent/run/hash'
import { ttrpgOpenCallBindingHashV1 } from './open-model-call-evidence'
import { ttrpgOpenCommonOracleCommandIdentityV1, readTtrpgOpenEmptyCommonOracleOwnerV1 } from './open-common-oracle-authorization-proof'
import { parseTtrpgOpenCommonOracleAuthorizationV1, ttrpgOpenCommonOracleAuthorizationInputV1, ttrpgOpenCommonOracleInputRevisionV1, ttrpgOpenCommonOracleObjectiveV1, readTtrpgOpenCommonOracleObjectiveV1, ttrpgOpenCommonOracleCallMarkerV1, TTRPG_OPEN_COMMON_ORACLE_SKILL_V1, TTRPG_OPEN_COMMON_ORACLE_STEP_V1, TTRPG_OPEN_COMMON_ORACLE_ENTRY_V1 } from './open-common-oracle-request'
/** One explicit current-human window. No model request, candidate or implicit fact confirmation. */
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { assertTtrpgOpenCommonOracleEpochAuthorityV1, ttrpgOpenScopedKeyV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import { loadTtrpgOpenCommonOracleContextV1, TTRPG_OPEN_COMMON_ORACLE_SOURCE_V1 } from './open-common-oracle-context'
import { createTtrpgOpenCommonOracleRequestBasisV1, hashTtrpgOpenCommonOracleRequestBasisV1,
  TTRPG_OPEN_COMMON_ORACLE_INPUT_V1, type TtrpgOpenCommonOracleRequestBasisV1 } from './open-common-oracle-request'
import { createTtrpgOpenOracleRuntimeReferencePolicyV1 } from './open-runtime-entity-references'
import { startTtrpgOpenEpochV1, closeTtrpgOpenEpochV1, type FormalTtrpgCommandEnvelope } from './runtime-commands'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { estimateTokens } from '../ai/context-budget'
import * as p from './open-contract-parse'
import { assertTtrpgOpenOracleInterpretationSlotV1 } from './open-model-calls'
import { createAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { ttrpgOpenCommonOracleAuthorizationCheckpointV1 } from './open-common-oracle-request'

export async function startTtrpgOpenCommonOracleWindowV1(input: FormalTtrpgCommandEnvelope & {
  scope: WorkspaceScope; viewerKey: string; oracleSourceRef: TtrpgOpenSourceRefV1; oracleInputHash: string; snapshotHash: string | null;
  decision: TtrpgOpenCommonOracleRequestBasisV1['decision']; modelIdentity: TtrpgOpenCommonOracleRequestBasisV1['modelIdentity'];
  maximumInputTokens: number; maximumOutputTokens: number; maximumCostUsd: number;
  basisVersion?: 1 | 2;
}) {
  const basisVersion = input.basisVersion === undefined ? 1 : p.integer(input.basisVersion,'common Oracle requested budget version',1,2) as 1 | 2
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'party' } })
  const { runtime, state, stateHash, authorization, content, source } = loaded, run = runtime.openRun!
  const seat = assertTtrpgOpenHumanHostV1(authorization, input.viewerKey)
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, input.commandId]).first()
  if (prior) {
    const epoch = run.coordination.epochs.find(row => row.startedRef.sessionKey === runtime.sessionKey && row.startedRef.sequence === prior.sequence)
    const basis = epoch?.commonOracle?.basis, gm = authorization.seats.find(row => row.role === 'gm')
    if (prior.type !== 'ttrpg.open.epoch.started' || prior.baseSequence !== input.baseSequence || prior.baseStateHash !== input.baseStateHash
      || !basis || basis.version !== basisVersion || gm?.controller !== 'ai' || basis.requester.viewerKey !== seat.viewerKey || basis.requester.seatKey !== seat.seatKey
      || basis.requester.seatRevision !== seat.revision || basis.authorizationRevision !== authorization.revision
      || stable(basis.oracleSourceRef) !== stable(input.oracleSourceRef) || basis.oracleInputHash !== input.oracleInputHash
      || (basis.runtimeReferencePolicy?.references.snapshotHash ?? null) !== input.snapshotHash || basis.decision !== input.decision
      || stable(basis.modelIdentity) !== stable(input.modelIdentity) || basis.budget.maximumInputTokens !== input.maximumInputTokens
      || basis.budget.maximumOutputTokens !== input.maximumOutputTokens || basis.budget.maximumCostUsd !== input.maximumCostUsd
      || await hashTtrpgOpenCommonOracleRequestBasisV1(basis) !== epoch!.commonOracle!.basisHash) throw new Error('原共同事实命令属于其他输入、身份或修订，不能挪用其窗口')
    const originalRun = await db.agentRuns.get(epoch!.commonOracle!.run.runId)
    if (!originalRun || originalRun.projectId !== input.scope.projectId || originalRun.portableRuntimeOriginJson !== undefined || originalRun.productRuntimeSessionId !== input.sessionId
      || originalRun.contractJson !== epoch!.commonOracle!.run.contractJson || originalRun.contractHash !== epoch!.commonOracle!.run.contractHash) throw new Error('原共同事实 Run 已缺失或仅为导入历史，请重新明确授权新请求')
    const originalSnapshot = await readInstanceAgentRunV1(input.scope, originalRun.id!)
    if (originalSnapshot.events.some(row => row.type === 'run.cancelled' && row.payload.reason === 'project-import-nonportable-checkpoint')) throw new Error('共同事实原授权仅为导入历史，请以新操作重新明确授权')
    await loaded.assertCurrent()
    return { sequence: prior.sequence, epochKey: epoch!.epochKey, basisHash: epoch!.commonOracle!.basisHash, runId: originalRun.id!, requestKey: epoch!.commonOracle!.requestKey }
  }
  assertTtrpgOpenCommonOracleEpochAuthorityV1(runtime, input.viewerKey)
  assertTtrpgOpenOracleInterpretationSlotV1(runtime, run.worldTime.worldTurn)
  if (!content.campaign.runtimePolicy.enabled) throw new Error('冻结作品未允许共同事实请求')
  if (run.coordination.activeEpochKey || state.lastSequence !== input.baseSequence || stateHash !== input.baseStateHash) throw new Error('共同事实的原窗口或本人已审阅进度已变化，请重新确认')
  const actual = await loadTtrpgOpenCommonOracleContextV1({ ...input, actorKey: 'gm' })
  const selected = actual.directory.find(row => stable(row.oracleSourceRef) === stable(input.oracleSourceRef))
  if (!selected || selected.contentHash !== p.hash(input.oracleInputHash, 'common Oracle selected full input') || selected.snapshotHash !== input.snapshotHash) throw new Error('共同事实的原咨询、实际正文或对象范围已变化，请重新确认')
  const oracle = run.oracleReceipts!.find(row => stable(row.sourceRef) === stable(selected.oracleSourceRef))!
  const runtimeReferencePolicy = selected.snapshotHash ? await createTtrpgOpenOracleRuntimeReferencePolicyV1({ content, operations: run.entityOperations ?? [], runtimeSourceHash: source.runtimeSourceHash,
    oracle, recipientActorKeys: actual.recipientActorKeys, consumerRef: { sessionKey: runtime.sessionKey, sequence: state.lastSequence + 1 } }) : null
  const basis = await createTtrpgOpenCommonOracleRequestBasisV1({ version: basisVersion,source: actual, oracleSourceRef: selected.oracleSourceRef,
    requester: { viewerKey: seat.viewerKey, seatKey: seat.seatKey, seatRevision: seat.revision }, runtimeReferencePolicy, decision: input.decision,
    modelIdentity: input.modelIdentity, budget: { maximumInputTokens: input.maximumInputTokens, maximumOutputTokens: input.maximumOutputTokens,
      maximumCostUsd: input.maximumCostUsd, maximumCalls: 1, maximumAiActions: 0, perFactHumanReviewRequired: true } })
  const selectedBodies = actual.resources.filter(row => row.mandatory || row.suffix === selected.suffix)
  if (selectedBodies.reduce((sum, row) => sum + estimateTokens(stable(row.value)), 0) > basis.budget.maximumInputTokens
    || basis.budget.maximumInputTokens + basis.budget.maximumOutputTokens > runtime.epochBudget.maximumTokens
    || basis.budget.maximumCostUsd > runtime.epochBudget.maximumCostUsd || runtime.epochBudget.maximumCalls < 1
    || basis.budget.maximumOutputTokens > content.campaign.runtimePolicy.maximumOutputTokens) throw new Error('共同事实没有足够且明确的一次请求预算，完整正文不得截断')
  const skill = getAgentSkillV1(TTRPG_OPEN_COMMON_ORACLE_SKILL_V1)
  if (basis.budget.maximumOutputTokens > skill.maxOutputTokens) throw new Error('共同事实输出上限超过本次独立 Skill')
  const basisHash = await hashTtrpgOpenCommonOracleRequestBasisV1(basis), authorizationCommandId = p.key(input.commandId, 'common Oracle authorization command')
  const inputRevision = await ttrpgOpenCommonOracleInputRevisionV1({ basisHash, authorizationHash: await hashCanonicalValue(authorization), viewerKey: seat.viewerKey, authorizationCommandId })
  const epochKey = await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'epoch', [String(state.lastSequence + 1), inputRevision])
  const identity = await ttrpgOpenCommonOracleCommandIdentityV1(runtime.sessionKey, epochKey)
  const request = { basis, basisHash, worldTurn: run.worldTime.worldTurn, admissionStateHash: actual.admissionStateHash, authorizationCommandId, ...identity, epochKey }
  const contentBytes = stable(ttrpgOpenCommonOracleAuthorizationInputV1(request)), inputArtifactHash = await sha256Text(contentBytes)
  const objective = ttrpgOpenCommonOracleObjectiveV1(basisHash, authorizationCommandId)
  const original = (await db.agentRuns.where('productRuntimeSessionId').equals(input.sessionId).toArray()).filter(row => readTtrpgOpenCommonOracleObjectiveV1(JSON.parse(row.contractJson).objective)?.authorizationCommandId === authorizationCommandId)
  if (original.length > 1 || original.some(row => row.portableRuntimeOriginJson !== undefined || JSON.parse(row.contractJson).objective !== objective)) throw new Error('共同事实原准备来自导入或另一输入，须用新操作重新确认')
  let snapshot: AgentRunSnapshotV1 = original.length ? await readInstanceAgentRunV1(input.scope, original[0].id!) : await createAgentRunV1({ scope: input.scope,
    productRuntimeSessionId: input.sessionId, worldGroupId: null, contract: { version: 3, executionBoundary: 'product-runtime', objective, workflowKind: 'direct-generation',
      scope: { projectId: input.scope.projectId, worldGroupId: null, runtime: { productRuntimeSessionId: input.sessionId, baseSequence: state.lastSequence, stateHash,
        visibilityHash: basis.sourceVisibilityHash, releaseHash: basis.runtimeSourceHash } },
      permissions: { contextSourceKeys: [TTRPG_OPEN_COMMON_ORACLE_SOURCE_V1], writeTargets: [] },
      runtimeBindingHash: await ttrpgOpenCallBindingHashV1({ sessionKey: runtime.sessionKey, actorKey: 'gm', authorizationEpochKey: epochKey,
        admissionStateHash: actual.admissionStateHash, visibilityHash: basis.sourceVisibilityHash, runtimeSourceHash: basis.runtimeSourceHash, commonOracle: ttrpgOpenCommonOracleCallMarkerV1(request) }),
      executionBindings: [{ stepId: TTRPG_OPEN_COMMON_ORACLE_STEP_V1, ...await createAgentSkillExecutionBindingV2(skill), formalEntry: await freezeFormalAIEntryBindingV1(TTRPG_OPEN_COMMON_ORACLE_ENTRY_V1) }],
      budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: basis.budget.maximumInputTokens, maxOutputTokens: skill.maxOutputTokens, maxAttemptsPerStep: 1 },
      acceptance: [{ id: 'common-oracle.protocol', kind: 'deterministic-check', required: true }],
      verificationPlan: [{ id: 'common-oracle.terminal', kind: 'terminal', verifier: skill.promptVersion, criterionIds: ['common-oracle.protocol'] }],
      failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' } } })
  try {
    if (['completed', 'failed', 'cancelled'].includes(snapshot.projection.state)) throw new Error('共同事实原准备已经终止，不能按旧授权创建替代 Run')
    if (!snapshot.projection.steps[TTRPG_OPEN_COMMON_ORACLE_STEP_V1]) snapshot = await appendAgentRunEventV1({ scope: input.scope,
      productRuntimeSessionId: input.sessionId, runId: snapshot.run.id, type: 'step.scheduled', payload: { stepId: TTRPG_OPEN_COMMON_ORACLE_STEP_V1 }, expectedLastSequence: snapshot.projection.lastSequence })
    if (snapshot.projection.steps[TTRPG_OPEN_COMMON_ORACLE_STEP_V1]?.status === 'scheduled') snapshot = await appendAgentRunEventV1({ scope: input.scope,
      productRuntimeSessionId: input.sessionId, runId: snapshot.run.id, type: 'step.started', payload: { stepId: TTRPG_OPEN_COMMON_ORACLE_STEP_V1, attempt: 1 }, expectedLastSequence: snapshot.projection.lastSequence })
    if (!snapshot.events.some(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'source-snapshot' && event.payload.contentHash === inputArtifactHash)) snapshot = (await recordAgentRunArtifactV1({ scope: input.scope,
      productRuntimeSessionId: input.sessionId, runId: snapshot.run.id, stepId: TTRPG_OPEN_COMMON_ORACLE_STEP_V1, attempt: 1, artifactKind: 'source-snapshot', content: contentBytes, expectedLastSequence: snapshot.projection.lastSequence })).snapshot
    const checkpointJson = stable(ttrpgOpenCommonOracleAuthorizationCheckpointV1(request))
    const checkpoints = (await db.agentRunCheckpoints.where('runId').equals(snapshot.run.id).toArray()).filter(row => row.resumePayloadJson === checkpointJson)
    if (checkpoints.length > 1) throw new Error('共同事实原授权检查点不唯一，不能另造本地执行权')
    if (!checkpoints.length) snapshot = (await createAgentRunCheckpointV1({ scope: input.scope, productRuntimeSessionId: input.sessionId,
      runId: snapshot.run.id, resumePayload: JSON.parse(checkpointJson), expectedLastSequence: snapshot.projection.lastSequence })).snapshot
    const commonOracle = parseTtrpgOpenCommonOracleAuthorizationV1({ ...request, inputArtifactHash, run: { runId: snapshot.run.id, contractHash: snapshot.run.contractHash, contractJson: snapshot.run.contractJson } })
    await loaded.assertCurrent()
    const event = await startTtrpgOpenEpochV1({ ...input, rawInput: TTRPG_OPEN_COMMON_ORACLE_INPUT_V1, triggerKind: 'continue-host', commonOracle })
    return { sequence: event.sequence, epochKey, basisHash, runId: snapshot.run.id!, requestKey: identity.requestKey }
  } catch (error) {
    const event = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, authorizationCommandId]).first()
    if (JSON.parse(event?.payloadJson ?? '{}').epoch?.commonOracle?.run?.runId !== snapshot.run.id) {
      const latest = await readInstanceAgentRunV1(input.scope, snapshot.run.id!)
      if (!['completed', 'failed', 'cancelled'].includes(latest.projection.state)) await appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId,
        runId: snapshot.run.id, type: 'run.failed', payload: { code: 'ttrpg-common-oracle-authorization-incomplete', retryable: false }, expectedLastSequence: latest.projection.lastSequence })
    }
    throw error
  }
}

/** Save the empty-window close first, then terminate only its original local Run. Repeating repairs a return cut. */
export async function finishTtrpgOpenEmptyCommonOracleWindowV1(input: { scope: WorkspaceScope; sessionId: number; viewerKey: string; epochKey: string; decision: 'close-this-empty-common-oracle-window' }) {
  if (input.decision !== 'close-this-empty-common-oracle-window') throw new Error('请明确结束本次尚未发送的共同事实窗口')
  let own = await readTtrpgOpenEmptyCommonOracleOwnerV1(input)
  if (own.epoch.status === 'active') {
    const current = own.loaded
    await closeTtrpgOpenEpochV1({ sessionId: input.sessionId, viewerKey: input.viewerKey, epochKey: input.epochKey,
      commandId: await ttrpgOpenScopedKeyV1(current.runtime.sessionKey, 'common-oracle.close-empty', [input.epochKey]), baseSequence: current.state.lastSequence, baseStateHash: current.stateHash,
      reason: '真人明确结束本次尚未发送的共同事实准备；原授权和来源保留。', commonOracleEmpty: true })
    own = await readTtrpgOpenEmptyCommonOracleOwnerV1(input)
  }
  if (own.local) {
    const latest = await readInstanceAgentRunV1(input.scope, own.grant.run.runId)
    if (!['cancelled', 'failed', 'completed'].includes(latest.projection.state)) await appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId,
      runId: latest.run.id, type: 'run.cancelled', payload: { reason: '本次无正式调用的共同事实窗口已明确结束；不重建原 Run。' }, expectedLastSequence: latest.projection.lastSequence })
  }
  return { sequence: own.epoch.closedRef!.sequence, epochKey: input.epochKey, originalRun: own.local ? 'local' as const : 'missing-or-imported' as const }
}
