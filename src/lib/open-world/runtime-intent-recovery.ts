import { db } from '../db/schema'
import { readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { hashCanonicalValue } from '../agent/run/hash'
import { completedAgentRunEvidencePrefixV1 } from '../agent/run/projection'
import { isSha256Hash } from '../product-production/hash'
import { readProductRuntimeState } from '../product/runtime-core'
import type { TextOpenWorldCommandEnvelopeV1 } from '../types'
import { createTextOpenWorldActionRegistryV1 } from './action-registry'
import { parseTextOpenWorldModulesV1 } from './modules'
import {
  TEXT_OPEN_WORLD_RUNTIME_INTENT_CONFIDENCE_V1,
  TEXT_OPEN_WORLD_RUNTIME_INTENT_STEP_ID_V1,
  type TextOpenWorldRuntimeIntentEvidenceV1,
} from './runtime-intent'
import { deriveTextOpenWorldContextsV1, parseTextOpenWorldSessionProjectionV1 } from './session-projection'

function fail(message: string): never { throw new Error(`[text-open-world-action-executor] ${message}`) }
function targetFrom(envelope: TextOpenWorldCommandEnvelopeV1): string | null {
  const value = envelope.payload.targetKey
  return typeof value === 'string' ? value : null
}

/** The committed command owns this portable proof. Recovery must neither
 * mint a new authorization nor depend on a local Run ID after backup import. */
export function pendingRuntimeIntentEvidenceV1(
  envelope: TextOpenWorldCommandEnvelopeV1,
  modules: ReturnType<typeof parseTextOpenWorldModulesV1>,
): TextOpenWorldRuntimeIntentEvidenceV1 | null {
  const raw = envelope.payload.runtimeIntent
  if (raw === undefined && envelope.source !== 'mapped-intent') return null
  if (envelope.source !== 'mapped-intent' || envelope.actorKey !== 'player'
    || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`待结算命令AI意图证据或来源不合法:${envelope.commandId}`)
  }
  const value = raw as Record<string, unknown>
  const keys = [
    'schema', 'version', 'candidateHash', 'contextManifestHash', 'terminalReceiptHash',
    'selectedKind', 'selectedKey', 'actionKey', 'targetKey',
  ]
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))
    || value.schema !== 'storyforge.text-open-world.runtime-intent-evidence' || value.version !== 1
    || !isSha256Hash(value.candidateHash) || !isSha256Hash(value.contextManifestHash)
    || !isSha256Hash(value.terminalReceiptHash)
    || (value.selectedKind !== 'action' && value.selectedKind !== 'choice')
    || typeof value.selectedKey !== 'string' || !/^[a-z][a-z0-9._:-]{0,199}$/.test(value.selectedKey)
    || value.actionKey !== envelope.actionKey || value.targetKey !== targetFrom(envelope)) {
    fail(`待结算命令AI意图证据与Action不一致:${envelope.commandId}`)
  }
  if (value.selectedKind === 'action'
    ? value.selectedKey !== envelope.actionKey
    : !modules.narrative.fixedChoices.some(choice => choice.key === value.selectedKey && choice.actionKey === envelope.actionKey)) {
    fail(`待结算命令AI意图选择与冻结Action不一致:${envelope.commandId}`)
  }
  return {
    schema: 'storyforge.text-open-world.runtime-intent-evidence', version: 1,
    candidateHash: value.candidateHash, contextManifestHash: value.contextManifestHash,
    terminalReceiptHash: value.terminalReceiptHash, selectedKind: value.selectedKind,
    selectedKey: value.selectedKey, actionKey: envelope.actionKey, targetKey: targetFrom(envelope),
  }
}

