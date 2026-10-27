import { reviewTtrpgOpenOracleRuntimeDeliveryV1, reviewTtrpgOpenNormalizationRuntimeDeliveryV1 } from './open-oracle-runtime-delivery'
import { resolveTtrpgOpenNormalizationRuntimeOriginV1 } from './open-runtime-entity-references'
import { assertTtrpgOpenNormalizationSourceV1 } from './open-model-calls'
import { assertTtrpgOpenFrozenContextSourcesV1 } from './open-model-purpose-contract'
import { assertInstanceBinding } from '../product/runtime-instances'
import { verifyProductRuntimeSessionSourceV1 } from '../product-production/preview-source'
import { isTtrpgRuntimeContentV2 } from './content-version'
import { reviewTtrpgOpenCommonOracleDeliveryV1 } from './open-common-oracle-delivery'
/** Exact governed Run/evidence proof checked again by the runtime command transaction. */
import { db } from '../db/schema'
import type { AgentRunRecord, AgentRunEventRecord, AgentRunArtifactRecordV1, WorkspaceScope } from '../types'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { verifyContextManifestIntegrityV1, verifyContextManifestIntegrityV2, verifyContextManifestIntegrityV3 } from '../agent/run/context-manifest'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import type { TtrpgOpenModelCallV1 } from './open-model-calls'
import { loadTtrpgOpenModelContextV1, ttrpgOpenModelPurposeForSkillV1 } from './open-model-purpose'
import { estimateTtrpgOpenFrozenRuntimeInputTokensV1 } from './open-runtime-wire-budget'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { assertAgentSkillExecutionBindingV1, assertAgentSkillExecutionBindingIntegrityV2,
  projectFrozenAgentSkillDefinitionV1 } from '../agent/execution-binding'
import { assertFormalAIEntrySnapshotIntegrityV1 } from '../agent/formal-ai-entry'
import { readProductRuntimeState } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { ttrpgOpenIntentRoutingVersionForRunV1 } from './open-intent-routing-policy'
import { verifyTtrpgOpenInputEvidenceV1, type TtrpgOpenInputEvidenceV1 } from './open-input-evidence'

export interface TtrpgOpenAgentEvidenceV1 {
  run: AgentRunRecord & { id: number }
  events: AgentRunEventRecord[]
  artifacts: AgentRunArtifactRecordV1[]
}
/** Internal CAS evidence; never returned from the human API. */
export interface TtrpgOpenCommonOracleArchiveWitnessV1 {
  sessionId: number; originalRunId: number; originalRun: AgentRunRecord | undefined; sessionRuns: AgentRunRecord[];
}
export async function assertTtrpgOpenCommonOracleArchiveWitnessV1(w: TtrpgOpenCommonOracleArchiveWitnessV1) {
  const original = await db.agentRuns.get(w.originalRunId)
  const rows = await db.agentRuns.where('productRuntimeSessionId').equals(w.sessionId).sortBy('id')
  if (stable(original ?? null) !== stable(w.originalRun ?? null) || stable(rows) !== stable(w.sessionRuns)) throw new Error('共同请求原记录在归档提交期间发生变化，请重新核对')
}

export async function ttrpgOpenCallBindingHashV1(input: Pick<TtrpgOpenModelCallV1,
  'intentRoutingVersion' | 'commonOracle' | 'actorKey' | 'authorizationEpochKey' | 'admissionStateHash' | 'visibilityHash' | 'runtimeSourceHash' | 'entityProposal' | 'oracleInterpretation' | 'supportSlot' | 'narrationBinding' | 'hostingDelegationRef'> & { sessionKey: string }) {
  return hashProductProductionValueV2({ schema: 'storyforge.ttrpg-open-call-binding', version: 1, ...input })
}