function intentCandidateRecordV1(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

export async function verifyPendingRuntimeIntentLedgerV1(
  envelope: TextOpenWorldCommandEnvelopeV1,
  evidence: TextOpenWorldRuntimeIntentEvidenceV1,
): Promise<void> {
  const session = await db.productRuntimeSessions.get(envelope.sessionId)
  if (!session || session.worldId == null || session.workId == null) fail('AI意图恢复缺少原Session owner')
  const scope = { projectId: session.projectId, worldId: session.worldId, workId: session.workId }
  const runs = await db.agentRuns.where('productRuntimeSessionId').equals(envelope.sessionId).toArray()
  for (const run of runs) {
    if (run.id == null) continue
    const checkpoints = await db.agentRunCheckpoints.where('runId').equals(run.id).sortBy('throughSequence')
    const hint = checkpoints[checkpoints.length - 1]
    let hintedCandidate: Record<string, unknown> | null = null
    try { hintedCandidate = intentCandidateRecordV1(JSON.parse(hint?.resumePayloadJson ?? 'null')) } catch { /* Locator only; never authorizes. */ }
    if (hintedCandidate?.candidateHash !== evidence.candidateHash) continue
    const saved = await readLatestVerifiedAgentRunCheckpointV1(scope, run.id, { owner: 'instance' })
    const candidate = intentCandidateRecordV1(saved?.resumePayload)
    if (!saved || !candidate) fail(`待结算命令AI意图原始候选缺失:${envelope.commandId}`)
    const completed = completedAgentRunEvidencePrefixV1(saved.snapshot.events)
    const runtime = saved.snapshot.contract.scope.runtime
    const bindings = saved.snapshot.contract.executionBindings
    const { candidateHash, contextManifestHash, ...body } = candidate
    const selectedKeys = evidence.selectedKind === 'action' ? candidate.actionKeys : candidate.choiceKeys
    const argumentsRecord = intentCandidateRecordV1(candidate.extractedArguments)
    if (saved.snapshot.run.productRuntimeSessionId !== envelope.sessionId
      || runtime?.productRuntimeSessionId !== envelope.sessionId
      || runtime.baseSequence !== envelope.baseSequence || runtime.stateHash !== envelope.baseStateHash
      || runtime.releaseHash !== session.runtimeSourceHash
      || bindings?.length !== 1 || bindings[0]?.skillId !== 'prose.text-open-world-runtime-intent'
      || !completed || completed.terminalReceiptHash !== evidence.terminalReceiptHash
      || completed.steps[TEXT_OPEN_WORLD_RUNTIME_INTENT_STEP_ID_V1]?.candidateHash !== evidence.candidateHash
      || candidate.schema !== 'storyforge.text-open-world.runtime-intent-candidate'
      || candidate.version !== 1 || candidate.portable !== false
      || candidateHash !== evidence.candidateHash || await hashCanonicalValue(body) !== candidateHash
      || contextManifestHash !== evidence.contextManifestHash
      || candidate.baseSequence !== envelope.baseSequence || candidate.stateHash !== envelope.baseStateHash
      || candidate.releaseHash !== session.runtimeSourceHash
      || typeof candidate.confidence !== 'number' || candidate.confidence < TEXT_OPEN_WORLD_RUNTIME_INTENT_CONFIDENCE_V1
      || candidate.kind !== (evidence.selectedKind === 'action' ? 'mapped-action' : 'mapped-choice')
      || !Array.isArray(selectedKeys) || !selectedKeys.includes(evidence.selectedKey)
      || !argumentsRecord || (argumentsRecord.targetKey != null && argumentsRecord.targetKey !== evidence.targetKey)
      || !saved.snapshot.events.some(event => event.type === 'context.assembled'
        && event.generation === completed.generation && event.sequence <= completed.lastSequence
        && event.payload.stepId === TEXT_OPEN_WORLD_RUNTIME_INTENT_STEP_ID_V1
        && event.payload.manifestHash === evidence.contextManifestHash)) {
      fail(`待结算命令AI意图原始授权账本不匹配:${envelope.commandId}`)
    }
    // Candidate bytes retain their original IDs after import. The verified
    // reader above owns the actual remapping; do not rewrite or re-sign them.
    const base = parseTextOpenWorldSessionProjectionV1((await readProductRuntimeState(envelope.sessionId, envelope.baseSequence)).textOpenWorld)
    const availability = createTextOpenWorldActionRegistryV1(base.runtimePackage)
      .project(deriveTextOpenWorldContextsV1(base).action)
      .find(item => item.action.key === envelope.actionKey)
    const modules = parseTextOpenWorldModulesV1(base.runtimePackage)
    if (!availability?.available || (availability.targetScope === 'none'
      ? evidence.targetKey !== null : evidence.targetKey === null || !availability.validTargetKeys.includes(evidence.targetKey))
      || (evidence.selectedKind === 'choice' && !modules.narrative.fixedChoices.some(choice => (
        choice.key === evidence.selectedKey && choice.actionKey === envelope.actionKey
          && choice.sceneKey === candidate.selectedSceneKey
      )))) {
      fail(`待结算命令AI意图目标不属于原候选:${envelope.commandId}`)
    }
    return
  }
  fail(`待结算命令AI意图原始授权账本缺失:${envelope.commandId}`)
}