export async function verifyTtrpgOpenModelCallEvidenceV1(input: {
  scope: WorkspaceScope; sessionId: number; runId: number; call: TtrpgOpenModelCallV1
  mode: 'reserve' | 'dispatch' | 'finish'
}): Promise<TtrpgOpenAgentEvidenceV1> {
  const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
  const { call } = input
  if (['prose.ttrpg-open-intent', 'prose.ttrpg-open-companion'].includes(call.skillId)) await ttrpgOpenIntentRoutingVersionForRunV1(snapshot.run, call)
  const definition = ttrpgOpenModelPurposeForSkillV1(call.skillId), expectedSources = [...assertTtrpgOpenFrozenContextSourcesV1(call.skillId, snapshot.contract.permissions.contextSourceKeys)].sort().join(',')
  let originalAuthorizationEvidence: TtrpgOpenAgentEvidenceV1 | undefined
  let commonDelivery: Pick<Parameters<typeof reviewTtrpgOpenCommonOracleDeliveryV1>[0], 'basis' | 'content'> | undefined
  if (definition.purpose === 'common-oracle-interpret') {
    const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
    const grant = runtime?.openRun?.coordination.epochs.find(row => row.epochKey === call.authorizationEpochKey)?.commonOracle
    if (!grant || input.runId !== grant.run.runId || call.runContractHash !== grant.run.contractHash || call.requestKey !== grant.requestKey
      || call.actorKey !== 'gm' || call.stepId !== 'ttrpg.open.common-oracle-interpret' || call.attempt !== 1
      || stable(call.commonOracle) !== stable((await import('./open-common-oracle-request')).ttrpgOpenCommonOracleCallMarkerV1(grant))
      || call.reservedInputTokens > grant.basis.budget.maximumInputTokens || call.reservedOutputTokens !== grant.basis.budget.maximumOutputTokens
      || call.reservedCostUsd > grant.basis.budget.maximumCostUsd) throw new Error('共同事实调用必须绑定本次原本地 Run、原请求、范围和预算')
    const session = await assertInstanceBinding(input.sessionId, input.scope)
    const source = await verifyProductRuntimeSessionSourceV1({ scope: input.scope, session, ttrpgProtocol: 2 })
    if (!source.runtimePackage.ttrpg || !isTtrpgRuntimeContentV2(source.runtimePackage.ttrpg) || source.runtimeSourceHash !== call.runtimeSourceHash) throw new Error('共同事实缺少本次准确冻结来源')
    commonDelivery = { basis: grant.basis, content: source.runtimePackage.ttrpg }
    if (input.mode !== 'finish') originalAuthorizationEvidence = (await (await import('./open-common-oracle-authorization-proof')).verifyTtrpgOpenCommonOracleAuthorizationV1({ ...input, viewerKey: grant.basis.requester.viewerKey, authorization: grant, phase: input.mode === 'reserve' ? 'prepare' : 'dispatch' })).evidence
  }
  if (definition.purpose === 'public-situation-proposal') {
    const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
    const epoch = runtime?.openRun?.coordination.epochs.find(e => e.epochKey === call.authorizationEpochKey), grant = epoch?.publicSituation
    if (!grant || input.runId !== grant.run.runId || call.requestKey !== grant.basis.requestKey || call.runContractHash !== grant.run.contractHash
      || call.actorKey !== 'gm' || call.stepId !== 'ttrpg.open.public-situation-propose' || call.attempt !== 1
      || call.runtimeSourceHash !== grant.basis.runtimeSourceHash || call.visibilityHash !== grant.basis.sourceVisibilityHash
      || call.admissionStateHash !== grant.admissionStateHash || call.reservedInputTokens > grant.budget.maximumInputTokens
      || call.reservedOutputTokens !== grant.budget.maximumOutputTokens || call.reservedCostUsd > grant.budget.maximumCostUsd) {
      throw new Error('[ttrpg-public-situation] 模型调用只能使用本次原 Run、原请求身份与冻结预算')
    }
    if (input.mode !== 'finish') originalAuthorizationEvidence = (await (await import('./open-public-situation-authorization-proof')).verifyTtrpgOpenPublicSituationAuthorizationV1({
      ...input, viewerKey: grant.basis.requester.viewerKey, authorization: grant, phase: input.mode === 'reserve' ? 'prepare' : 'dispatch' })).evidence
  }
  const bound = snapshot.contract.scope.runtime
  const binding = snapshot.contract.executionBindings?.find(binding => binding.stepId === call.stepId)
  const step = snapshot.projection.steps[call.stepId]
  if (call.oracleInterpretation?.runtimeReferencePolicy && (binding?.version !== 2
    || projectFrozenAgentSkillDefinitionV1(binding).promptVersion !== 'ttrpg-open-oracle-interpret-v3')) {
    throw new Error('实例事实读取必须绑定明确支持本协议的原 V3 Skill，旧冻结 Skill 不取得新权限')
  }
  if (call.supportSlot?.runtimeReferencePolicy && (binding?.version !== 2
    || projectFrozenAgentSkillDefinitionV1(binding).promptVersion !== 'ttrpg-open-fact-normalize-v3')) throw new Error('实例归一必须使用支持本协议的原 V3 Skill，旧冻结归一不能扩权')
  if (snapshot.run.productRuntimeSessionId !== input.sessionId || snapshot.run.contractHash !== call.runContractHash
    || !bound || bound.productRuntimeSessionId !== input.sessionId || bound.visibilityHash !== call.visibilityHash
    || bound.releaseHash !== call.runtimeSourceHash || binding?.skillId !== call.skillId
    || snapshot.contract.permissions.writeTargets.length
    || [...snapshot.contract.permissions.contextSourceKeys].sort().join(',') !== expectedSources
    || step?.attempt !== call.attempt || (input.mode !== 'finish' && step.status !== 'running')
    || snapshot.contract.runtimeBindingHash !== await ttrpgOpenCallBindingHashV1({ sessionKey: call.createdRef.sessionKey,
      actorKey: call.actorKey, authorizationEpochKey: call.authorizationEpochKey, admissionStateHash: call.admissionStateHash,
      visibilityHash: call.visibilityHash, runtimeSourceHash: call.runtimeSourceHash,
      ...(call.intentRoutingVersion ? { intentRoutingVersion: call.intentRoutingVersion } : {}),
      ...(call.commonOracle ? { commonOracle: call.commonOracle } : {}),
      ...(call.entityProposal ? { entityProposal: call.entityProposal } : {}),
      ...(call.hostingDelegationRef ? { hostingDelegationRef: call.hostingDelegationRef } : {}),
      ...(call.oracleInterpretation ? { oracleInterpretation: call.oracleInterpretation } : {}),...(call.supportSlot ? { supportSlot: call.supportSlot } : {}), ...(call.narrationBinding ? { narrationBinding: call.narrationBinding } : {}) })) {
    throw new Error('[ttrpg-open-call] 模型请求没有同一实例/角色/Skill 的真实运行契约')
  }
  if (binding.version === 1 && input.mode !== 'finish') {
    const { stepId: _stepId, formalEntry: _formalEntry, promptExecution: _promptExecution, ...skillBinding } = binding
    assertAgentSkillExecutionBindingV1(skillBinding, getAgentSkillV1(call.skillId))
  }
  if (binding.version === 2) {
    await assertAgentSkillExecutionBindingIntegrityV2(binding)
    if (binding.contextSourceKeys.slice().sort().join(',') !== expectedSources
      || binding.writeTargets.length || call.reservedOutputTokens > binding.maxOutputTokens) {
      throw new Error('[ttrpg-open-call] 冻结 Skill 来源/写权限/预算不一致')
    }
    if (!binding.formalEntry) throw new Error('[ttrpg-open-call] 正式调用缺少冻结 AI 入口')
    const entry = await assertFormalAIEntrySnapshotIntegrityV1(binding.formalEntry,
      new Map([[call.skillId, projectFrozenAgentSkillDefinitionV1(binding)]]))
    if (entry.entryId !== definition.entryId || entry.adoptAllowed || entry.executionBoundary !== 'product-runtime') {
      throw new Error('[ttrpg-open-call] 正式入口不能获得机械状态写权限')
    }
  }
  if (input.mode === 'reserve') {
    const state = await readProductRuntimeState(input.sessionId)
    const alreadyCounted = parseTtrpgRuntimeStateV2(state.ttrpg)?.openRun?.coordination.calls.filter(previous => previous.runContractHash === call.runContractHash).length ?? 0
    if (alreadyCounted >= snapshot.contract.budget.maxModelCalls || call.reservedInputTokens > snapshot.contract.budget.maxInputTokens
      || call.reservedOutputTokens > Math.min(snapshot.contract.budget.maxOutputTokens,
        binding.version === 2 ? binding.maxOutputTokens : getAgentSkillV1(call.skillId).maxOutputTokens)
      || call.attempt > snapshot.contract.budget.maxAttemptsPerStep) throw new Error('[ttrpg-open-call] 请求超过冻结 Run/Skill 硬预算')
  }
  if (!snapshot.events.some(event => event.type === 'model.requested' && event.payload.stepId === call.stepId
    && event.payload.attempt === call.attempt && event.payload.bindingHash === call.requestHash)) {
    throw new Error('[ttrpg-open-call] 缺少同一 attempt 的真实模型请求绑定')
  }
  const artifacts: AgentRunArtifactRecordV1[] = [...(originalAuthorizationEvidence?.artifacts ?? [])]
  const exact = async (kind: AgentRunArtifactRecordV1['artifactKind'], hash: string) => {
    if (!snapshot.events.some(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === kind
      && event.payload.contentHash === hash && event.payload.stepId === call.stepId && event.payload.attempt === call.attempt)) {
      throw new Error('[ttrpg-open-call] 原始请求/响应缺少同一 attempt 的真实工件回执')
    }
    const body = await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: kind, contentHash: hash })
    const row = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([input.scope.projectId, kind, hash]).first()
    if (!row || row.content !== body || row.retentionState !== 'available') throw new Error('[ttrpg-open-call] 工件读取期间发生变化')
    if (!snapshot.events.some(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === kind
      && event.payload.contentHash === hash && event.payload.byteLength === row.byteLength
      && event.payload.stepId === call.stepId && event.payload.attempt === call.attempt)) throw new Error('[ttrpg-open-call] 原始工件的字节回执不一致')
    artifacts.push(row)
    return body
  }
  const renderedRequest = await exact('rendered-request', call.requestHash)
  if (estimateTtrpgOpenFrozenRuntimeInputTokensV1(renderedRequest) > call.reservedInputTokens) throw new Error('[ttrpg-open-call] 实际请求超过预留输入预算')
  // Context snapshots use governed exact storage; a caller-provided hash alone is insufficient.
  let foundManifest = false
  let verifiedPreflight = false
  for (const event of snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'source-snapshot'
      || event.payload.stepId !== call.stepId || event.payload.attempt !== call.attempt) continue
    const body = await exact('source-snapshot', event.payload.contentHash)
    let manifest: unknown
    try { manifest = JSON.parse(body) } catch { continue }
    if (manifest && typeof manifest === 'object' && 'schema' in manifest
      && manifest.schema === 'storyforge.ttrpg-open-input-evidence') {
      const evidence = manifest as TtrpgOpenInputEvidenceV1
      if (evidence.manifest?.manifestHash !== call.inputManifestHash) continue
      if (definition.purpose === 'public-situation-proposal') {
        const rendered = JSON.parse(renderedRequest) as { publicKernelHash?: string }
        if (!evidence.publicKernelHash || rendered.publicKernelHash !== evidence.publicKernelHash) throw new Error('[ttrpg-public-situation] 原请求未绑定独立内核快照')
        const kernel = JSON.parse(await exact('source-snapshot', evidence.publicKernelHash)) as import('./open-public-situation-kernel').TtrpgOpenPublicSituationKernelV1
        const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)!
        const epoch = runtime.openRun!.coordination.epochs.find(e => e.epochKey === call.authorizationEpochKey)!
        await (await import('./open-public-situation-kernel')).verifyTtrpgOpenPublicSituationKernelV1({ snapshot: kernel,
          expectedHash: evidence.publicKernelHash, grant: epoch.publicSituation!, sessionKey: call.createdRef.sessionKey,
          epochKey: epoch.epochKey, authorizationHash: epoch.authorizationHash })
      }
      await verifyTtrpgOpenInputEvidenceV1({ ...input, evidence, requestHash: call.requestHash,
        inputManifestHash: call.inputManifestHash, stepId: call.stepId, attempt: call.attempt,
        sessionKey: call.createdRef.sessionKey, actorKey: call.actorKey, skillId: call.skillId })
      const oracleRef = call.commonOracle?.oracleSourceRef ?? call.oracleInterpretation?.oracleSourceRef ?? call.supportSlot?.oracleSourceRef
      let oracleInputMatched = !oracleRef, acceptedReviewMatched = !call.supportSlot
      const oracleDelivery: Array<{ sourceKey: string; content: string }> = []
      for (const ref of evidence.preflight.artifacts) {
        const bytes = await exact(ref.artifactKind, ref.contentHash)
        if (ref.role === 'source-snapshot' && oracleRef) {
          const source = JSON.parse(bytes) as { content: string }
          oracleDelivery.push({ sourceKey: ref.sourceKey!, content: source.content })
          const packet = JSON.parse(source.content) as { schema: string; sourceRef: unknown;reviewHash?: string;oracleSourceRef?: unknown }
          if (packet.schema === 'storyforge.ttrpg-open-gm-oracle-input') {
            if (await hashProductProductionValueV2(packet.sourceRef) !== await hashProductProductionValueV2(oracleRef)) throw new Error('[ttrpg-open-call] Oracle 槽位与实际读取不一致')
            oracleInputMatched = true
          }
          if (packet.schema === 'storyforge.ttrpg-open-gm-fact-normalization-input' && call.supportSlot) {
            if (packet.reviewHash !== call.supportSlot.sourceHash || await hashProductProductionValueV2(packet.sourceRef) !== await hashProductProductionValueV2(call.supportSlot.sourceRef)
              || await hashProductProductionValueV2(packet.oracleSourceRef) !== await hashProductProductionValueV2(oracleRef)) throw new Error('[ttrpg-open-call] 事实归一与实际已确认解释读取不一致')
            acceptedReviewMatched = true
          }
        }
      }
      if (commonDelivery) {
        await reviewTtrpgOpenCommonOracleDeliveryV1({ ...commonDelivery, snapshots: oracleDelivery })
        oracleInputMatched = true
      }
      else if (call.oracleInterpretation?.runtimeReferencePolicy) reviewTtrpgOpenOracleRuntimeDeliveryV1(call.oracleInterpretation.runtimeReferencePolicy, oracleDelivery)
      else if (call.supportSlot?.runtimeReferencePolicy) {
        const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)!, policy = call.supportSlot.runtimeReferencePolicy
        assertTtrpgOpenNormalizationSourceV1(runtime, call)
        const epoch = runtime.openRun!.coordination.epochs.find(row => row.epochKey === call.authorizationEpochKey)!
        const original = resolveTtrpgOpenNormalizationRuntimeOriginV1({ runtime, runtimeSourceHash: call.runtimeSourceHash, rulePackContentHash: runtime.product.rulePackContentHash,
          reviewSourceRef: policy.reviewSourceRef, recipientActorKeys: policy.recipientActorKeys, consumerRef: epoch.startedRef })
        reviewTtrpgOpenNormalizationRuntimeDeliveryV1(policy, oracleDelivery, original.review)
      }
      else if (oracleDelivery.some(row => { const value = JSON.parse(row.content); return value.schema === 'storyforge.ttrpg-open-gm-oracle-input' && value.version === 2 })) throw new Error('旧模型调用不能使用新实例 Oracle 正文')
      if (!oracleInputMatched) throw new Error('[ttrpg-open-call] 缺少指定 Oracle 的真实输入字节')
      if (!acceptedReviewMatched) throw new Error('[ttrpg-open-call] 缺少已接受解释的真实完整输入字节')
      verifiedPreflight = true
      manifest = evidence.manifest
    }
    if (!manifest || typeof manifest !== 'object' || !('manifestHash' in manifest) || manifest.manifestHash !== call.inputManifestHash) continue
    const version = 'version' in manifest ? manifest.version : null
    const valid = version === 1 ? await verifyContextManifestIntegrityV1(manifest)
      : version === 2 ? await verifyContextManifestIntegrityV2(manifest) : version === 3 ? await verifyContextManifestIntegrityV3(manifest) : false
    if (!valid || !('runId' in manifest) || manifest.runId !== input.runId || !('stepId' in manifest) || manifest.stepId !== call.stepId
      || !('attempt' in manifest) || manifest.attempt !== call.attempt) throw new Error('[ttrpg-open-call] 实际 Context Manifest 完整性或 attempt 不一致')
    const scope = 'scope' in manifest && manifest.scope && typeof manifest.scope === 'object' ? manifest.scope : null
    if (!scope || !('projectId' in scope) || scope.projectId !== input.scope.projectId
      || !('worldGroupId' in scope) || scope.worldGroupId !== snapshot.contract.scope.worldGroupId) {
      throw new Error('[ttrpg-open-call] 实际 Context Manifest 不属于冻结工作区')
    }
    const sources = 'sources' in manifest && Array.isArray(manifest.sources) ? manifest.sources : []
    if (sources.map(source => source.key).sort().join(',') !== expectedSources
      || sources.some(source => source.status !== 'included' || source.delivery !== 'full' || !source.contentHash)
      || !('totalInputTokens' in manifest) || typeof manifest.totalInputTokens !== 'number'
      || manifest.totalInputTokens > call.reservedInputTokens) throw new Error('[ttrpg-open-call] 角色契约/知识来源不完整或超过实际输入预算')
    foundManifest = true; break
  }
  if (!foundManifest) throw new Error('[ttrpg-open-call] 缺少可回读的实际 Context Manifest')
  if (!verifiedPreflight && !snapshot.events.some(event => event.type === 'context.assembled' && event.payload.stepId === call.stepId
    && event.payload.attempt === call.attempt && event.payload.manifestHash === call.inputManifestHash)) {
    throw new Error('[ttrpg-open-call] 缺少同一 attempt 的实际上下文回执')
  }
  if (call.responseArtifactHash !== null) {
    await exact('raw-response', call.responseArtifactHash)
    if (!snapshot.events.some(event => event.type === 'model.responded' && event.payload.stepId === call.stepId
      && event.payload.attempt === call.attempt && event.payload.outputHash === call.responseArtifactHash)) {
      throw new Error('[ttrpg-open-call] 原始响应缺少同一 attempt 的实际模型回执')
    }
  }
  if (input.mode !== 'finish') {
    const context = await loadTtrpgOpenModelContextV1({ scope: input.scope, sessionId: input.sessionId, actorKey: call.actorKey, skillId: call.skillId })
    if (context.visibilityHash !== call.visibilityHash || context.admissionStateHash !== call.admissionStateHash
      || context.readEvidence.runtimeSourceHash !== call.runtimeSourceHash
      || (input.mode === 'reserve' && definition.purpose !== 'public-situation-proposal' && definition.purpose !== 'common-oracle-interpret'
        && (context.readEvidence.sequence !== bound.baseSequence || context.readEvidence.stateHash !== bound.stateHash))) {
      throw new Error('[ttrpg-open-call] 模型派发输入已 stale，不能使用旧权限或机械状态')
    }
  }
  const events = await db.agentRunEvents.where('runId').equals(input.runId).sortBy('sequence')
  const run = await db.agentRuns.get(input.runId)
  if (!run || stable(run) !== stable(snapshot.run) || events.length !== snapshot.events.length
    || events.some((event, index) => {
      const expected = snapshot.events[index]
      return event.sequence !== expected.sequence || event.type !== expected.type || event.contractHash !== expected.contractHash
        || stable(JSON.parse(event.payloadJson)) !== stable(expected.payload)
    })) throw Object.assign(new Error('[ttrpg-open-call] 运行证据读取期间发生变化'), { code: 'sequence-conflict' })
  return { run: snapshot.run, events, artifacts }
}

/** Called only inside the encompassing runtime rw transaction. */
export async function assertTtrpgOpenAgentEvidenceUnchangedV1(evidence: TtrpgOpenAgentEvidenceV1): Promise<void> {
  const run = await db.agentRuns.get(evidence.run.id)
  const events = await db.agentRunEvents.where('runId').equals(evidence.run.id).sortBy('sequence')
  if (stable(run) !== stable(evidence.run) || stable(events) !== stable(evidence.events)) throw new Error('[ttrpg-open-call] 提交期间运行证据已变化')
  for (const artifact of evidence.artifacts) {
    if (stable(await db.agentRunArtifacts.get(artifact.id!)) !== stable(artifact)) throw new Error('[ttrpg-open-call] 提交期间原始工件已变化')
  }
}


/** Equal contracts can belong to competing Runs. Resolve their actual request/input proof, never the first hash match. */
export async function readTtrpgOpenModelCallRunsV1(input: {
  scope: WorkspaceScope; sessionId: number; calls: readonly TtrpgOpenModelCallV1[]
}) {
  await assertInstanceBinding(input.sessionId, input.scope)
  const rows = await db.agentRuns.where('productRuntimeSessionId').equals(input.sessionId).toArray()
  const selected = new Map<string, number>()
  for (const call of input.calls) {
    const sameContract = rows.filter(row => row.contractHash === call.runContractHash)
    if (sameContract.length <= 1) continue
    const matching: number[] = []
    for (const row of sameContract) {
      if (!row.id) throw new Error('[ttrpg-open-call] 原 Run 缺少稳定身份')
      const snapshot = await readInstanceAgentRunV1(input.scope, row.id)
      if (!snapshot.events.some(event => event.type === 'model.requested' && event.payload.stepId === call.stepId
        && event.payload.attempt === call.attempt && event.payload.bindingHash === call.requestHash)) continue
      let matched = false
      for (const event of snapshot.events) {
        if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'source-snapshot'
          || event.payload.stepId !== call.stepId || event.payload.attempt !== call.attempt) continue
        const body = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId,
          artifactKind: 'source-snapshot', contentHash: event.payload.contentHash })) as TtrpgOpenInputEvidenceV1
        if (body.schema === 'storyforge.ttrpg-open-input-evidence' && body.manifest.runId === row.id
          && body.manifest.manifestHash === call.inputManifestHash && await verifyContextManifestIntegrityV2(body.manifest)) matched = true
      }
      if (matched) matching.push(row.id)
    }
    if (matching.length !== 1 || selected.has(call.runContractHash) && selected.get(call.runContractHash) !== matching[0]) {
      throw new Error('[ttrpg-open-call] 原请求不能由唯一的实际 Run/input 证据定位，不得创建替代请求')
    }
    selected.set(call.runContractHash, matching[0])
  }
  return rows.filter(row => !selected.has(row.contractHash) || selected.get(row.contractHash) === row.id)
}
/** One original local owner, never a replacement execution authority from imported history. */
export async function readTtrpgOpenOriginalLocalCallRunV1(input: { scope: WorkspaceScope; sessionId: number; call: TtrpgOpenModelCallV1;
  runs?: Awaited<ReturnType<typeof readTtrpgOpenModelCallRunsV1>> }) {
  const rows = input.runs ?? await readTtrpgOpenModelCallRunsV1({ ...input, calls: [input.call] }), matches = []
  for (const row of rows.filter(row => row.id && !row.portableRuntimeOriginJson && row.contractHash === input.call.runContractHash)) {
    const snapshot = await readInstanceAgentRunV1(input.scope, row.id!)
    if (snapshot.run.productRuntimeSessionId === input.sessionId && snapshot.events.some(event => event.type === 'model.requested'
      && event.payload.stepId === input.call.stepId && event.payload.attempt === input.call.attempt && event.payload.bindingHash === input.call.requestHash)) matches.push(snapshot)
  }
  if (matches.length > 1) throw new Error('原模型请求的本地运行身份不唯一，请保留原记录。')
  return matches[0] ?? null
}
