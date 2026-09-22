import Dexie from 'dexie'
import { estimateTokens } from '../ai/context-budget'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../ai/config-readiness'
import {
  resolveRequestConfig,
  type AIRequestConfigResolution,
  type ChatResult,
} from '../ai/client'
import { computeKnownCostUsd } from '../ai/usage-log'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import {
  buildTextOpenWorldCreatorArtifactEditMessagesV1,
  parseTextOpenWorldCreatorArtifactEditModelOutputV1,
} from '../ai/adapters/text-open-world-creator-artifact-edit-adapter'
import {
  assertAgentSkillExecutionBindingIntegrityV2,
  createAgentSkillExecutionBindingV2,
  projectFrozenAgentSkillDefinitionV1,
} from '../agent/execution-binding'
import {
  assertFormalAIEntrySnapshotIntegrityV1,
  executeFrozenFormalAIEntryV1,
  freezeFormalAIEntryBindingV1,
} from '../agent/formal-ai-entry'
import { getAgentSkillV1 } from '../agent/skill-registry'
import {
  createAgentRunCheckpointInTransactionV1,
  createAgentRunCheckpointV1,
  readLatestVerifiedAgentRunCheckpointV1,
  verifyAgentRunCheckpointV1,
  type VerifiedAgentRunCheckpointV1,
} from '../agent/run/checkpoint'
import {
  createContextManifestFromAssemblyV1,
  parseContextManifestV1,
  verifyContextManifestIntegrityV1,
} from '../agent/run/context-manifest'
import {
  AgentRunStoreError,
  agentRunScopeTransactionTablesV1,
  appendAgentRunEventWithSettlementInTransactionV1,
  appendAgentRunEventV1,
  appendPrivilegedAgentRunEventInTransactionV1,
  createAgentRunV1,
  readAgentRunChildV1,
  readAgentRunV1,
  readVerifiedAgentRunInTransactionV1,
  verifyRecordedMemorySettlementV1,
  withAgentRunMutationLockV1,
  type AgentRunSnapshotV1,
} from '../agent/run/event-store'
import { parseAgentRunEventV1 } from '../agent/run/event-schema'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import {
  createVerificationReceiptV1,
  parseVerificationReceiptV1,
  verifyVerificationReceiptIntegrityV1,
} from '../agent/run/verification-receipt'
import { recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { db } from '../db/schema'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
  isSha256Hash,
} from '../product-production/hash'
import { createConfiguredTextProviderExecutionIdentityV1 } from '../product-production/capabilities'
import { assembleContext } from '../registry/assemble-context'
import type {
  AgentRunRecord,
  AIConfig,
  ChatMessage,
  AgentSkillExecutionBindingV2,
  AgentRunFormalAIEntryBindingV1,
  ProductBuildRecordV1,
  ProductProductionRecordV1,
  VerificationReceiptV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, readOwnedRows } from '../workspace/scope'
import {
  createTextOpenWorldCreatorEditPatchV1,
  createTextOpenWorldCreatorEditTerminalReceiptV1,
  hashTextOpenWorldCreatorEditBaseStateV1,
  hashTextOpenWorldCreatorEditCandidateV1,
  hashTextOpenWorldCreatorEditIdentityDeltaV1,
  hashTextOpenWorldCreatorEditIntentV1,
  hashTextOpenWorldCreatorEditReferenceDeltaV1,
  hashTextOpenWorldCreatorEditValidationV1,
  hashTextOpenWorldCreatorEditWarningAcknowledgementV1,
  parseTextOpenWorldCreatorEditCandidateV1,
  parseTextOpenWorldCreatorEditIntentV1,
  parseTextOpenWorldCreatorEditPatchV1,
  parseTextOpenWorldCreatorEditTerminalReceiptV1,
  type TextOpenWorldCreatorEditCandidateV1,
  type TextOpenWorldCreatorEditIntentV1,
  type TextOpenWorldCreatorEditModelEvidenceV1,
  type TextOpenWorldCreatorEditModelUsageV1,
  type TextOpenWorldCreatorEditPatchOperationV1,
  type TextOpenWorldCreatorEditPatchV1,
  type TextOpenWorldCreatorEditRevisionProvenanceV1,
  type TextOpenWorldCreatorEditTerminalReceiptV1,
  type TextOpenWorldCreatorEditValidationV1,
} from './creator-artifact-edit-contract'
import {
  resolveTextOpenWorldCreatorEditWorkspaceV1,
  type TextOpenWorldCreatorEditTargetContextV1,
  type TextOpenWorldCreatorEditWorkspaceV1,
} from './creator-artifact-edit-context'
import {
  applyTextOpenWorldCreatorEditPatchToAuthorEditableDraftV1,
  projectTextOpenWorldCreatorAuthorEditableDraftV1,
  rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1,
} from './creator-artifact-edit-dispatch'

export const TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1 =
  'text-open-world:creator-artifact-edit'
export const TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_SKILL_ID_V1 =
  'text-open-world.creator-artifact-edit.v1'
export const TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_ENTRY_ID_V1 =
  'text-open-world.creator-artifact.modify'
export const TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_VERIFIER_SET_V1 =
  'text-open-world-creator-artifact-edit-terminal-v1'

const CONTEXT_SOURCE_KEY_V1 = 'text-open-world.creator-edit-target' as const
const MANUAL_SOURCE_KEY_V1 = 'manualText' as const
const HASH = /^[a-f0-9]{64}$/
const MAX_AUTHOR_INSTRUCTION = 8_000
const RUN_RELATION_PREFIX = 'creator-edit:'
const RUN_REPLACEMENT_SEPARATOR = ':replacement:'
const UNKNOWN_MODEL_OUTCOME_ABANDON_REASON =
  'author-abandoned-unknown-model-outcome-possible-charge-acknowledged'
const UNDISPATCHED_INTAKE_CANCEL_REASON =
  'author-cancelled-undispatched-creator-edit-intake'
const CREATOR_EDIT_OPERATION_TAILS = new Map<string, Promise<void>>()

export interface TextOpenWorldCreatorArtifactEditSelectionV1 {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  expectedSnapshotHash: string
  artifactKey: string
  entityIdentity: string | null
}

export type TextOpenWorldCreatorArtifactEditRunAI = (
  messages: ChatMessage[],
  signal?: AbortSignal,
) => Promise<string>

export type TextOpenWorldCreatorArtifactEditBoundaryV1 =
  | 'intake.checkpoint'
  | 'run.started'
  | 'context.recorded'
  | 'request.recorded'
  | 'model.requested'
  | 'model-result.recorded'
  | 'response.recorded'
  | 'model.responded'
  | 'candidate.checkpoint'
  | 'candidate.persisted'
  | 'candidate.revised'
  | 'intent.checkpoint'
  | 'confirmation.recorded'
  | 'verification.checkpoint'
  | 'verification.accepted'

interface CreatorEditEvidenceEnvelopeV1 {
  contextManifestHash: string
  contextArtifactHash: string
  requestArtifactHash: string | null
  modelResultArtifactHash: string | null
  responseArtifactHash: string | null
}

interface TextOpenWorldCreatorArtifactEditCheckpointBaseV1 {
  schema: 'storyforge.text-open-world-creator-edit-checkpoint'
  version: 1
  portable: false
  requestHash: string
}

export interface TextOpenWorldCreatorArtifactEditIntakeV1 {
  schema: 'storyforge.text-open-world-creator-edit-intake'
  version: 1
  portable: false
  mode: 'direct' | 'agent'
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
  patch: TextOpenWorldCreatorEditPatchV1 | null
  authorInstruction: string | null
  modelIdentity: CreatorEditModelIdentityV1
  runtimeBindingHash: string
  relation: string
  createdAt: number
  intakeHash: string
}

export type TextOpenWorldCreatorArtifactEditCheckpointV1 =
  | TextOpenWorldCreatorArtifactEditCheckpointBaseV1 & {
  phase: 'intake'
  intake: TextOpenWorldCreatorArtifactEditIntakeV1
  evidence: null
  candidate: null
  intent: null
  terminalReceipt: null
  verificationReceipt: null
  }
  | TextOpenWorldCreatorArtifactEditCheckpointBaseV1 & {
  phase: 'candidate'
  evidence: CreatorEditEvidenceEnvelopeV1
  candidate: TextOpenWorldCreatorEditCandidateV1
  intent: TextOpenWorldCreatorEditIntentV1 | null
  terminalReceipt: TextOpenWorldCreatorEditTerminalReceiptV1 | null
  verificationReceipt: VerificationReceiptV1 | null
  }
  | TextOpenWorldCreatorArtifactEditCheckpointBaseV1 & {
  phase: 'intent'
  evidence: CreatorEditEvidenceEnvelopeV1
  /** The authoritative candidate is intent.candidate; do not duplicate a large payload. */
  candidate: null
  intent: TextOpenWorldCreatorEditIntentV1
  terminalReceipt: TextOpenWorldCreatorEditTerminalReceiptV1
  verificationReceipt: VerificationReceiptV1
  }

export interface TextOpenWorldCreatorArtifactEditStateV1 {
  snapshot: AgentRunSnapshotV1
  checkpoint: Exclude<TextOpenWorldCreatorArtifactEditCheckpointV1, { phase: 'intake' }>
  candidate: TextOpenWorldCreatorEditCandidateV1
  intent: TextOpenWorldCreatorEditIntentV1 | null
  terminalReceipt: TextOpenWorldCreatorEditTerminalReceiptV1 | null
  verificationReceipt: VerificationReceiptV1 | null
}

export interface TextOpenWorldCreatorArtifactEditHandoffV1
  extends TextOpenWorldCreatorArtifactEditStateV1 {
  intent: TextOpenWorldCreatorEditIntentV1
  terminalReceipt: TextOpenWorldCreatorEditTerminalReceiptV1
  verificationReceipt: VerificationReceiptV1
}

export interface TextOpenWorldCreatorArtifactEditUnknownOutcomeBlockerV1 {
  kind: 'model-outcome-unknown'
  runId: number
  runState: 'running' | 'paused'
  ownerTaskKey: string
  message: string
  snapshot: AgentRunSnapshotV1
}

export interface TextOpenWorldCreatorArtifactEditIntakeBlockerV1 {
  kind: 'intake-ready'
  runId: number
  runState: 'planned' | 'running'
  mode: 'direct' | 'agent'
  ownerTaskKey: string
  message: string
  snapshot: AgentRunSnapshotV1
}

export interface TextOpenWorldCreatorArtifactEditImpactAnalysisBlockerV1 {
  kind: 'impact-analysis-pending'
  runId: number
  runState: 'running' | 'verifying' | 'completed'
  ownerTaskKey: string
  target: {
    artifactKey: string
    entityIdentity: string | null
  }
  message: string
  snapshot: AgentRunSnapshotV1
}

export type TextOpenWorldCreatorArtifactEditBlockerV1 =
  | TextOpenWorldCreatorArtifactEditUnknownOutcomeBlockerV1
  | TextOpenWorldCreatorArtifactEditIntakeBlockerV1
  | TextOpenWorldCreatorArtifactEditImpactAnalysisBlockerV1

export interface TextOpenWorldCreatorArtifactEditUnknownOutcomeAbandonInputV1 {
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
  runId: number
  /** Must be the literal true. The cancellation event durably records this acknowledgement. */
  acknowledgePossibleCharge: true
}

interface GenerationPreparedV1 {
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
  workspace: TextOpenWorldCreatorEditWorkspaceV1
  mode: 'direct' | 'agent'
  patch: TextOpenWorldCreatorEditPatchV1 | null
  authorInstruction: string | null
  sourceKeys: readonly string[]
  requestHash: string
  runtimeBindingHash: string
  relation: string
  modelIdentity: CreatorEditModelIdentityV1
  executionBinding: AgentSkillExecutionBindingV2 | null
  formalEntry: Awaited<ReturnType<typeof freezeFormalAIEntryBindingV1>> | null
  resolvedConfig: AIRequestConfigResolution | null
}

interface CreatorEditIntakeStateV1 {
  snapshot: AgentRunSnapshotV1
  checkpointRecord: VerifiedAgentRunCheckpointV1['checkpoint']
  checkpoint: Extract<TextOpenWorldCreatorArtifactEditCheckpointV1, { phase: 'intake' }>
  prepared: GenerationPreparedV1
}

interface CreatorEditStaticIntakeStateV1 {
  snapshot: AgentRunSnapshotV1
  checkpointRecord: VerifiedAgentRunCheckpointV1['checkpoint']
  checkpoint: Extract<TextOpenWorldCreatorArtifactEditCheckpointV1, { phase: 'intake' }>
}

interface CreatorEditLineageValidationContextV1 {
  visitingRunIds: Set<number>
  verifiedRunIds: Set<number>
}

interface FrozenCreatorEditAgentExecutionV1 {
  executionBinding: AgentSkillExecutionBindingV2
  formalEntry: AgentRunFormalAIEntryBindingV1
}

interface CreatorEditModelIdentityV1 {
  provider: string
  model: string
  endpointOrigin: string | null
  executionConfigHash: string | null
}

export class TextOpenWorldCreatorArtifactEditErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(`[text-open-world-creator-artifact-edit:${code}] ${message}`)
    this.name = 'TextOpenWorldCreatorArtifactEditErrorV1'
  }
}

class CreatorEditDurableBoundaryInterruptionV1 extends Error {
  constructor(readonly cause: unknown) {
    super('Creator edit durable boundary callback interrupted execution')
    this.name = 'CreatorEditDurableBoundaryInterruptionV1'
  }
}

function fail(code: string, message: string): never {
  throw new TextOpenWorldCreatorArtifactEditErrorV1(code, message)
}

function isConcurrentMutationError(cause: unknown): boolean {
  if (cause instanceof AgentRunStoreError && cause.code === 'sequence_conflict') return true
  if (!cause || typeof cause !== 'object') return false
  const code = (cause as { code?: unknown }).code
  return code === 'sequence-conflict' || code === 'sequence_conflict'
}

async function notifyBoundary(
  callback: ((
    boundary: TextOpenWorldCreatorArtifactEditBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>) | undefined,
  boundary: TextOpenWorldCreatorArtifactEditBoundaryV1,
  snapshot: AgentRunSnapshotV1,
): Promise<void> {
  if (!callback) return
  try {
    await callback(boundary, snapshot)
  } catch (cause) {
    throw new CreatorEditDurableBoundaryInterruptionV1(cause)
  }
}

/**
 * A creator edit may span several short IndexedDB transactions and, for Agent
 * mode, one provider request. Web Locks serialize that orchestration across
 * app tabs; the promise tail is the deterministic Node/test fallback. The
 * event store's unique sequence index remains the durable write authority.
 */
function withCreatorEditOperationLockV1<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockName = `storyforge:text-open-world:creator-edit:${key}`
  if (typeof navigator !== 'undefined' && navigator.locks) {
    const request = navigator.locks.request.bind(navigator.locks) as unknown as <R>(
      name: string,
      options: { mode: 'exclusive' },
      callback: () => Promise<R>,
    ) => Promise<R>
    return request<T>(lockName, { mode: 'exclusive' }, operation)
  }
  const prior = CREATOR_EDIT_OPERATION_TAILS.get(lockName) ?? Promise.resolve()
  const result = prior.then(operation, operation)
  const tail = result.then(() => undefined, () => undefined)
  CREATOR_EDIT_OPERATION_TAILS.set(lockName, tail)
  return result.finally(() => {
    if (CREATOR_EDIT_OPERATION_TAILS.get(lockName) === tail) {
      CREATOR_EDIT_OPERATION_TAILS.delete(lockName)
    }
  })
}

function runOperationLockKey(scope: WorkspaceScope, runId: number): string {
  return `run:${scope.projectId}:${scope.worldId}:${scope.workId}:${runId}`
}

function groupOperationLockKey(
  scope: WorkspaceScope,
  buildId: number,
  baseGroupHash: string,
): string {
  return `group:${scope.projectId}:${scope.worldId}:${scope.workId}:${buildId}:${baseGroupHash}`
}

function creatorEditRelationV1(requestHash: string, replacementRunId: number | null = null): string {
  if (!isSha256Hash(requestHash)) fail('run-binding', 'Creator edit request hash 无效')
  if (replacementRunId === null) return `${RUN_RELATION_PREFIX}${requestHash}`
  if (!Number.isSafeInteger(replacementRunId) || replacementRunId < 1) {
    fail('run-binding', 'Creator edit replacement Run 身份无效')
  }
  return `${RUN_RELATION_PREFIX}${requestHash}${RUN_REPLACEMENT_SEPARATOR}${replacementRunId}`
}

function parseCreatorEditRelationV1(relation: string | null | undefined): {
  requestHash: string
  replacementRunId: number | null
} {
  if (!relation?.startsWith(RUN_RELATION_PREFIX)) {
    fail('run-binding', 'Creator edit 缺少专属 parent relation')
  }
  const body = relation.slice(RUN_RELATION_PREFIX.length)
  const separatorIndex = body.indexOf(RUN_REPLACEMENT_SEPARATOR)
  const requestHash = separatorIndex < 0 ? body : body.slice(0, separatorIndex)
  const replacementText = separatorIndex < 0
    ? null
    : body.slice(separatorIndex + RUN_REPLACEMENT_SEPARATOR.length)
  if (!isSha256Hash(requestHash)
    || (replacementText !== null && !/^[1-9]\d*$/.test(replacementText))) {
    fail('run-binding', 'Creator edit parent relation 结构无效')
  }
  const replacementRunId = replacementText === null ? null : Number(replacementText)
  if (replacementRunId !== null && !Number.isSafeInteger(replacementRunId)) {
    fail('run-binding', 'Creator edit replacement Run 超出安全整数范围')
  }
  return { requestHash, replacementRunId }
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(right)
}

function assertSelection(input: TextOpenWorldCreatorArtifactEditSelectionV1): void {
  if (!Number.isSafeInteger(input.scope.projectId) || input.scope.projectId < 1
    || !Number.isSafeInteger(input.scope.worldId) || input.scope.worldId < 1
    || !Number.isSafeInteger(input.scope.workId) || input.scope.workId < 1
    || !Number.isSafeInteger(input.productionId) || input.productionId < 1
    || !Number.isSafeInteger(input.buildId) || input.buildId < 1
    || !input.artifactKey.trim()
    || (input.entityIdentity !== null && !input.entityIdentity.trim())
    || !isSha256Hash(input.expectedSnapshotHash)) {
    fail('selection', 'Creator edit 目标作用域、Build、Artifact、实体或快照无效')
  }
}

function assembleInput(selection: TextOpenWorldCreatorArtifactEditSelectionV1) {
  return {
    projectId: selection.scope.projectId,
    scope: selection.scope,
    worldGroupId: null,
    productProductionId: selection.productionId,
    productBuildId: selection.buildId,
    textOpenWorldCreatorEditArtifactKey: selection.artifactKey,
    textOpenWorldCreatorEditEntityIdentity: selection.entityIdentity,
    textOpenWorldCreatorEditExpectedSnapshotHash: selection.expectedSnapshotHash,
  }
}

export async function prepareTextOpenWorldCreatorArtifactEditV1(
  selection: TextOpenWorldCreatorArtifactEditSelectionV1,
): Promise<TextOpenWorldCreatorEditTargetContextV1> {
  assertSelection(selection)
  return (await resolveTextOpenWorldCreatorEditWorkspaceV1(assembleInput(selection))).targetContext
}

function appendRun<T extends Parameters<typeof appendAgentRunEventV1>[0]['type']>(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  type: T,
  payload: unknown,
): Promise<AgentRunSnapshotV1> {
  return appendAgentRunEventV1({
    scope,
    runId: snapshot.run.id,
    type,
    payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as Parameters<typeof appendAgentRunEventV1>[0])
}

function eventFor(
  snapshot: AgentRunSnapshotV1,
  type: AgentRunSnapshotV1['events'][number]['type'],
) {
  return snapshot.events.filter(event => event.type === type)
}

function exactArtifactEvent(
  snapshot: AgentRunSnapshotV1,
  kind: 'context-manifest' | 'rendered-request' | 'tool-result' | 'raw-response',
): Extract<AgentRunSnapshotV1['events'][number], { type: 'evidence.artifact.recorded' }> | null {
  const matches = snapshot.events.filter(
    (event): event is Extract<AgentRunSnapshotV1['events'][number], { type: 'evidence.artifact.recorded' }> => (
      event.type === 'evidence.artifact.recorded'
        && event.payload.stepId === TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1
        && event.payload.attempt === 1
        && event.payload.artifactKind === kind
    ),
  )
  if (matches.length > 1) fail('evidence', `${kind} 证据不唯一`)
  return matches[0] ?? null
}

interface CreatorEditModelResultArtifactV1 {
  schema: 'storyforge.text-open-world-creator-edit-model-result'
  version: 1
  provider: string
  model: string
  rawResponse: string
  responseContentHash: string
  usage: TextOpenWorldCreatorEditModelUsageV1
}

interface CreatorEditModelFailureArtifactV1 {
  schema: 'storyforge.text-open-world-creator-edit-model-failure'
  version: 1
  provider: string
  model: string
  phase: 'pre-dispatch' | 'response-observed'
  responseStatus: number | null
  failureCode: string
  retryable: boolean
  usageKnown: boolean
  usage: TextOpenWorldCreatorEditModelUsageV1 | null
}

interface CreatorEditRenderedRequestArtifactV1 {
  schema: 'storyforge.text-open-world-creator-edit-rendered-request'
  version: 1
  registeredContext: string
  authorInstruction: string
  messages: ChatMessage[]
  responseFormat: 'json_object'
}

async function createModelResultArtifactBody(input: {
  provider: string
  model: string
  rawResponse: string
  usage: TextOpenWorldCreatorEditModelUsageV1
}): Promise<CreatorEditModelResultArtifactV1> {
  return {
    schema: 'storyforge.text-open-world-creator-edit-model-result',
    version: 1,
    provider: input.provider,
    model: input.model,
    rawResponse: input.rawResponse,
    responseContentHash: await sha256Text(input.rawResponse),
    usage: input.usage,
  }
}

function parseModelUsageArtifactV1(value: unknown, label: string): TextOpenWorldCreatorEditModelUsageV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('model-result', `${label} usage 必须是对象`)
  }
  const usageRecord = value as Record<string, unknown>
  const usageKeys = ['modelCalls', 'inputTokens', 'outputTokens', 'costUsd', 'durationMs']
  const nonNegativeInteger = (item: unknown) => Number.isSafeInteger(item) && Number(item) >= 0
  if (Object.keys(usageRecord).sort().join() !== [...usageKeys].sort().join()
    || usageRecord.modelCalls !== 1
    || !nonNegativeInteger(usageRecord.inputTokens)
    || !nonNegativeInteger(usageRecord.outputTokens)
    || !nonNegativeInteger(usageRecord.durationMs)
    || (usageRecord.costUsd !== null
      && (typeof usageRecord.costUsd !== 'number'
        || !Number.isFinite(usageRecord.costUsd) || usageRecord.costUsd < 0))) {
    return fail('model-result', `${label} usage 无效`)
  }
  return usageRecord as unknown as TextOpenWorldCreatorEditModelUsageV1
}

function safeProviderUsageV1(value: unknown): { inputTokens: number; outputTokens: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const usage = value as Record<string, unknown>
  if (!Number.isSafeInteger(usage.inputTokens) || Number(usage.inputTokens) < 0
    || !Number.isSafeInteger(usage.outputTokens) || Number(usage.outputTokens) < 0) return null
  return { inputTokens: Number(usage.inputTokens), outputTokens: Number(usage.outputTokens) }
}

async function parseModelResultArtifactBody(
  value: string,
): Promise<CreatorEditModelResultArtifactV1> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return fail('model-result', '模型结果证据不是有效 JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('model-result', '模型结果证据必须是对象')
  }
  const row = parsed as Record<string, unknown>
  const keys = ['schema', 'version', 'provider', 'model', 'rawResponse', 'responseContentHash', 'usage']
  if (Object.keys(row).sort().join() !== [...keys].sort().join()
    || row.schema !== 'storyforge.text-open-world-creator-edit-model-result'
    || row.version !== 1
    || typeof row.provider !== 'string' || !row.provider
    || typeof row.model !== 'string' || !row.model
    || typeof row.rawResponse !== 'string'
    || !isSha256Hash(row.responseContentHash)) {
    return fail('model-result', '模型结果证据 schema/version/字段无效')
  }
  parseModelUsageArtifactV1(row.usage, '模型结果')
  const result = row as unknown as CreatorEditModelResultArtifactV1
  if (result.responseContentHash !== await sha256Text(result.rawResponse)) {
    return fail('model-result', '模型结果 rawResponse hash 不匹配')
  }
  return result
}

function parseModelFailureArtifactBody(value: string): CreatorEditModelFailureArtifactV1 {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return fail('model-result', '模型失败证据不是有效 JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('model-result', '模型失败证据必须是对象')
  }
  const row = parsed as Record<string, unknown>
  const keys = [
    'schema', 'version', 'provider', 'model', 'phase', 'responseStatus',
    'failureCode', 'retryable', 'usageKnown', 'usage',
  ]
  if (Object.keys(row).sort().join() !== [...keys].sort().join()
    || row.schema !== 'storyforge.text-open-world-creator-edit-model-failure'
    || row.version !== 1
    || typeof row.provider !== 'string' || !row.provider
    || typeof row.model !== 'string' || !row.model
    || (row.phase !== 'pre-dispatch' && row.phase !== 'response-observed')
    || (row.responseStatus !== null
      && (!Number.isSafeInteger(row.responseStatus)
        || Number(row.responseStatus) < 100 || Number(row.responseStatus) > 599))
    || typeof row.failureCode !== 'string' || !row.failureCode
    || typeof row.retryable !== 'boolean'
    || typeof row.usageKnown !== 'boolean'
    || (row.usageKnown ? row.usage === null : row.usage !== null)) {
    return fail('model-result', '模型失败证据 schema/version/字段无效')
  }
  const usage = row.usageKnown ? parseModelUsageArtifactV1(row.usage, '模型失败') : null
  return { ...(row as unknown as CreatorEditModelFailureArtifactV1), usage }
}

function retryableCreatorEditResponseStatusV1(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function assertModelFailureArtifactSemanticsV1(
  failure: CreatorEditModelFailureArtifactV1,
): void {
  if (failure.phase === 'pre-dispatch') {
    if (failure.responseStatus !== null
      || failure.failureCode !== 'creator-edit-model-not-dispatched'
      || failure.retryable || failure.usageKnown || failure.usage !== null) {
      fail('model-result', 'pre-dispatch 失败证据的状态、用量或失败码不精确')
    }
    return
  }
  const status = failure.responseStatus
  if (status === null
    || failure.failureCode !== `creator-edit-model-response-${status}`
    || failure.retryable !== retryableCreatorEditResponseStatusV1(status)
    || failure.usageKnown !== (failure.usage !== null)
    || (status >= 200 && status < 300 && !failure.usageKnown)) {
    fail('model-result', 'response-observed 失败证据的状态、重试语义或失败码不精确')
  }
}

function modelFailureCategoryV1(
  failure: CreatorEditModelFailureArtifactV1,
): 'protocol' | 'transient' | 'deterministic' {
  if (failure.phase === 'pre-dispatch') return 'deterministic'
  if (failure.retryable) return 'transient'
  const status = failure.responseStatus!
  return status < 200 || status >= 300 ? 'deterministic' : 'protocol'
}

function toolResultArtifactSchemaV1(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as { schema?: unknown }
    return typeof parsed?.schema === 'string' ? parsed.schema : null
  } catch {
    return null
  }
}

function parseRenderedRequestArtifactBody(
  value: string,
): CreatorEditRenderedRequestArtifactV1 {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return fail('evidence', 'rendered-request exact artifact 不是 JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('evidence', 'rendered-request exact artifact 必须是对象')
  }
  const row = parsed as Record<string, unknown>
  const keys = [
    'schema', 'version', 'registeredContext', 'authorInstruction', 'messages', 'responseFormat',
  ]
  if (Object.keys(row).sort().join() !== [...keys].sort().join()
    || row.schema !== 'storyforge.text-open-world-creator-edit-rendered-request'
    || row.version !== 1 || row.responseFormat !== 'json_object'
    || typeof row.registeredContext !== 'string' || !row.registeredContext
    || typeof row.authorInstruction !== 'string' || !row.authorInstruction
    || !Array.isArray(row.messages)) {
    return fail('evidence', 'rendered-request exact artifact schema/version/字段无效')
  }
  const messages: ChatMessage[] = row.messages.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return fail('evidence', `rendered-request.messages[${index}] 必须是对象`)
    }
    const message = value as Record<string, unknown>
    if (Object.keys(message).sort().join() !== ['content', 'role'].join()
      || !['system', 'user', 'assistant'].includes(String(message.role))
      || typeof message.content !== 'string') {
      return fail('evidence', `rendered-request.messages[${index}] 字段无效`)
    }
    return { role: message.role as ChatMessage['role'], content: message.content }
  })
  const expectedMessages = buildTextOpenWorldCreatorArtifactEditMessagesV1({
    registeredContext: row.registeredContext,
    authorInstruction: row.authorInstruction,
  })
  if (!sameJson(messages, expectedMessages)) {
    return fail('evidence', 'rendered-request messages 不能由已登记 Context 与作者要求精确重建')
  }
  return {
    schema: 'storyforge.text-open-world-creator-edit-rendered-request',
    version: 1,
    registeredContext: row.registeredContext,
    authorInstruction: row.authorInstruction,
    messages,
    responseFormat: 'json_object',
  }
}

async function assertSingleModelRequestEvidenceV1(input: {
  snapshot: AgentRunSnapshotV1
  requestEvent: NonNullable<ReturnType<typeof exactArtifactEvent>>
}): Promise<Extract<AgentRunSnapshotV1['events'][number], { type: 'model.requested' }>> {
  const requested = eventFor(input.snapshot, 'model.requested')
  if (requested.length !== 1 || requested[0]!.type !== 'model.requested') {
    fail('model-evidence', '已知模型结果缺少唯一 model.requested')
  }
  const runtimeBindingHash = input.snapshot.contract.runtimeBindingHash
    ?? fail('model-evidence', '已知模型结果缺少 runtime binding hash')
  const requestBindingHash = await hashCanonicalValue({
    runtimeBindingHash,
    requestArtifactHash: input.requestEvent.payload.contentHash,
    executionBinding: input.snapshot.contract.executionBindings?.[0],
  })
  if (requested[0]!.payload.stepId !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1
    || requested[0]!.payload.attempt !== 1
    || requested[0]!.payload.bindingHash !== requestBindingHash
    || input.requestEvent.sequence >= requested[0]!.sequence) {
    fail('model-evidence', '模型请求绑定或 durable 事件顺序不一致')
  }
  return requested[0]!
}

async function assertKnownModelRequestEvidenceV1(input: {
  snapshot: AgentRunSnapshotV1
  requestEvent: NonNullable<ReturnType<typeof exactArtifactEvent>>
  resultEvent: NonNullable<ReturnType<typeof exactArtifactEvent>>
}): Promise<void> {
  const requested = await assertSingleModelRequestEvidenceV1(input)
  if (requested.sequence >= input.resultEvent.sequence) {
    fail('model-evidence', '已知模型结果没有发生在唯一模型请求之后')
  }
}

function contextFieldValue(
  context: TextOpenWorldCreatorEditTargetContextV1,
  fieldId: string,
): unknown {
  const field = context.semanticDraft.fields.find(item => item.fieldId === fieldId)
  if (!field) fail('field', `目标上下文没有字段 ${fieldId}`)
  return structuredClone(field.value)
}

function sourceSegment(
  assembled: Awaited<ReturnType<typeof assembleContext>>,
  key: string,
): string {
  const index = assembled.included.indexOf(key)
  const segment = index < 0 ? undefined : assembled.segments[index]
  if (!segment) fail('context', `登记 Context 未完整包含 ${key}`)
  return segment.content
}

function normalizeInstruction(value: string | undefined): string {
  const normalized = (value ?? '').trim().normalize('NFC')
  if (!normalized || normalized.length > MAX_AUTHOR_INSTRUCTION) {
    fail('instruction', `Agent 修改要求必须是 1-${MAX_AUTHOR_INSTRUCTION} 字符`)
  }
  return normalized
}

async function prepareGeneration(input: {
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
  mode: 'direct' | 'agent'
  operations?: readonly TextOpenWorldCreatorEditPatchOperationV1[]
  authorInstruction?: string
  aiConfig?: AIConfig
  runAI?: TextOpenWorldCreatorArtifactEditRunAI
  modelIdentity?: { provider: string; model: string }
  modelExecutionIdentity?: CreatorEditModelIdentityV1
  /** Internal recovery path: reuse the Run's immutable binding, never the live registry. */
  frozenAgentExecution?: FrozenCreatorEditAgentExecutionV1
}): Promise<GenerationPreparedV1> {
  assertSelection(input.selection)
  const workspace = await resolveTextOpenWorldCreatorEditWorkspaceV1(assembleInput(input.selection))
  let patch: TextOpenWorldCreatorEditPatchV1 | null = null
  let authorInstruction: string | null = null
  let executionBinding: GenerationPreparedV1['executionBinding'] = null
  let formalEntry: GenerationPreparedV1['formalEntry'] = null
  let resolvedConfig: AIRequestConfigResolution | null = null
  let modelIdentity: CreatorEditModelIdentityV1 = {
    provider: 'none',
    model: 'deterministic-direct-edit',
    endpointOrigin: null,
    executionConfigHash: null,
  }
  let requestPayloadHash: string
  const sourceKeys: readonly string[] = input.mode === 'agent'
    ? [CONTEXT_SOURCE_KEY_V1, MANUAL_SOURCE_KEY_V1]
    : [CONTEXT_SOURCE_KEY_V1]

  if (input.mode === 'direct') {
    patch = await createTextOpenWorldCreatorEditPatchV1({
      baseDraftHash: workspace.targetContext.baseDraftHash,
      operations: input.operations ?? [],
    })
    requestPayloadHash = patch.patchHash
  } else {
    authorInstruction = normalizeInstruction(input.authorInstruction)
    if (!input.runAI && typeof window !== 'undefined' && !navigator.locks) {
      fail(
        'cross-context-lock-unavailable',
        '当前浏览器不支持跨标签页执行锁；为避免重复调用或丢失已计费结果，已禁用 Agent 修改',
      )
    }
    if (input.frozenAgentExecution) {
      const frozen = await assertFrozenCreatorEditAgentExecutionV1(input.frozenAgentExecution)
      executionBinding = frozen.executionBinding
      formalEntry = frozen.formalEntry
    } else {
      const skill = getAgentSkillV1(TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_SKILL_ID_V1)
      executionBinding = await createAgentSkillExecutionBindingV2(skill, { writeTargets: [] })
      formalEntry = await freezeFormalAIEntryBindingV1(
        TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_ENTRY_ID_V1,
      )
      await assertFrozenCreatorEditAgentExecutionV1({ executionBinding, formalEntry })
    }
    if (input.runAI) {
      const injected = input.modelIdentity ?? { provider: 'test-adapter', model: 'injected' }
      const injectedIdentity: CreatorEditModelIdentityV1 = {
        ...injected,
        endpointOrigin: 'injected-runner',
        executionConfigHash: await hashProductProductionValueV2({
          schema: 'storyforge.text-open-world-creator-edit-injected-runner',
          version: 1,
          provider: injected.provider,
          model: injected.model,
        }),
      }
      if (input.modelExecutionIdentity
        && (input.modelExecutionIdentity.provider !== injected.provider
          || input.modelExecutionIdentity.model !== injected.model)) {
        fail('model-binding', '内部冻结执行身份与模型 provider/model 不一致')
      }
      modelIdentity = input.modelExecutionIdentity ?? injectedIdentity
    } else {
      if (!input.aiConfig) fail('ai-config', 'Agent 修改缺少 AI 配置；可改用直接修改')
      resolvedConfig = resolveRequestConfig(input.aiConfig, {
        category: 'authoring.text-open-world-creator-artifact-edit',
        projectId: input.selection.scope.projectId,
        configOverrides: { maxTokens: executionBinding.maxOutputTokens },
        contextOverflowPolicy: 'reject',
      })
      if (!isAIConfigReady(resolvedConfig.config)) {
        fail('ai-config', getAIConfigRequiredMessage(resolvedConfig.config))
      }
      const identity = await createConfiguredTextProviderExecutionIdentityV1(resolvedConfig.config)
      modelIdentity = {
        provider: identity.provider,
        model: identity.model,
        endpointOrigin: identity.endpointOrigin,
        executionConfigHash: identity.executionConfigHash,
      }
    }
    requestPayloadHash = await hashProductProductionValueV2({ authorInstruction })
  }
  const runtimeBindingHash = await hashProductProductionValueV2({
    schema: 'storyforge.text-open-world-creator-edit-runtime-binding',
    version: 1,
    mode: input.mode,
    productionId: input.selection.productionId,
    buildId: input.selection.buildId,
    governanceSnapshotHash: input.selection.expectedSnapshotHash,
    target: workspace.targetContext.target,
    baseDraftHash: workspace.targetContext.baseDraftHash,
    baseGroupHash: workspace.targetContext.ownerSiblingGroup.baseGroupHash,
    producerReceiptHash: workspace.targetContext.producerEvidence.terminalReceiptHash,
    requestPayloadHash,
    sourceKeys,
    modelIdentity,
    executionBinding,
    formalEntry,
  })
  const requestHash = await hashProductProductionValueV2({
    schema: 'storyforge.text-open-world-creator-edit-request',
    version: 1,
    runtimeBindingHash,
    requestPayloadHash,
  })
  return {
    selection: input.selection,
    workspace,
    mode: input.mode,
    patch,
    authorInstruction,
    sourceKeys,
    requestHash,
    runtimeBindingHash,
    relation: creatorEditRelationV1(requestHash),
    modelIdentity,
    executionBinding,
    formalEntry,
    resolvedConfig,
  }
}

async function createCreatorEditIntakeV1(
  prepared: GenerationPreparedV1,
  createdAt = Date.now(),
): Promise<TextOpenWorldCreatorArtifactEditIntakeV1> {
  const body: Omit<TextOpenWorldCreatorArtifactEditIntakeV1, 'intakeHash'> = {
    schema: 'storyforge.text-open-world-creator-edit-intake',
    version: 1,
    portable: false,
    mode: prepared.mode,
    selection: structuredClone(prepared.selection),
    patch: prepared.patch ? structuredClone(prepared.patch) : null,
    authorInstruction: prepared.authorInstruction,
    modelIdentity: structuredClone(prepared.modelIdentity),
    runtimeBindingHash: prepared.runtimeBindingHash,
    relation: prepared.relation,
    createdAt,
  }
  return { ...body, intakeHash: await hashProductProductionValueV2(body) }
}

function creatorEditContractFromFacts(input: {
  projectId: number
  target: TextOpenWorldCreatorEditCandidateV1['target']
  producerEvidence: TextOpenWorldCreatorEditCandidateV1['producerEvidence']
  ownerSiblingGroup: TextOpenWorldCreatorEditCandidateV1['ownerSiblingGroup']
  productBuildId: number
  buildNumber: number
  controlEpoch: number
  planHash: string
  relation: string
  sourceKeys: readonly string[]
  runtimeBindingHash: string
  mode: 'direct' | 'agent'
  executionBinding: GenerationPreparedV1['executionBinding']
  formalEntry: GenerationPreparedV1['formalEntry']
}) {
  const common = {
    objective: `为 ${input.target.artifactKey}${input.target.entityIdentity ? ` / ${input.target.entityIdentity}` : ''} 形成受治理修改候选`,
    workflowKind: 'generate-verify-revise' as const,
    lineage: {
      parent: {
        runId: input.producerEvidence.runId,
        receiptHash: input.producerEvidence.terminalReceiptHash,
        relation: input.relation,
        artifactHash: input.ownerSiblingGroup.baseGroupHash,
      },
    },
    scope: {
      projectId: input.projectId,
      worldGroupId: null,
      productProduction: {
        productBuildId: input.productBuildId,
        buildNumber: input.buildNumber,
        controlEpoch: input.controlEpoch,
        planHash: input.planHash,
        taskKey: `creator-edit:${input.ownerSiblingGroup.ownerTaskKey}`,
      },
    },
    permissions: { contextSourceKeys: [...input.sourceKeys], writeTargets: [] },
    runtimeBindingHash: input.runtimeBindingHash,
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 64_000,
      maxOutputTokens: input.mode === 'agent' ? input.executionBinding?.maxOutputTokens ?? 0 : 1,
      maxAttemptsPerStep: 1,
    },
    acceptance: [
      { id: 'candidate-integrity', kind: 'deterministic-check' as const, required: true },
      { id: 'domain-validation', kind: 'gate-passed' as const, required: true },
      { id: 'author-confirmation', kind: 'author-confirmed' as const, required: true },
      { id: 'base-unchanged', kind: 'deterministic-check' as const, required: true },
      { id: 'impact-plan-handoff', kind: 'output-present' as const, required: true },
    ],
    verificationPlan: [{
      id: 'creator-artifact-edit.terminal',
      kind: 'terminal' as const,
      verifier: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_VERIFIER_SET_V1,
      criterionIds: [
        'candidate-integrity',
        'domain-validation',
        'author-confirmation',
        'base-unchanged',
        'impact-plan-handoff',
      ],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'revise' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
  if (input.mode === 'agent') {
    if (!input.executionBinding || !input.formalEntry) {
      fail('run-contract', 'Agent Creator edit 契约缺少冻结 Skill 或正式入口绑定')
    }
    return {
      ...common,
      version: 2 as const,
      executionBindings: [{
        stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
        ...input.executionBinding,
        formalEntry: input.formalEntry,
      }],
    }
  }
  if (input.executionBinding || input.formalEntry) {
    fail('run-contract', '直接修改不得携带模型执行绑定')
  }
  return { ...common, version: 1 as const }
}

function creatorEditContract(prepared: GenerationPreparedV1) {
  const context = prepared.workspace.targetContext
  return creatorEditContractFromFacts({
    projectId: prepared.selection.scope.projectId,
    target: context.target,
    producerEvidence: context.producerEvidence,
    ownerSiblingGroup: context.ownerSiblingGroup,
    productBuildId: context.build.id,
    buildNumber: context.build.buildNumber,
    controlEpoch: context.build.controlEpoch,
    planHash: context.build.planHash,
    relation: prepared.relation,
    sourceKeys: prepared.sourceKeys,
    runtimeBindingHash: prepared.runtimeBindingHash,
    mode: prepared.mode,
    executionBinding: prepared.executionBinding,
    formalEntry: prepared.formalEntry,
  })
}

async function assertCreatorEditModelInputEvidenceV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  requestEvent: NonNullable<ReturnType<typeof exactArtifactEvent>>
  intakeState: Pick<CreatorEditIntakeStateV1, 'checkpoint' | 'prepared'>
}): Promise<{
  manifest: ReturnType<typeof parseContextManifestV1>
  renderedRequest: CreatorEditRenderedRequestArtifactV1
}> {
  const contextArtifact = exactArtifactEvent(input.snapshot, 'context-manifest')
    ?? fail('model-input-evidence', 'Creator edit 缺少唯一 context-manifest artifact event')
  const contextEvents = eventFor(input.snapshot, 'context.assembled')
  if (contextEvents.length !== 1 || contextEvents[0]!.type !== 'context.assembled'
    || contextEvents[0]!.payload.stepId !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1
    || contextEvents[0]!.payload.attempt !== 1
    || !(contextArtifact.sequence < contextEvents[0]!.sequence
      && contextEvents[0]!.sequence < input.requestEvent.sequence)) {
    fail('model-input-evidence', 'ContextManifest artifact、context.assembled 或请求顺序不闭合')
  }
  const [manifestText, requestText] = await Promise.all([
    readAgentRunArtifactExactV1({
      projectId: input.scope.projectId,
      artifactKind: 'context-manifest',
      contentHash: contextArtifact.payload.contentHash,
    }),
    readAgentRunArtifactExactV1({
      projectId: input.scope.projectId,
      artifactKind: 'rendered-request',
      contentHash: input.requestEvent.payload.contentHash,
    }),
  ])
  let manifestValue: unknown
  try {
    manifestValue = JSON.parse(manifestText)
  } catch {
    fail('model-input-evidence', 'ContextManifest exact artifact 不是 JSON')
  }
  const manifest = parseContextManifestV1(manifestValue)
  if (!await verifyContextManifestIntegrityV1(manifest)
    || manifest.manifestHash !== contextEvents[0]!.payload.manifestHash
    || manifest.runId !== input.snapshot.run.id
    || manifest.stepId !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1
    || manifest.attempt !== 1
    || manifest.scope.projectId !== input.snapshot.run.projectId
    || manifest.scope.worldGroupId !== (input.snapshot.run.worldGroupId ?? null)
    || manifest.inputBudget > input.snapshot.contract.budget.maxInputTokens
    || manifest.totalInputTokens > input.snapshot.contract.budget.maxInputTokens
    || !sameJson(
      manifest.sources.map(source => source.key),
      input.snapshot.contract.permissions.contextSourceKeys,
    )
    || manifest.sources.some(source => source.status !== 'included')) {
    fail('model-input-evidence', 'ContextManifest 正文、Run、来源或预算证据不闭合')
  }
  const renderedRequest = parseRenderedRequestArtifactBody(requestText)
  const contextSource = manifest.sources.find(source => source.key === CONTEXT_SOURCE_KEY_V1)
  const instructionSource = manifest.sources.find(source => source.key === MANUAL_SOURCE_KEY_V1)
  const intake = input.intakeState.checkpoint.intake
  const requestSelection = recoverySelectionFromRenderedContextV1({
    scope: input.scope,
    renderedRequest,
  })
  if (contextSource?.contentHash !== await sha256Text(renderedRequest.registeredContext)
    || instructionSource?.contentHash !== await sha256Text(renderedRequest.authorInstruction)
    || renderedRequest.registeredContext
      !== canonicalProductProductionJsonV2(input.intakeState.prepared.workspace.targetContext)
    || renderedRequest.authorInstruction !== intake.authorInstruction
    || !sameJson(requestSelection, intake.selection)) {
    fail('model-input-evidence', 'rendered-request 正文与 ContextManifest 或冻结 intake 不一致')
  }
  return { manifest, renderedRequest }
}

function isExplicitlyAbandonedUnknownModelRunV1(snapshot: AgentRunSnapshotV1): boolean {
  const cancelled = eventFor(snapshot, 'run.cancelled')
  return snapshot.projection.state === 'cancelled'
    && snapshot.projection.memorySettlement?.state === 'incomplete'
    && cancelled.length === 1
    && cancelled[0]!.type === 'run.cancelled'
    && cancelled[0]!.payload.reason === UNKNOWN_MODEL_OUTCOME_ABANDON_REASON
    && eventFor(snapshot, 'model.requested').length === 1
    && exactArtifactEvent(snapshot, 'tool-result') === null
    && exactArtifactEvent(snapshot, 'raw-response') === null
    && eventFor(snapshot, 'model.responded').length === 0
}

function isExplicitlyCancelledUndispatchedIntakeV1(snapshot: AgentRunSnapshotV1): boolean {
  const cancelled = eventFor(snapshot, 'run.cancelled')
  return snapshot.projection.state === 'cancelled'
    && snapshot.projection.memorySettlement?.state === 'incomplete'
    && cancelled.length === 1
    && cancelled[0]!.type === 'run.cancelled'
    && cancelled[0]!.payload.reason === UNDISPATCHED_INTAKE_CANCEL_REASON
    && eventFor(snapshot, 'model.requested').length === 0
    && exactArtifactEvent(snapshot, 'tool-result') === null
    && exactArtifactEvent(snapshot, 'raw-response') === null
    && eventFor(snapshot, 'model.responded').length === 0
}

async function isExplicitlyReplaceableCreatorEditRunV1(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  lineageContext?: CreatorEditLineageValidationContextV1,
): Promise<boolean> {
  if (!['failed', 'cancelled'].includes(snapshot.projection.state)) return false
  try {
    await verifyRecordedMemorySettlementV1({ snapshot, scope })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    fail('replacement-evidence', `Creator edit 终态不能安全替换：${message}`)
  }
  if (isExplicitlyCancelledUndispatchedIntakeV1(snapshot)) {
    const intakeState = await readCreatorEditStaticIntakeStateV1(scope, snapshot.run.id)
      ?? fail('replacement-evidence', '未派发 Creator edit 取消终态缺少原始 intake')
    if (intakeState.snapshot.projection.lastCheckpointHash
      !== intakeState.checkpointRecord.checkpointHash) {
      fail('replacement-evidence', '未派发 Creator edit 取消终态没有绑定最新 intake checkpoint')
    }
    return true
  }
  if (isExplicitlyAbandonedUnknownModelRunV1(snapshot)) {
    const intakeState = await readCreatorEditIntakeStateV1(
      scope,
      snapshot.run.id,
      lineageContext,
    )
      ?? fail('replacement-evidence', '结果未知的 Creator edit 终态缺少原始 intake')
    await assertUnknownModelOutcomeRunBindingV1({
      scope,
      snapshot,
      workspace: intakeState.prepared.workspace,
      verifyLineage: false,
    })
    await assertUnknownModelRequestMatchesIntakeV1({ scope, snapshot, intakeState })
    return true
  }
  const failed = eventFor(snapshot, 'run.failed')
  if (snapshot.projection.state === 'failed'
    && failed.length === 1 && failed[0]!.type === 'run.failed') {
    const intakeState = await readCreatorEditIntakeStateV1(
      scope,
      snapshot.run.id,
      lineageContext,
    )
      ?? fail('replacement-evidence', 'Creator edit 失败终态缺少可验证的原始 intake')
    const stepFailed = eventFor(snapshot, 'step.failed')
    if (stepFailed.length !== 1 || stepFailed[0]!.type !== 'step.failed'
      || stepFailed[0]!.payload.stepId !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1
      || stepFailed[0]!.payload.attempt !== 1
      || stepFailed[0]!.payload.code !== failed[0]!.payload.code
      || stepFailed[0]!.payload.retryable !== failed[0]!.payload.retryable
      || stepFailed[0]!.payload.action !== 'fail') {
      fail('replacement-evidence', 'Creator edit 失败 Run 的 step/run 终态不一致')
    }
    const requested = eventFor(snapshot, 'model.requested')
    const result = exactArtifactEvent(snapshot, 'tool-result')
    const response = exactArtifactEvent(snapshot, 'raw-response')
    const responded = eventFor(snapshot, 'model.responded')
    if (requested.length === 0) {
      if (result || response || responded.length
        || failed[0]!.payload.code !== 'creator-edit-generation-failed'
        || failed[0]!.payload.retryable) {
        fail('replacement-evidence', '无模型请求的 Creator edit 失败不满足确定性替换条件')
      }
      return true
    }
    const request = exactArtifactEvent(snapshot, 'rendered-request')
      ?? fail('replacement-evidence', '模型失败 Run 缺少 rendered-request')
    if (requested.length !== 1 || !result) {
      fail('replacement-evidence', '模型失败 Run 缺少唯一 request/result')
    }
    await assertKnownModelRequestEvidenceV1({ snapshot, requestEvent: request, resultEvent: result })
    const [, resultText] = await Promise.all([
      assertCreatorEditModelInputEvidenceV1({
        scope,
        snapshot,
        requestEvent: request,
        intakeState,
      }),
      readAgentRunArtifactExactV1({
        projectId: scope.projectId,
        artifactKind: 'tool-result',
        contentHash: result.payload.contentHash,
      }),
    ])
    if (toolResultArtifactSchemaV1(resultText)
      === 'storyforge.text-open-world-creator-edit-model-failure') {
      if (response || responded.length) {
        fail('replacement-evidence', '模型失败 Artifact 不得同时携带成功响应事件')
      }
      const failure = parseModelFailureArtifactBody(resultText)
      assertModelFailureArtifactSemanticsV1(failure)
      if (failure.provider !== intakeState.checkpoint.intake.modelIdentity.provider
        || failure.model !== intakeState.checkpoint.intake.modelIdentity.model
        || failure.failureCode !== failed[0]!.payload.code
        || failure.retryable !== failed[0]!.payload.retryable
        || stepFailed[0]!.payload.category !== modelFailureCategoryV1(failure)
        || (failure.usage && (
          failure.usage.inputTokens > snapshot.contract.budget.maxInputTokens
          || failure.usage.outputTokens > snapshot.contract.budget.maxOutputTokens
        ))) {
        fail('replacement-evidence', '模型失败 Artifact、预算与终态事件不一致')
      }
      return true
    }
    if (!response || responded.length !== 1 || responded[0]!.type !== 'model.responded'
      || failed[0]!.payload.code !== 'creator-edit-model-output-unusable'
      || failed[0]!.payload.retryable
      || stepFailed[0]!.payload.category !== 'protocol') {
      fail('replacement-evidence', '不可用模型输出的响应或终态形态不精确')
    }
    const durableResult = await parseModelResultArtifactBody(resultText)
    const raw = await readAgentRunArtifactExactV1({
      projectId: scope.projectId,
      artifactKind: 'raw-response',
      contentHash: response.payload.contentHash,
    })
    if (durableResult.provider !== intakeState.checkpoint.intake.modelIdentity.provider
      || durableResult.model !== intakeState.checkpoint.intake.modelIdentity.model
      || durableResult.rawResponse !== raw
      || durableResult.responseContentHash !== response.payload.contentHash
      || responded[0]!.payload.outputHash !== response.payload.contentHash
      || !(result.sequence < response.sequence && response.sequence < responded[0]!.sequence)) {
      fail('replacement-evidence', '不可用模型输出的 tool-result/raw-response/responded 不闭合')
    }
    let provenUnusable = durableResult.usage.inputTokens > snapshot.contract.budget.maxInputTokens
      || durableResult.usage.outputTokens > snapshot.contract.budget.maxOutputTokens
    if (!provenUnusable) {
      try {
        const parsed = parseTextOpenWorldCreatorArtifactEditModelOutputV1(
          raw,
          intakeState.prepared.workspace.targetContext.editableFields,
        )
        await createTextOpenWorldCreatorEditPatchV1({
          baseDraftHash: intakeState.prepared.workspace.targetContext.baseDraftHash,
          operations: parsed.operations,
        })
      } catch {
        provenUnusable = true
      }
    }
    if (!provenUnusable) {
      fail('replacement-evidence', '模型输出可以形成合法 Patch，不得伪装为不可用后再次付费')
    }
    return true
  }
  const cancelled = eventFor(snapshot, 'run.cancelled')
  const authorRejected = snapshot.projection.state === 'cancelled'
    && cancelled.length === 1
    && cancelled[0]!.type === 'run.cancelled'
    && cancelled[0]!.payload.reason === 'author-rejected-creator-edit-candidate'
  if (!authorRejected) return false
  const state = await readState(scope, snapshot.run.id, lineageContext)
    ?? fail('replacement-evidence', '作者拒绝终态缺少原始候选 checkpoint')
  const confirmations = eventFor(snapshot, 'confirmation.recorded')
  const step = snapshot.projection.steps[TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1]
  if (state.checkpoint.phase !== 'candidate'
    || confirmations.length !== 1 || confirmations[0]!.type !== 'confirmation.recorded'
    || confirmations[0]!.payload.stepId !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1
    || confirmations[0]!.payload.candidateHash !== state.candidate.candidateHash
    || confirmations[0]!.payload.decision !== 'reject'
    || step?.confirmation !== 'reject'
    || confirmations[0]!.sequence >= cancelled[0]!.sequence) {
    fail('replacement-evidence', '作者拒绝终态的候选、确认与取消事件不闭合')
  }
  return true
}

async function createOrReadRun(prepared: GenerationPreparedV1): Promise<{
  snapshot: AgentRunSnapshotV1
  prepared: GenerationPreparedV1
}> {
  const parentRunId = prepared.workspace.targetContext.producerEvidence.runId
  let relation = creatorEditRelationV1(prepared.requestHash)
  for (let replacementDepth = 0; replacementDepth < 64; replacementDepth += 1) {
    const effective = relation === prepared.relation ? prepared : { ...prepared, relation }
    const existing = await readAgentRunChildV1({
      scope: prepared.selection.scope,
      parentRunId,
      relation,
    })
    if (existing) {
      if (existing.contract.runtimeBindingHash !== prepared.runtimeBindingHash) {
        fail('duplicate-binding', '相同修改请求已存在，但运行绑定不一致')
      }
      if (await isExplicitlyReplaceableCreatorEditRunV1(prepared.selection.scope, existing)) {
        relation = creatorEditRelationV1(prepared.requestHash, existing.run.id)
        continue
      }
      return { snapshot: existing, prepared: effective }
    }
    try {
      const snapshot = await createAgentRunV1({
        scope: prepared.selection.scope,
        worldGroupId: null,
        productBuildId: prepared.selection.buildId,
        contract: creatorEditContract(effective),
      })
      return { snapshot, prepared: effective }
    } catch (cause) {
      const raced = await readAgentRunChildV1({
        scope: prepared.selection.scope,
        parentRunId,
        relation,
      })
      if (raced?.contract.runtimeBindingHash === prepared.runtimeBindingHash) {
        if (await isExplicitlyReplaceableCreatorEditRunV1(prepared.selection.scope, raced)) {
          relation = creatorEditRelationV1(prepared.requestHash, raced.run.id)
          continue
        }
        return { snapshot: raced, prepared: effective }
      }
      throw cause
    }
  }
  fail('replacement-depth', '同一 Creator edit 请求的显式 replacement 链超过安全上限')
}

async function ensureRunStarted(
  scope: WorkspaceScope,
  initial: AgentRunSnapshotV1,
): Promise<AgentRunSnapshotV1> {
  let snapshot = initial
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const step = snapshot.projection.steps[TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1]
    try {
      if (!step) {
        snapshot = await appendRun(scope, snapshot, 'step.scheduled', {
          stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
        })
        continue
      }
      if (step.status === 'scheduled') {
        snapshot = await appendRun(scope, snapshot, 'step.started', {
          stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
          attempt: 1,
        })
      }
      return snapshot
    } catch {
      snapshot = await readAgentRunV1(scope, snapshot.run.id)
      if (snapshot.projection.steps[TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1]
        && snapshot.projection.state !== 'planned') continue
      throw new Error('Creator edit Run 无法进入唯一执行步骤')
    }
  }
  return readAgentRunV1(scope, snapshot.run.id)
}

async function buildCandidate(input: {
  workspace: TextOpenWorldCreatorEditWorkspaceV1
  patch: TextOpenWorldCreatorEditPatchV1
  mode: 'direct' | 'agent'
  modelEvidence: TextOpenWorldCreatorEditModelEvidenceV1 | null
  modelUsage: TextOpenWorldCreatorEditModelUsageV1
  revisionProvenance?: TextOpenWorldCreatorEditRevisionProvenanceV1 | null
  createdAt?: number
}): Promise<TextOpenWorldCreatorEditCandidateV1> {
  const context = input.workspace.targetContext
  const projected = await projectTextOpenWorldCreatorAuthorEditableDraftV1({
    taskKey: context.ownerSiblingGroup.ownerTaskKey,
    artifacts: input.workspace.baseArtifacts.map(artifact => ({
      artifactKey: artifact.artifactKey,
      payload: artifact.payload,
    })),
    context: input.workspace.taskContext,
    target: {
      artifactKey: context.target.artifactKey,
      entityIdentity: context.target.entityIdentity,
    },
  })
  if (projected.draftHash !== context.baseDraftHash
    || projected.stableStructureHash !== input.workspace.stableStructureHash
    || !sameJson(projected.editableFields, context.editableFields)) {
    fail('projection-stale', '领域投影与登记目标 Context 不一致')
  }
  const applied = await applyTextOpenWorldCreatorEditPatchToAuthorEditableDraftV1({
    draft: input.workspace.fullDraft,
    draftHash: context.baseDraftHash,
    editableFields: context.editableFields,
    patch: input.patch,
  })
  const rebuilt = await rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1({
    taskKey: context.ownerSiblingGroup.ownerTaskKey,
    baseArtifacts: input.workspace.baseArtifacts.map(artifact => ({
      artifactKey: artifact.artifactKey,
      payload: artifact.payload,
    })),
    context: input.workspace.taskContext,
    draft: applied.draft,
  })
  const rebuiltArtifacts = await Promise.all(rebuilt.artifacts.map(async artifact => {
    const base = input.workspace.baseArtifacts.find(row => row.artifactKey === artifact.artifactKey)
      ?? fail('sibling', `重建结果出现非 sibling Artifact:${artifact.artifactKey}`)
    const payload = JSON.parse(canonicalProductProductionJsonV2(artifact.payload))
    return {
      schema: 'storyforge.text-open-world-creator-edit-rebuilt-artifact' as const,
      version: 1 as const,
      artifactKey: artifact.artifactKey,
      requirementKey: base.requirementKey,
      kind: artifact.artifactKey,
      baseVersion: base.version,
      nextVersion: base.version + 1,
      baseContentHash: base.contentHash,
      contentHash: await hashProductProductionValueV2(payload),
      payload,
      metadata: structuredClone(base.metadata),
      quality: structuredClone(base.quality),
      rights: structuredClone(base.rights),
      byteSize: new TextEncoder().encode(canonicalProductProductionJsonV2(payload)).byteLength,
    }
  }))
  const validationBody: Omit<TextOpenWorldCreatorEditValidationV1, 'validationHash'> = {
    schema: 'storyforge.text-open-world-creator-edit-validation',
    version: 1,
    validatorId: rebuilt.validatorId,
    validatorVersion: '1',
    status: 'ready',
    requiredGateIds: [...rebuilt.requiredGateIds].sort((left, right) => left.localeCompare(right)),
    passedGateIds: [...rebuilt.passedGateIds].sort((left, right) => left.localeCompare(right)),
    validatedArtifacts: rebuiltArtifacts.map(artifact => ({
      artifactKey: artifact.artifactKey,
      contentHash: artifact.contentHash,
    })),
    issues: [],
  }
  const validation: TextOpenWorldCreatorEditValidationV1 = {
    ...validationBody,
    validationHash: await hashTextOpenWorldCreatorEditValidationV1(validationBody),
  }
  const identityBody = {
    schema: 'storyforge.text-open-world-creator-edit-identity-delta' as const,
    version: 1 as const,
    beforeCount: projected.identitySequence.length,
    afterCount: rebuilt.identitySequence.length,
    beforeSequenceHash: projected.identitySequenceHash,
    afterSequenceHash: rebuilt.identitySequenceHash,
    addedIdentities: [] as string[],
    removedIdentities: [] as string[],
    renamedIdentities: [] as Array<{ before: string; after: string }>,
    reordered: false as const,
  }
  const identityDelta = {
    ...identityBody,
    deltaHash: await hashTextOpenWorldCreatorEditIdentityDeltaV1(identityBody),
  }
  const referenceBody = {
    schema: 'storyforge.text-open-world-creator-edit-reference-delta' as const,
    version: 1 as const,
    beforeReferenceHash: projected.referenceHash,
    afterReferenceHash: rebuilt.referenceHash,
    added: [],
    removed: [],
    danglingTargetIdentities: [],
  }
  const referenceDelta = {
    ...referenceBody,
    deltaHash: await hashTextOpenWorldCreatorEditReferenceDeltaV1(referenceBody),
  }
  const body: Omit<TextOpenWorldCreatorEditCandidateV1, 'candidateHash'> = {
    schema: 'storyforge.text-open-world-creator-edit-candidate',
    version: 1,
    portable: false,
    production: {
      productionId: context.production.id,
      productionKey: context.production.productionKey,
      stateRevision: context.production.stateRevision,
    },
    baseBuild: {
      buildId: context.build.id,
      buildNumber: context.build.buildNumber,
      stateRevision: context.build.stateRevision,
      controlEpoch: context.build.controlEpoch,
      planHash: context.build.planHash,
      manifestHash: context.build.manifestHash,
      rootTerminalReceiptHash: context.build.rootTerminalReceiptHash,
    },
    governanceSnapshotHash: context.governanceSnapshotHash,
    target: context.target,
    editableFields: context.editableFields,
    ownerSiblingGroup: context.ownerSiblingGroup,
    producerEvidence: context.producerEvidence,
    baseDraftHash: context.baseDraftHash,
    patch: input.patch,
    rebuiltArtifacts,
    validation,
    identityDelta,
    referenceDelta,
    mode: input.mode,
    modelEvidence: input.modelEvidence,
    modelUsage: input.modelUsage,
    revisionProvenance: input.revisionProvenance ?? null,
    status: validation.status,
    createdAt: input.createdAt ?? Date.now(),
  }
  return parseTextOpenWorldCreatorEditCandidateV1({
    ...body,
    candidateHash: await hashTextOpenWorldCreatorEditCandidateV1(body),
  })
}

function parseEvidence(value: unknown): CreatorEditEvidenceEnvelopeV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('checkpoint', 'evidence 必须是对象')
  const row = value as Record<string, unknown>
  const keys = [
    'contextManifestHash', 'contextArtifactHash', 'requestArtifactHash',
    'modelResultArtifactHash', 'responseArtifactHash',
  ]
  if (Object.keys(row).sort().join() !== [...keys].sort().join()) fail('checkpoint', 'evidence 字段不精确')
  for (const key of ['contextManifestHash', 'contextArtifactHash'] as const) {
    if (!isSha256Hash(row[key])) fail('checkpoint', `${key} 无效`)
  }
  for (const key of ['requestArtifactHash', 'modelResultArtifactHash', 'responseArtifactHash'] as const) {
    if (row[key] !== null && !isSha256Hash(row[key])) fail('checkpoint', `${key} 无效`)
  }
  return row as unknown as CreatorEditEvidenceEnvelopeV1
}

async function parseCreatorEditIntakeV1(
  value: unknown,
): Promise<TextOpenWorldCreatorArtifactEditIntakeV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('intake', 'Creator edit intake 必须是对象')
  }
  const row = value as Record<string, unknown>
  const keys = [
    'schema', 'version', 'portable', 'mode', 'selection', 'patch', 'authorInstruction',
    'modelIdentity', 'runtimeBindingHash', 'relation', 'createdAt', 'intakeHash',
  ]
  if (Object.keys(row).sort().join() !== [...keys].sort().join()
    || row.schema !== 'storyforge.text-open-world-creator-edit-intake'
    || row.version !== 1 || row.portable !== false
    || (row.mode !== 'direct' && row.mode !== 'agent')
    || !isSha256Hash(row.runtimeBindingHash)
    || typeof row.relation !== 'string'
    || !Number.isSafeInteger(row.createdAt) || Number(row.createdAt) < 0
    || !isSha256Hash(row.intakeHash)) {
    fail('intake', 'Creator edit intake schema/version/字段无效')
  }
  if (!row.selection || typeof row.selection !== 'object' || Array.isArray(row.selection)) {
    fail('intake', 'Creator edit intake selection 无效')
  }
  const selectionRow = row.selection as Record<string, unknown>
  if (Object.keys(selectionRow).sort().join()
      !== ['artifactKey', 'buildId', 'entityIdentity', 'expectedSnapshotHash', 'productionId', 'scope'].sort().join()
    || !selectionRow.scope || typeof selectionRow.scope !== 'object'
    || Array.isArray(selectionRow.scope)
    || Object.keys(selectionRow.scope as Record<string, unknown>).sort().join()
      !== ['projectId', 'worldId', 'workId'].sort().join()) {
    fail('intake', 'Creator edit intake selection 含未知或缺失字段')
  }
  const selection = structuredClone(selectionRow) as unknown as TextOpenWorldCreatorArtifactEditSelectionV1
  assertSelection(selection)
  if (!row.modelIdentity || typeof row.modelIdentity !== 'object' || Array.isArray(row.modelIdentity)) {
    fail('intake', 'Creator edit intake modelIdentity 无效')
  }
  const modelRow = row.modelIdentity as Record<string, unknown>
  if (Object.keys(modelRow).sort().join()
      !== ['endpointOrigin', 'executionConfigHash', 'model', 'provider'].sort().join()
    || typeof modelRow.provider !== 'string' || !modelRow.provider
    || typeof modelRow.model !== 'string' || !modelRow.model
    || (modelRow.endpointOrigin !== null
      && (typeof modelRow.endpointOrigin !== 'string' || !modelRow.endpointOrigin))
    || (modelRow.executionConfigHash !== null && !isSha256Hash(modelRow.executionConfigHash))) {
    fail('intake', 'Creator edit intake modelIdentity 字段无效')
  }
  const modelIdentity: CreatorEditModelIdentityV1 = {
    provider: modelRow.provider,
    model: modelRow.model,
    endpointOrigin: modelRow.endpointOrigin as string | null,
    executionConfigHash: modelRow.executionConfigHash as string | null,
  }
  const patch = row.patch === null ? null : await parseTextOpenWorldCreatorEditPatchV1(row.patch)
  const authorInstruction = row.authorInstruction === null
    ? null
    : typeof row.authorInstruction === 'string'
      ? normalizeInstruction(row.authorInstruction)
      : fail('intake', 'Creator edit intake authorInstruction 无效')
  if ((row.mode === 'direct' && (!patch || authorInstruction !== null
      || modelIdentity.provider !== 'none' || modelIdentity.model !== 'deterministic-direct-edit'
      || modelIdentity.endpointOrigin !== null || modelIdentity.executionConfigHash !== null))
    || (row.mode === 'agent' && (patch !== null || authorInstruction === null
      || modelIdentity.endpointOrigin === null || modelIdentity.executionConfigHash === null))) {
    fail('intake', 'Creator edit intake mode 与 Patch/Instruction/模型身份不一致')
  }
  const parsed: TextOpenWorldCreatorArtifactEditIntakeV1 = {
    schema: 'storyforge.text-open-world-creator-edit-intake',
    version: 1,
    portable: false,
    mode: row.mode,
    selection,
    patch,
    authorInstruction,
    modelIdentity,
    runtimeBindingHash: row.runtimeBindingHash as string,
    relation: row.relation,
    createdAt: Number(row.createdAt),
    intakeHash: row.intakeHash as string,
  }
  const { intakeHash: _intakeHash, ...body } = parsed
  if (parsed.intakeHash !== await hashProductProductionValueV2(body)) {
    fail('intake', 'Creator edit intake hash 不匹配')
  }
  return parsed
}

async function parseCheckpoint(
  value: unknown,
): Promise<TextOpenWorldCreatorArtifactEditCheckpointV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('checkpoint', '恢复载荷必须是对象')
  const row = value as Record<string, unknown>
  const candidateKeys = [
    'schema', 'version', 'portable', 'phase', 'requestHash', 'evidence', 'candidate',
    'intent', 'terminalReceipt', 'verificationReceipt',
  ]
  const intakeKeys = [...candidateKeys, 'intake']
  if (Object.keys(row).sort().join()
      !== [...(row.phase === 'intake' ? intakeKeys : candidateKeys)].sort().join()
    || row.schema !== 'storyforge.text-open-world-creator-edit-checkpoint'
    || row.version !== 1 || row.portable !== false
    || !['intake', 'candidate', 'intent'].includes(String(row.phase))
    || !isSha256Hash(row.requestHash)) {
    fail('checkpoint', '恢复载荷 schema/version/字段无效')
  }
  if (row.phase === 'intake') {
    if (row.evidence !== null || row.candidate !== null || row.intent !== null
      || row.terminalReceipt !== null || row.verificationReceipt !== null) {
      fail('checkpoint', 'intake phase 不得携带候选、回执或模型证据')
    }
    const intake = await parseCreatorEditIntakeV1(row.intake)
    if (parseCreatorEditRelationV1(intake.relation).requestHash !== row.requestHash) {
      fail('checkpoint', 'intake relation 与 requestHash 不一致')
    }
    return {
      schema: 'storyforge.text-open-world-creator-edit-checkpoint',
      version: 1,
      portable: false,
      phase: 'intake',
      requestHash: row.requestHash as string,
      intake,
      evidence: null,
      candidate: null,
      intent: null,
      terminalReceipt: null,
      verificationReceipt: null,
    }
  }
  const evidence = parseEvidence(row.evidence)
  let candidate: TextOpenWorldCreatorEditCandidateV1
  let intent: TextOpenWorldCreatorEditIntentV1 | null = null
  let terminalReceipt: TextOpenWorldCreatorEditTerminalReceiptV1 | null = null
  let verificationReceipt: VerificationReceiptV1 | null = null
  if (row.phase === 'candidate') {
    if (row.candidate === null || row.intent !== null
      || row.terminalReceipt !== null || row.verificationReceipt !== null) {
      fail('checkpoint', 'candidate phase 必须且只能保存 candidate')
    }
    candidate = await parseTextOpenWorldCreatorEditCandidateV1(row.candidate)
  } else {
    if (row.candidate !== null || row.intent === null
      || row.terminalReceipt === null || row.verificationReceipt === null) {
      fail('checkpoint', 'intent phase 必须从 intent 派生 candidate，且包含两类回执')
    }
    intent = await parseTextOpenWorldCreatorEditIntentV1(row.intent)
    candidate = intent.candidate
  }
  if (row.terminalReceipt !== null) {
    if (!intent) fail('checkpoint', 'terminalReceipt 缺少 intent')
    terminalReceipt = await parseTextOpenWorldCreatorEditTerminalReceiptV1(row.terminalReceipt, {
      intent,
      baseUnchangedHash: await hashTextOpenWorldCreatorEditBaseStateV1(candidate),
      impactPlanHandoffHash: await hashTextOpenWorldCreatorEditImpactPlanHandoffV1(intent),
    })
  }
  if (row.verificationReceipt !== null) {
    verificationReceipt = parseVerificationReceiptV1(row.verificationReceipt)
    if (!await verifyVerificationReceiptIntegrityV1(verificationReceipt)) {
      fail('checkpoint', '标准 verification receipt 完整性无效')
    }
  }
  if (row.phase === 'candidate') {
    return {
      schema: 'storyforge.text-open-world-creator-edit-checkpoint',
      version: 1,
      portable: false,
      phase: 'candidate',
      requestHash: row.requestHash as string,
      evidence,
      candidate,
      intent: null,
      terminalReceipt: null,
      verificationReceipt: null,
    }
  }
  return {
    schema: 'storyforge.text-open-world-creator-edit-checkpoint',
    version: 1,
    portable: false,
    phase: 'intent',
    requestHash: row.requestHash as string,
    evidence,
    candidate: null,
    intent: intent!,
    terminalReceipt: terminalReceipt!,
    verificationReceipt: verificationReceipt!,
  }
}

async function assertFrozenCreatorEditAgentExecutionV1(
  input: FrozenCreatorEditAgentExecutionV1,
): Promise<FrozenCreatorEditAgentExecutionV1> {
  await assertAgentSkillExecutionBindingIntegrityV2(
    input.executionBinding,
    '文字开放世界 Creator Artifact 修改 frozen binding',
  )
  const frozenSkill = projectFrozenAgentSkillDefinitionV1(input.executionBinding)
  const formalBinding = await assertFormalAIEntrySnapshotIntegrityV1(
    input.formalEntry,
    new Map([[frozenSkill.id, frozenSkill]]),
  )
  if (input.executionBinding.skillId !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_SKILL_ID_V1
    || canonicalStringify(input.executionBinding.contextSourceKeys)
      !== canonicalStringify([CONTEXT_SOURCE_KEY_V1, MANUAL_SOURCE_KEY_V1])
    || input.executionBinding.optionalContextActivations.length !== 0
    || input.executionBinding.writeTargets.length !== 0
    || formalBinding.entryId !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_ENTRY_ID_V1
    || formalBinding.skillId !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_SKILL_ID_V1
    || canonicalStringify(formalBinding.categories)
      !== canonicalStringify(['authoring.text-open-world-creator-artifact-edit'])
    || formalBinding.runContractBuilderId !== 'text-open-world-creator-artifact-edit-durable'
    || formalBinding.executionBoundary !== 'durable-run'
    || formalBinding.entryKind !== 'formal'
    || formalBinding.candidateKind !== 'text-open-world-creator-edit-patch'
    || formalBinding.adoptAllowed
    || formalBinding.adoptionTargets.length !== 0
    || canonicalStringify(formalBinding.allowedCallers)
      !== canonicalStringify(['src/lib/open-world/creator-artifact-edit.ts'])) {
    fail('run-contract', 'Creator edit 冻结 Skill 或正式 AI 入口权限不精确')
  }
  return input
}

async function frozenCreatorEditAgentExecutionFromRunV1(
  snapshot: AgentRunSnapshotV1,
): Promise<FrozenCreatorEditAgentExecutionV1> {
  if (snapshot.contract.version !== 2 || snapshot.contract.executionBindings.length !== 1) {
    fail('run-contract', 'Agent Creator edit 必须使用唯一的 V2 冻结执行绑定')
  }
  const stepBinding = snapshot.contract.executionBindings[0]!
  if (stepBinding.stepId !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1
    || !stepBinding.formalEntry) {
    fail('run-contract', 'Agent Creator edit 冻结执行步骤或正式入口缺失')
  }
  const { stepId: _stepId, formalEntry, ...executionBinding } = stepBinding
  return assertFrozenCreatorEditAgentExecutionV1({ executionBinding, formalEntry })
}

async function prepareGenerationFromCreatorEditIntakeV1(
  intake: TextOpenWorldCreatorArtifactEditIntakeV1,
  snapshot: AgentRunSnapshotV1,
): Promise<GenerationPreparedV1> {
  const prepared = intake.mode === 'direct'
    ? await prepareGeneration({
        selection: intake.selection,
        mode: 'direct',
        operations: intake.patch?.operations
          ?? fail('intake', 'Direct Creator edit intake 缺少确定性 Patch'),
      })
    : await prepareGeneration({
        selection: intake.selection,
        mode: 'agent',
        authorInstruction: intake.authorInstruction
          ?? fail('intake', 'Agent Creator edit intake 缺少作者要求'),
        modelIdentity: intake.modelIdentity,
        modelExecutionIdentity: intake.modelIdentity,
        // Verification must never consult the current provider configuration or
        // invoke a model. The frozen Run binding is the only execution authority.
        runAI: async () => fail('intake', '验证 Creator edit intake 时禁止调用模型'),
        frozenAgentExecution: await frozenCreatorEditAgentExecutionFromRunV1(snapshot),
      })
  return { ...prepared, relation: intake.relation }
}

function assertCreatorEditIntakeCheckpointBoundaryV1(input: {
  checkpointRecord: VerifiedAgentRunCheckpointV1['checkpoint']
  snapshot: AgentRunSnapshotV1
}): void {
  const sequence = input.checkpointRecord.throughSequence + 1
  const event = input.snapshot.events.find(item => item.sequence === sequence)
  if (!event || event.type !== 'checkpoint.created'
    || event.payload.checkpointHash !== input.checkpointRecord.checkpointHash
    || event.payload.throughSequence !== input.checkpointRecord.throughSequence
    || input.snapshot.projection.lastCheckpointHash !== input.checkpointRecord.checkpointHash) {
    fail('intake-boundary', 'Creator edit intake checkpoint 与 durable 事件投影不一致')
  }
}

async function assertCreatorEditStaticIntakeAuthorityV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  checkpointRecord: VerifiedAgentRunCheckpointV1['checkpoint']
  checkpoint: Extract<TextOpenWorldCreatorArtifactEditCheckpointV1, { phase: 'intake' }>
}): Promise<void> {
  const { intake } = input.checkpoint
  const relation = parseCreatorEditRelationV1(input.snapshot.run.parentRelation)
  const parent = input.snapshot.contract.lineage?.parent
  const productionScope = input.snapshot.contract.scope.productProduction
  const sourceKeys = intake.mode === 'agent'
    ? [CONTEXT_SOURCE_KEY_V1, MANUAL_SOURCE_KEY_V1]
    : [CONTEXT_SOURCE_KEY_V1]
  if (input.checkpoint.requestHash !== relation.requestHash
    || intake.relation !== input.snapshot.run.parentRelation
    || intake.runtimeBindingHash !== input.snapshot.contract.runtimeBindingHash
    || !sameJson(intake.selection.scope, input.scope)
    || input.snapshot.run.workId !== input.scope.workId
    || input.snapshot.run.productBuildId !== intake.selection.buildId
    || !parent
    || parent.runId !== input.snapshot.run.parentRunId
    || parent.receiptHash !== input.snapshot.run.parentReceiptHash
    || parent.relation !== input.snapshot.run.parentRelation
    || (parent.artifactHash ?? null) !== (input.snapshot.run.parentArtifactHash ?? null)
    || !productionScope
    || productionScope.productBuildId !== intake.selection.buildId
    || !productionScope.taskKey.startsWith('creator-edit:')
    || !sameJson(input.snapshot.contract.permissions.contextSourceKeys, sourceKeys)
    || input.snapshot.contract.permissions.writeTargets.length !== 0) {
    fail('intake-binding', 'Creator edit intake 与 durable Run/contract/parent 静态权限不精确')
  }
  if (intake.mode === 'agent') {
    await frozenCreatorEditAgentExecutionFromRunV1(input.snapshot)
  } else if (input.snapshot.contract.version !== 1
    || input.snapshot.contract.executionBindings !== undefined) {
    fail('intake-binding', '直接 Creator edit intake 不得携带模型执行绑定')
  }
  assertCreatorEditIntakeCheckpointBoundaryV1(input)
}

async function readCreatorEditStaticIntakeStateV1(
  scope: WorkspaceScope,
  runId: number,
): Promise<CreatorEditStaticIntakeStateV1 | null> {
  const verified = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!verified?.resumePayload) return null
  const checkpoint = await parseCheckpoint(verified.resumePayload)
  if (checkpoint.phase !== 'intake') return null
  await assertCreatorEditStaticIntakeAuthorityV1({
    scope,
    snapshot: verified.snapshot,
    checkpointRecord: verified.checkpoint,
    checkpoint,
  })
  return {
    snapshot: verified.snapshot,
    checkpointRecord: verified.checkpoint,
    checkpoint,
  }
}

async function assertCreatorEditIntakeAuthorityV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  checkpointRecord: VerifiedAgentRunCheckpointV1['checkpoint']
  checkpoint: Extract<TextOpenWorldCreatorArtifactEditCheckpointV1, { phase: 'intake' }>
  expectedPrepared?: GenerationPreparedV1
  lineageContext?: CreatorEditLineageValidationContextV1
}): Promise<GenerationPreparedV1> {
  const { intake } = input.checkpoint
  const prepared = await prepareGenerationFromCreatorEditIntakeV1(intake, input.snapshot)
  const context = prepared.workspace.targetContext
  if (input.checkpoint.requestHash !== prepared.requestHash
    || intake.runtimeBindingHash !== prepared.runtimeBindingHash
    || intake.relation !== input.snapshot.run.parentRelation
    || !sameJson(intake.selection.scope, input.scope)
    || input.snapshot.run.productBuildId !== intake.selection.buildId
    || input.snapshot.run.parentRunId !== context.producerEvidence.runId
    || input.snapshot.run.parentReceiptHash !== context.producerEvidence.terminalReceiptHash
    || input.snapshot.run.parentArtifactHash !== context.ownerSiblingGroup.baseGroupHash
    || canonicalStringify(input.snapshot.contract)
      !== canonicalStringify(creatorEditContract(prepared))) {
    fail('intake-binding', 'Creator edit intake、Run Contract、基线或 parent lineage 不精确')
  }
  if (input.expectedPrepared && (
    !sameJson(intake.selection, input.expectedPrepared.selection)
    || intake.mode !== input.expectedPrepared.mode
    || !sameJson(intake.patch, input.expectedPrepared.patch)
    || intake.authorInstruction !== input.expectedPrepared.authorInstruction
    || !sameJson(intake.modelIdentity, input.expectedPrepared.modelIdentity)
    || intake.runtimeBindingHash !== input.expectedPrepared.runtimeBindingHash
    || intake.relation !== input.expectedPrepared.relation
    || prepared.requestHash !== input.expectedPrepared.requestHash
  )) fail('intake-binding', '调用输入与已冻结 Creator edit intake 不一致')
  await assertCreatorEditReplacementLineageV1(
    input.scope,
    input.snapshot,
    prepared.requestHash,
    input.lineageContext,
  )
  assertCreatorEditIntakeCheckpointBoundaryV1(input)
  return prepared
}

async function readCreatorEditIntakeStateV1(
  scope: WorkspaceScope,
  runId: number,
  lineageContext?: CreatorEditLineageValidationContextV1,
): Promise<CreatorEditIntakeStateV1 | null> {
  const verified = await readCreatorEditStaticIntakeStateV1(scope, runId)
  if (!verified) return null
  const { checkpoint, snapshot } = verified
  const prepared = await assertCreatorEditIntakeAuthorityV1({
    scope,
    snapshot,
    checkpointRecord: verified.checkpointRecord,
    checkpoint,
    lineageContext,
  })
  return {
    snapshot,
    checkpointRecord: verified.checkpointRecord,
    checkpoint,
    prepared,
  }
}

async function ensureCreatorEditIntakeCheckpointV1(input: {
  prepared: GenerationPreparedV1
  snapshot: AgentRunSnapshotV1
}): Promise<{ snapshot: AgentRunSnapshotV1; created: boolean }> {
  const verified = await readLatestVerifiedAgentRunCheckpointV1(
    input.prepared.selection.scope,
    input.snapshot.run.id,
  )
  if (verified?.resumePayload) {
    const checkpoint = await parseCheckpoint(verified.resumePayload)
    if (checkpoint.phase !== 'intake') return { snapshot: verified.snapshot, created: false }
    await assertCreatorEditIntakeAuthorityV1({
      scope: input.prepared.selection.scope,
      snapshot: verified.snapshot,
      checkpointRecord: verified.checkpoint,
      checkpoint,
      expectedPrepared: input.prepared,
    })
    return { snapshot: verified.snapshot, created: false }
  }
  const snapshot = await readAgentRunV1(
    input.prepared.selection.scope,
    input.snapshot.run.id,
  )
  if (!['planned', 'running'].includes(snapshot.projection.state)) {
    fail('intake-state', `Creator edit Run 状态 ${snapshot.projection.state} 不能冻结输入`)
  }
  const createdAt = Date.now()
  const intake = await createCreatorEditIntakeV1(input.prepared, createdAt)
  const checkpoint: Extract<TextOpenWorldCreatorArtifactEditCheckpointV1, { phase: 'intake' }> = {
    schema: 'storyforge.text-open-world-creator-edit-checkpoint',
    version: 1,
    portable: false,
    phase: 'intake',
    requestHash: input.prepared.requestHash,
    intake,
    evidence: null,
    candidate: null,
    intent: null,
    terminalReceipt: null,
    verificationReceipt: null,
  }
  const created = await createAgentRunCheckpointV1({
    scope: input.prepared.selection.scope,
    runId: snapshot.run.id,
    resumePayload: checkpoint,
    expectedLastSequence: snapshot.projection.lastSequence,
    now: createdAt,
  })
  await assertCreatorEditIntakeAuthorityV1({
    scope: input.prepared.selection.scope,
    snapshot: created.snapshot,
    checkpointRecord: created.checkpoint,
    checkpoint,
    expectedPrepared: input.prepared,
  })
  return { snapshot: created.snapshot, created: true }
}

async function readHistoricalCreatorEditIntakeV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
}): Promise<Extract<TextOpenWorldCreatorArtifactEditCheckpointV1, { phase: 'intake' }>> {
  const rows = await db.agentRunCheckpoints
    .where('runId')
    .equals(input.snapshot.run.id)
    .sortBy('throughSequence')
  const matches: Extract<TextOpenWorldCreatorArtifactEditCheckpointV1, { phase: 'intake' }>[] = []
  for (const row of rows) {
    if (!row.resumePayloadJson) continue
    let raw: unknown
    try {
      raw = JSON.parse(row.resumePayloadJson)
    } catch {
      continue
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || (raw as Record<string, unknown>).phase !== 'intake') continue
    if (row.id == null || !await verifyAgentRunCheckpointV1(input.scope, row.id)) {
      fail('intake-boundary', 'Creator edit 历史 intake checkpoint 无法通过 durable 完整性验证')
    }
    const checkpoint = await parseCheckpoint(raw)
    if (checkpoint.phase !== 'intake') {
      fail('intake-boundary', 'Creator edit 历史 intake checkpoint 类型不一致')
    }
    matches.push(checkpoint)
  }
  if (matches.length !== 1) {
    fail('intake-boundary', 'Creator edit Run 必须且只能有一个 durable intake checkpoint')
  }
  return matches[0]!
}

async function readHistoricalCreatorEditIntakeAuthorityV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  verifyLineage?: boolean
}): Promise<Pick<CreatorEditIntakeStateV1, 'checkpoint' | 'prepared'>> {
  const checkpoint = await readHistoricalCreatorEditIntakeV1(input)
  const { intake } = checkpoint
  const prepared = await prepareGenerationFromCreatorEditIntakeV1(intake, input.snapshot)
  const context = prepared.workspace.targetContext
  if (checkpoint.requestHash !== prepared.requestHash
    || intake.runtimeBindingHash !== prepared.runtimeBindingHash
    || intake.relation !== input.snapshot.run.parentRelation
    || !sameJson(intake.selection.scope, input.scope)
    || input.snapshot.run.productBuildId !== intake.selection.buildId
    || input.snapshot.run.parentRunId !== context.producerEvidence.runId
    || input.snapshot.run.parentReceiptHash !== context.producerEvidence.terminalReceiptHash
    || input.snapshot.run.parentArtifactHash !== context.ownerSiblingGroup.baseGroupHash
    || canonicalStringify(input.snapshot.contract)
      !== canonicalStringify(creatorEditContract(prepared))) {
    fail('intake-binding', '历史 Creator edit intake、Run Contract、基线或 parent lineage 不精确')
  }
  if (input.verifyLineage !== false) {
    await assertCreatorEditReplacementLineageV1(
      input.scope,
      input.snapshot,
      prepared.requestHash,
    )
  }
  return { checkpoint, prepared }
}

async function assertCreatorEditRunContractV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  checkpoint: Exclude<TextOpenWorldCreatorArtifactEditCheckpointV1, { phase: 'intake' }>
  candidate: TextOpenWorldCreatorEditCandidateV1
  renderedRequest: CreatorEditRenderedRequestArtifactV1 | null
}): Promise<void> {
  const { snapshot, checkpoint, candidate, renderedRequest } = input
  const historicalIntake = await readHistoricalCreatorEditIntakeAuthorityV1({
    scope: input.scope,
    snapshot,
    verifyLineage: false,
  })
  const intakeCheckpoint = historicalIntake.checkpoint
  const intake = intakeCheckpoint.intake
  const sourceKeys: readonly string[] = candidate.mode === 'agent'
    ? [CONTEXT_SOURCE_KEY_V1, MANUAL_SOURCE_KEY_V1]
    : [CONTEXT_SOURCE_KEY_V1]
  const frozenExecution = candidate.mode === 'agent'
    ? await frozenCreatorEditAgentExecutionFromRunV1(snapshot)
    : null
  if (candidate.mode === 'direct' && (
    snapshot.contract.version !== 1 || snapshot.contract.executionBindings !== undefined
  )) fail('run-contract', '直接 Creator edit 必须使用无模型执行绑定的 V1 契约')
  const executionBinding = frozenExecution?.executionBinding ?? null
  const formalEntry = frozenExecution?.formalEntry ?? null
  const requestPayloadHash = candidate.mode === 'direct'
    ? (candidate.revisionProvenance?.originPatchHash ?? candidate.patch.patchHash)
    : await hashProductProductionValueV2({
        authorInstruction: renderedRequest?.authorInstruction
          ?? fail('run-contract', 'Agent Run Contract 缺少可验证的作者要求'),
      })
  const modelIdentity = intake.modelIdentity
  if (intake.mode !== candidate.mode
    || intakeCheckpoint.requestHash !== checkpoint.requestHash
    || (candidate.mode === 'agent' && (
      candidate.modelEvidence?.provider !== modelIdentity.provider
      || candidate.modelEvidence?.model !== modelIdentity.model
    ))
    || (candidate.mode === 'direct' && (
      modelIdentity.provider !== 'none'
      || modelIdentity.model !== 'deterministic-direct-edit'
      || modelIdentity.endpointOrigin !== null
      || modelIdentity.executionConfigHash !== null
    ))) {
    fail('run-contract', 'Creator edit 候选与 durable intake 的执行身份不一致')
  }
  const runtimeBindingHash = await hashProductProductionValueV2({
    schema: 'storyforge.text-open-world-creator-edit-runtime-binding',
    version: 1,
    mode: candidate.mode,
    productionId: candidate.production.productionId,
    buildId: candidate.baseBuild.buildId,
    governanceSnapshotHash: candidate.governanceSnapshotHash,
    target: candidate.target,
    baseDraftHash: candidate.baseDraftHash,
    baseGroupHash: candidate.ownerSiblingGroup.baseGroupHash,
    producerReceiptHash: candidate.producerEvidence.terminalReceiptHash,
    requestPayloadHash,
    sourceKeys,
    modelIdentity,
    executionBinding,
    formalEntry,
  })
  const requestHash = await hashProductProductionValueV2({
    schema: 'storyforge.text-open-world-creator-edit-request',
    version: 1,
    runtimeBindingHash,
    requestPayloadHash,
  })
  const relation = parseCreatorEditRelationV1(snapshot.run.parentRelation)
  const expectedContract = creatorEditContractFromFacts({
    projectId: snapshot.run.projectId,
    target: candidate.target,
    producerEvidence: candidate.producerEvidence,
    ownerSiblingGroup: candidate.ownerSiblingGroup,
    productBuildId: candidate.baseBuild.buildId,
    buildNumber: candidate.baseBuild.buildNumber,
    controlEpoch: candidate.baseBuild.controlEpoch,
    planHash: candidate.baseBuild.planHash,
    relation: snapshot.run.parentRelation!,
    sourceKeys,
    runtimeBindingHash,
    mode: candidate.mode,
    executionBinding,
    formalEntry,
  })
  if (checkpoint.requestHash !== requestHash
    || relation.requestHash !== requestHash
    || snapshot.contract.runtimeBindingHash !== runtimeBindingHash
    || canonicalStringify(snapshot.contract) !== canonicalStringify(expectedContract)) {
    fail('run-contract', 'Creator edit Run Contract、请求身份或冻结执行绑定不精确')
  }
}

async function readHistoricalCandidateV1(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidateHash: string,
): Promise<TextOpenWorldCreatorEditCandidateV1 | null> {
  const rows = await db.agentRunCheckpoints.where('runId').equals(snapshot.run.id).toArray()
  const matches: TextOpenWorldCreatorEditCandidateV1[] = []
  for (const row of rows) {
    if (!row.resumePayloadJson) continue
    let payload: unknown
    try {
      payload = JSON.parse(row.resumePayloadJson)
    } catch {
      fail('candidate-lineage', 'Creator edit 历史 checkpoint 不是有效 JSON')
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || (payload as Record<string, unknown>).phase !== 'candidate') continue
    let checkpoint: TextOpenWorldCreatorArtifactEditCheckpointV1
    try {
      checkpoint = await parseCheckpoint(payload)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      fail('candidate-lineage', `原始 Candidate checkpoint 载荷无效：${message}`)
    }
    if (checkpoint.phase !== 'candidate' || checkpoint.candidate.candidateHash !== candidateHash) continue
    if (row.id == null || !await verifyAgentRunCheckpointV1(scope, row.id)) {
      fail('candidate-lineage', '原始 Candidate 的历史 checkpoint 无法通过 durable 完整性验证')
    }
    const checkpointEvent = snapshot.events.find(event => event.sequence === row.throughSequence + 1)
    const persistedEvent = snapshot.events.find(event => event.sequence === row.throughSequence + 2)
    const matchingPersisted = eventFor(snapshot, 'candidate.persisted').filter(event => (
      event.type === 'candidate.persisted' && event.payload.candidateHash === candidateHash
    ))
    if (!checkpointEvent || checkpointEvent.type !== 'checkpoint.created'
      || checkpointEvent.payload.checkpointHash !== row.checkpointHash
      || checkpointEvent.payload.throughSequence !== row.throughSequence
      || !persistedEvent || persistedEvent.type !== 'candidate.persisted'
      || persistedEvent.payload.stepId !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1
      || persistedEvent.payload.attempt !== 1
      || persistedEvent.payload.candidateHash !== candidateHash
      || matchingPersisted.length !== 1) {
      fail('candidate-lineage', '原始 Candidate checkpoint 与唯一 candidate.persisted 边界不闭合')
    }
    matches.push(checkpoint.candidate)
  }
  if (matches.length > 1) fail('candidate-lineage', '原始 Candidate 存在多个历史 checkpoint 权限来源')
  return matches[0] ?? null
}

function creatorEditCandidateImmutableIdentityV1(
  candidate: TextOpenWorldCreatorEditCandidateV1,
): unknown {
  return {
    production: candidate.production,
    baseBuild: candidate.baseBuild,
    governanceSnapshotHash: candidate.governanceSnapshotHash,
    target: candidate.target,
    editableFields: candidate.editableFields,
    ownerSiblingGroup: candidate.ownerSiblingGroup,
    producerEvidence: candidate.producerEvidence,
    baseDraftHash: candidate.baseDraftHash,
  }
}

async function assertCandidateRevisionEvidenceV1(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: TextOpenWorldCreatorEditCandidateV1,
): Promise<void> {
  const persisted = eventFor(snapshot, 'candidate.persisted')
  const revisions = eventFor(snapshot, 'candidate.revised')
  if (persisted.some(event => event.type !== 'candidate.persisted'
      || event.payload.stepId !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1
      || event.payload.attempt !== 1)
    || revisions.some(event => event.type !== 'candidate.revised'
      || event.payload.stepId !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1
      || event.payload.attempt !== 1)) {
    fail('candidate-lineage', '候选事件越过 Creator edit 唯一步骤')
  }
  if (!candidate.revisionProvenance) {
    if (revisions.length || persisted.length > 1
      || (persisted.length === 1 && persisted[0]!.type === 'candidate.persisted'
        && persisted[0]!.payload.candidateHash !== candidate.candidateHash)) {
      fail('candidate-lineage', '初始候选事件链与 candidateHash 不一致')
    }
    return
  }
  const provenance = candidate.revisionProvenance
  if (persisted.length !== 1 || persisted[0]!.type !== 'candidate.persisted'
    || persisted[0]!.payload.candidateHash !== provenance.originCandidateHash) {
    fail('candidate-lineage', '修订候选缺少唯一原始 candidate.persisted 锚点')
  }
  let cursor = provenance.originCandidateHash
  for (const event of revisions) {
    if (event.type !== 'candidate.revised'
      || event.payload.previousCandidateHash !== cursor) {
      fail('candidate-lineage', 'candidate.revised 事件没有形成连续身份链')
    }
    cursor = event.payload.candidateHash
  }
  if (cursor !== candidate.candidateHash && cursor !== provenance.previousCandidateHash) {
    fail('candidate-lineage', '修订事件链既不指向当前候选，也不处于可恢复的前一候选')
  }
  if (cursor === candidate.candidateHash) {
    const last = revisions[revisions.length - 1]
    if (!last || last.type !== 'candidate.revised'
      || last.payload.previousCandidateHash !== provenance.previousCandidateHash
      || last.payload.candidateHash !== candidate.candidateHash) {
      fail('candidate-lineage', '当前修订候选没有精确的末端 revision 事件')
    }
  }
  const origin = await readHistoricalCandidateV1(
    scope,
    snapshot,
    provenance.originCandidateHash,
  )
  if (!origin || origin.revisionProvenance !== null
    || origin.patch.patchHash !== provenance.originPatchHash
    || origin.mode !== candidate.mode
    || !sameJson(
      creatorEditCandidateImmutableIdentityV1(origin),
      creatorEditCandidateImmutableIdentityV1(candidate),
    )
    || !sameJson(origin.modelEvidence, candidate.modelEvidence)
    || !sameJson(origin.modelUsage, candidate.modelUsage)) {
    fail('candidate-lineage', '修订候选的原始 Candidate/Patch/模型证据不可验证')
  }
}

function assertLatestCheckpointBoundaryV1(input: {
  checkpointRecord: VerifiedAgentRunCheckpointV1['checkpoint']
  snapshot: AgentRunSnapshotV1
  checkpoint: Exclude<TextOpenWorldCreatorArtifactEditCheckpointV1, { phase: 'intake' }>
  candidate: TextOpenWorldCreatorEditCandidateV1
}): void {
  const checkpointEventSequence = input.checkpointRecord.throughSequence + 1
  const checkpointEvent = input.snapshot.events.find(event => event.sequence === checkpointEventSequence)
  if (!checkpointEvent || checkpointEvent.type !== 'checkpoint.created'
    || checkpointEvent.payload.checkpointHash !== input.checkpointRecord.checkpointHash
    || input.snapshot.projection.lastCheckpointHash !== input.checkpointRecord.checkpointHash) {
    fail('checkpoint-boundary', '最新 checkpoint 与 checkpoint.created 投影不一致')
  }
  const next = input.snapshot.events.find(event => event.sequence === checkpointEventSequence + 1)
  if (!next) {
    if (input.snapshot.projection.lastSequence !== checkpointEventSequence) {
      fail('checkpoint-boundary', 'checkpoint 后的事件序列存在缺口')
    }
    return
  }
  if (input.checkpoint.phase === 'candidate') {
    if (input.candidate.revisionProvenance) {
      if (next.type !== 'candidate.revised'
        || next.payload.stepId !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1
        || next.payload.attempt !== 1
        || next.payload.previousCandidateHash
          !== input.candidate.revisionProvenance.previousCandidateHash
        || next.payload.candidateHash !== input.candidate.candidateHash) {
        fail('checkpoint-boundary', '修订候选 checkpoint 后缺少精确 candidate.revised')
      }
    } else if (next.type !== 'candidate.persisted'
      || next.payload.stepId !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1
      || next.payload.attempt !== 1
      || next.payload.candidateHash !== input.candidate.candidateHash) {
      fail('checkpoint-boundary', '初始候选 checkpoint 后缺少精确 candidate.persisted')
    }
  } else if (next.type !== 'confirmation.recorded'
    || next.payload.stepId !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1
    || next.payload.candidateHash !== input.candidate.candidateHash
    || next.payload.decision !== 'adopt') {
    fail('checkpoint-boundary', 'Intent checkpoint 后缺少原子 confirmation.recorded')
  }
}

async function assertCheckpointEvidence(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  checkpoint: Exclude<TextOpenWorldCreatorArtifactEditCheckpointV1, { phase: 'intake' }>,
  candidate: TextOpenWorldCreatorEditCandidateV1,
): Promise<void> {
  const contextArtifact = exactArtifactEvent(snapshot, 'context-manifest')
    ?? fail('evidence', 'Creator edit 缺少唯一 context-manifest artifact event')
  const contextEvents = eventFor(snapshot, 'context.assembled')
  if (contextEvents.length !== 1 || contextEvents[0]!.type !== 'context.assembled'
    || contextEvents[0]!.payload.stepId !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1
    || contextEvents[0]!.payload.attempt !== 1
    || contextEvents[0]!.payload.manifestHash !== checkpoint.evidence.contextManifestHash
    || contextArtifact.payload.contentHash !== checkpoint.evidence.contextArtifactHash
    || contextArtifact.sequence >= contextEvents[0]!.sequence) {
    fail('evidence', 'ContextManifest hash、事件或顺序没有闭合')
  }
  const manifestText = await readAgentRunArtifactExactV1({
    projectId: snapshot.run.projectId,
    artifactKind: 'context-manifest',
    contentHash: checkpoint.evidence.contextArtifactHash,
  })
  let manifestValue: unknown
  try {
    manifestValue = JSON.parse(manifestText)
  } catch {
    fail('evidence', 'ContextManifest exact artifact 不是 JSON')
  }
  const manifest = parseContextManifestV1(manifestValue)
  if (!await verifyContextManifestIntegrityV1(manifest)
    || manifest.manifestHash !== checkpoint.evidence.contextManifestHash
    || manifest.runId !== snapshot.run.id
    || manifest.stepId !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1
    || manifest.attempt !== 1
    || manifest.scope.projectId !== snapshot.run.projectId
    || manifest.scope.worldGroupId !== (snapshot.run.worldGroupId ?? null)) {
    fail('evidence', 'ContextManifest 正文 hash、Run、步骤或作用域不一致')
  }
  if (manifest.inputBudget > snapshot.contract.budget.maxInputTokens
    || manifest.totalInputTokens > snapshot.contract.budget.maxInputTokens) {
    fail('evidence', 'ContextManifest token 预算超过 Run Contract')
  }
  if (!sameJson(
      manifest.sources.map(source => source.key),
      snapshot.contract.permissions.contextSourceKeys,
    )
    || manifest.sources.some(source => source.status !== 'included')) {
    fail('evidence', 'ContextManifest 来源集合或交付状态与 Run Contract 不一致')
  }

  const request = exactArtifactEvent(snapshot, 'rendered-request')
  const modelResult = exactArtifactEvent(snapshot, 'tool-result')
  const response = exactArtifactEvent(snapshot, 'raw-response')
  const requested = eventFor(snapshot, 'model.requested')
  const responded = eventFor(snapshot, 'model.responded')
  if (candidate.mode === 'direct') {
    if (checkpoint.evidence.requestArtifactHash !== null
      || checkpoint.evidence.modelResultArtifactHash !== null
      || checkpoint.evidence.responseArtifactHash !== null
      || request || modelResult || response || requested.length || responded.length
      || candidate.modelEvidence !== null
      || !sameJson(candidate.modelUsage, {
        modelCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: null, durationMs: 0,
      })) {
      fail('evidence', 'Direct 修改不得携带任何模型调用或模型 Artifact 证据')
    }
    await assertCreatorEditRunContractV1({
      scope,
      snapshot,
      checkpoint,
      candidate,
      renderedRequest: null,
    })
    await assertCandidateRevisionEvidenceV1(scope, snapshot, candidate)
    return
  }

  if (!request || !modelResult || !response
    || requested.length !== 1 || responded.length !== 1
    || requested[0]!.type !== 'model.requested' || responded[0]!.type !== 'model.responded'
    || checkpoint.evidence.requestArtifactHash !== request.payload.contentHash
    || checkpoint.evidence.modelResultArtifactHash !== modelResult.payload.contentHash
    || checkpoint.evidence.responseArtifactHash !== response.payload.contentHash
    || !candidate.modelEvidence
    || candidate.modelEvidence.promptHash !== request.payload.contentHash
    || candidate.modelEvidence.outputHash !== response.payload.contentHash
    || !sameJson(candidate.modelEvidence.contextManifestHashes, [manifest.manifestHash])
    || candidate.modelUsage.modelCalls !== 1
    || candidate.modelUsage.inputTokens > snapshot.contract.budget.maxInputTokens
    || candidate.modelUsage.outputTokens > snapshot.contract.budget.maxOutputTokens) {
    fail('evidence', 'Agent 修改的模型 Artifact、用量或 ContextManifest envelope 不闭合')
  }
  const historicalIntake = await readHistoricalCreatorEditIntakeAuthorityV1({
    scope,
    snapshot,
    verifyLineage: false,
  })
  const verifiedModelInput = await assertCreatorEditModelInputEvidenceV1({
    scope,
    snapshot,
    requestEvent: request,
    intakeState: historicalIntake,
  })
  if (verifiedModelInput.manifest.manifestHash !== manifest.manifestHash
    || verifiedModelInput.renderedRequest.authorInstruction
      !== historicalIntake.checkpoint.intake.authorInstruction) {
    fail('evidence', '候选模型输入与冻结 intake 或 checkpoint manifest 不一致')
  }
  const requestBindingHash = await hashCanonicalValue({
    runtimeBindingHash: snapshot.contract.runtimeBindingHash,
    requestArtifactHash: request.payload.contentHash,
    executionBinding: snapshot.contract.executionBindings?.[0],
  })
  if (requested[0]!.payload.bindingHash !== requestBindingHash
    || responded[0]!.payload.outputHash !== response.payload.contentHash
    || !(contextArtifact.sequence < contextEvents[0]!.sequence
      && contextEvents[0]!.sequence < request.sequence
      && request.sequence < requested[0]!.sequence
      && requested[0]!.sequence < modelResult.sequence
      && modelResult.sequence < response.sequence
      && response.sequence < responded[0]!.sequence)) {
    fail('evidence', 'Agent 模型请求绑定、响应 hash 或 durable 事件顺序无效')
  }
  const [requestText, resultText, responseText] = await Promise.all([
    readAgentRunArtifactExactV1({
      projectId: snapshot.run.projectId,
      artifactKind: 'rendered-request',
      contentHash: request.payload.contentHash,
    }),
    readAgentRunArtifactExactV1({
      projectId: snapshot.run.projectId,
      artifactKind: 'tool-result',
      contentHash: modelResult.payload.contentHash,
    }),
    readAgentRunArtifactExactV1({
      projectId: snapshot.run.projectId,
      artifactKind: 'raw-response',
      contentHash: response.payload.contentHash,
    }),
  ])
  const renderedRequest = parseRenderedRequestArtifactBody(requestText)
  const contextSource = manifest.sources.find(source => source.key === CONTEXT_SOURCE_KEY_V1)
  const instructionSource = manifest.sources.find(source => source.key === MANUAL_SOURCE_KEY_V1)
  if (contextSource?.contentHash !== await sha256Text(renderedRequest.registeredContext)
    || instructionSource?.contentHash !== await sha256Text(renderedRequest.authorInstruction)) {
    fail('evidence', 'rendered-request 正文与 ContextManifest 来源 hash 不一致')
  }
  const durableResult = await parseModelResultArtifactBody(resultText)
  if (durableResult.provider !== candidate.modelEvidence.provider
    || durableResult.model !== candidate.modelEvidence.model
    || durableResult.rawResponse !== responseText
    || durableResult.responseContentHash !== response.payload.contentHash
    || !sameJson(durableResult.usage, candidate.modelUsage)) {
    fail('evidence', '持久化模型结果、raw-response 与 candidate 用量不一致')
  }
  const originOutput = parseTextOpenWorldCreatorArtifactEditModelOutputV1(
    durableResult.rawResponse,
    candidate.editableFields,
  )
  const originPatch = await createTextOpenWorldCreatorEditPatchV1({
    baseDraftHash: candidate.baseDraftHash,
    operations: originOutput.operations,
  })
  if (originPatch.patchHash
    !== (candidate.revisionProvenance?.originPatchHash ?? candidate.patch.patchHash)) {
    fail('evidence', '模型原始输出没有精确绑定初始 Patch 或修订来源')
  }
  await assertCreatorEditRunContractV1({
    scope,
    snapshot,
    checkpoint,
    candidate,
    renderedRequest,
  })
  await assertCandidateRevisionEvidenceV1(scope, snapshot, candidate)
}

async function assertCreatorEditReplacementLineageV1(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  requestHash: string,
  existingContext?: CreatorEditLineageValidationContextV1,
): Promise<void> {
  const relation = parseCreatorEditRelationV1(snapshot.run.parentRelation)
  if (relation.requestHash !== requestHash) {
    fail('run-binding', 'Creator edit relation 没有绑定 checkpoint request hash')
  }
  const context = existingContext ?? {
    visitingRunIds: new Set<number>(),
    verifiedRunIds: new Set<number>(),
  }
  if (context.verifiedRunIds.has(snapshot.run.id)) return
  if (context.visitingRunIds.has(snapshot.run.id)) {
    fail('replacement-cycle', 'Creator edit replacement 证据链出现循环引用')
  }
  if (context.visitingRunIds.size >= 64) {
    fail('replacement-depth', 'Creator edit replacement 证据链超过 64 层安全上限')
  }
  context.visitingRunIds.add(snapshot.run.id)
  try {
    if (relation.replacementRunId !== null) {
      if (relation.replacementRunId >= snapshot.run.id) {
        fail('run-binding', 'Creator edit replacement 必须引用更早的 Run')
      }
      const replaced = await readAgentRunV1(scope, relation.replacementRunId)
      const replacedRelation = parseCreatorEditRelationV1(replaced.run.parentRelation)
      if (replacedRelation.requestHash !== requestHash
        || replaced.run.parentRunId !== snapshot.run.parentRunId
        || replaced.run.parentReceiptHash !== snapshot.run.parentReceiptHash
        || replaced.run.parentArtifactHash !== snapshot.run.parentArtifactHash
        || replaced.run.productBuildId !== snapshot.run.productBuildId
        || !await isExplicitlyReplaceableCreatorEditRunV1(scope, replaced, context)) {
        fail('run-binding', 'Creator edit replacement 没有引用同组、同请求且可安全替换的终态 Run')
      }
    }
    context.verifiedRunIds.add(snapshot.run.id)
  } finally {
    context.visitingRunIds.delete(snapshot.run.id)
  }
}

async function readState(
  scope: WorkspaceScope,
  runId: number,
  lineageContext?: CreatorEditLineageValidationContextV1,
): Promise<TextOpenWorldCreatorArtifactEditStateV1 | null> {
  const verified = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!verified?.resumePayload) return null
  const checkpoint = await parseCheckpoint(verified.resumePayload)
  if (checkpoint.phase === 'intake') return null
  const snapshot = await readAgentRunV1(scope, runId)
  const candidate = checkpoint.phase === 'candidate'
    ? checkpoint.candidate
    : checkpoint.intent.candidate
  if (snapshot.contract.runtimeBindingHash == null
    || !snapshot.run.parentRelation?.startsWith(RUN_RELATION_PREFIX)
    || snapshot.run.productBuildId !== candidate.baseBuild.buildId
    || snapshot.run.parentRunId !== candidate.producerEvidence.runId
    || snapshot.run.parentReceiptHash !== candidate.producerEvidence.terminalReceiptHash
    || snapshot.run.parentArtifactHash !== candidate.ownerSiblingGroup.baseGroupHash) {
    fail('run-binding', 'Creator edit checkpoint 与 durable Run/parent lineage 不一致')
  }
  await assertCreatorEditReplacementLineageV1(
    scope,
    snapshot,
    checkpoint.requestHash,
    lineageContext,
  )
  assertLatestCheckpointBoundaryV1({
    checkpointRecord: verified.checkpoint,
    snapshot,
    checkpoint,
    candidate,
  })
  await assertCheckpointEvidence(scope, snapshot, checkpoint, candidate)
  return {
    snapshot,
    checkpoint,
    candidate,
    intent: checkpoint.phase === 'intent' ? checkpoint.intent : null,
    terminalReceipt: checkpoint.phase === 'intent' ? checkpoint.terminalReceipt : null,
    verificationReceipt: checkpoint.phase === 'intent' ? checkpoint.verificationReceipt : null,
  }
}

async function repairCandidateEvent(
  scope: WorkspaceScope,
  state: TextOpenWorldCreatorArtifactEditStateV1,
): Promise<TextOpenWorldCreatorArtifactEditStateV1> {
  const step = state.snapshot.projection.steps[TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1]
  if (step?.candidateHash === state.candidate.candidateHash) return state
  if (state.checkpoint.phase !== 'candidate') {
    fail('candidate-event', '候选 checkpoint 无法安全恢复 candidate.persisted')
  }
  if (state.snapshot.run.workId == null) fail('scope', 'Creator edit 必须是 Work-owned Run')
  let snapshot: AgentRunSnapshotV1
  if (step?.status === 'running' && !step.candidateHash) {
    snapshot = await appendRun(scope, state.snapshot, 'candidate.persisted', {
      stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
      attempt: 1,
      candidateHash: state.candidate.candidateHash,
      requiresConfirmation: true,
    })
  } else if (state.snapshot.projection.state === 'awaiting_confirmation'
    && step?.status === 'awaiting_confirmation' && step.candidateHash) {
    snapshot = await appendRun(scope, state.snapshot, 'candidate.revised', {
      stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
      attempt: 1,
      previousCandidateHash: step.candidateHash,
      candidateHash: state.candidate.candidateHash,
    })
  } else {
    fail('candidate-event', '候选 checkpoint 与 Run projection 无法确定性归一')
  }
  return { ...state, snapshot }
}

async function recordContext(input: {
  prepared: GenerationPreparedV1
  snapshot: AgentRunSnapshotV1
}): Promise<{
  snapshot: AgentRunSnapshotV1
  manifestHash: string
  contextArtifactHash: string
  registeredContext: string
}> {
  const assembled = await assembleContext({
    ...assembleInput(input.prepared.selection),
    sourceKeys: [...input.prepared.sourceKeys],
    ...(input.prepared.authorInstruction == null ? {} : {
      manualSourceText: input.prepared.authorInstruction,
    }),
    inputBudgetMaxTokens: 64_000,
  })
  if (assembled.included.length !== input.prepared.sourceKeys.length
    || assembled.included.some((key, index) => key !== input.prepared.sourceKeys[index])
    || assembled.omitted.length || assembled.trimmed.length) {
    fail('context', 'Creator edit 登记 Context 没有完整交付全部声明来源')
  }
  const registeredContext = sourceSegment(assembled, CONTEXT_SOURCE_KEY_V1)
  if (registeredContext !== canonicalProductProductionJsonV2(input.prepared.workspace.targetContext)) {
    fail('context-stale', '登记目标 Context 与内部 workspace 不是同一治理快照')
  }
  if (input.prepared.authorInstruction != null
    && sourceSegment(assembled, MANUAL_SOURCE_KEY_V1) !== input.prepared.authorInstruction) {
    fail('context', '作者修改要求被裁剪或改写')
  }
  const manifest = await createContextManifestFromAssemblyV1({
    runId: input.snapshot.run.id,
    stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
    attempt: 1,
    projectId: input.prepared.selection.scope.projectId,
    worldGroupId: null,
    declaredSourceKeys: input.prepared.sourceKeys,
    assembled,
    readerVersion: 'text-open-world-creator-artifact-edit-context-v1',
  })
  let snapshot = input.snapshot
  const recorded = await recordAgentRunArtifactV1({
    scope: input.prepared.selection.scope,
    runId: snapshot.run.id,
    artifactKind: 'context-manifest',
    content: canonicalStringify(manifest),
    stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
    attempt: 1,
    expectedLastSequence: snapshot.projection.lastSequence,
  })
  snapshot = recorded.snapshot
  const existing = eventFor(snapshot, 'context.assembled')
  if (existing.length > 1) fail('context', 'context.assembled 不唯一')
  if (!existing.length) {
    snapshot = await appendRun(input.prepared.selection.scope, snapshot, 'context.assembled', {
      stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
      attempt: 1,
      manifestHash: manifest.manifestHash,
    })
  } else if (existing[0]!.type !== 'context.assembled'
    || existing[0]!.payload.manifestHash !== manifest.manifestHash) {
    fail('context', '既有 ContextManifest 与当前请求不一致')
  }
  return {
    snapshot,
    manifestHash: manifest.manifestHash,
    contextArtifactHash: recorded.artifact.contentHash,
    registeredContext,
  }
}

async function claimCreatorEditModelRequestV1(input: {
  prepared: GenerationPreparedV1
  snapshot: AgentRunSnapshotV1
  requestBindingHash: string
}): Promise<{ snapshot: AgentRunSnapshotV1; claimed: boolean }> {
  const parentRunId = input.prepared.workspace.targetContext.producerEvidence.runId
  const baseGroupHash = input.prepared.workspace.targetContext.ownerSiblingGroup.baseGroupHash
  return withAgentRunMutationLockV1(parentRunId, () => db.transaction(
    'rw',
    agentRunScopeTransactionTablesV1(
      input.snapshot.run.id,
      db.agentRuns,
      db.agentRunEvents,
      db.productProductions,
      db.productBuilds,
    ),
    async () => {
      const current = await readVerifiedAgentRunInTransactionV1(
        input.prepared.selection.scope,
        input.snapshot.run.id,
      )
      await assertCreatorEditBaseRowsInTransactionV1({
        scope: input.prepared.selection.scope,
        production: {
          id: input.prepared.workspace.targetContext.production.id,
          productionKey: input.prepared.workspace.targetContext.production.productionKey,
          stateRevision: input.prepared.workspace.targetContext.production.stateRevision,
          status: input.prepared.workspace.targetContext.production.status,
        },
        build: {
          id: input.prepared.workspace.targetContext.build.id,
          buildNumber: input.prepared.workspace.targetContext.build.buildNumber,
          stateRevision: input.prepared.workspace.targetContext.build.stateRevision,
          controlEpoch: input.prepared.workspace.targetContext.build.controlEpoch,
          planHash: input.prepared.workspace.targetContext.build.planHash,
          manifestHash: input.prepared.workspace.targetContext.build.manifestHash,
          rootTerminalReceiptHash:
            input.prepared.workspace.targetContext.build.rootTerminalReceiptHash,
          status: input.prepared.workspace.targetContext.build.status,
        },
      })
      const currentRequested = eventFor(current, 'model.requested')
      if (currentRequested.length > 1) fail('model-evidence', 'model.requested 不唯一')
      if (currentRequested.length === 1) {
        const event = currentRequested[0]!
        if (event.type !== 'model.requested'
          || event.payload.bindingHash !== input.requestBindingHash) {
          fail('model-evidence', '既有 model.requested 绑定不一致')
        }
        return { snapshot: current, claimed: false }
      }
      const siblings = await db.agentRuns.where('parentRunId').equals(parentRunId).toArray()
      for (const sibling of siblings) {
        if (sibling.id == null || sibling.id === current.run.id
          || sibling.productBuildId !== input.prepared.selection.buildId
          || sibling.parentArtifactHash !== baseGroupHash
          || !sibling.parentRelation?.startsWith(RUN_RELATION_PREFIX)) continue
        const competing = await readVerifiedAgentRunInTransactionV1(
          input.prepared.selection.scope,
          sibling.id,
        )
        const competingStep = competing.projection
          .steps[TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1]
        if (competingStep?.confirmation === 'adopt') {
          fail('competing-intent', '同一 owner sibling 基线已有已确认修改，必须先完成影响分析')
        }
        if (['running', 'paused'].includes(competing.projection.state)
          && eventFor(competing, 'model.requested').length > 0) {
          if (exactArtifactEvent(competing, 'tool-result') === null) {
            fail(
              'unresolved-model-outcome',
              '同一 owner sibling 已有模型结果未知的请求；必须由作者明确放弃后才能再次调用模型',
            )
          }
          fail(
            'unfinished-known-model-result',
            '同一 owner sibling 已有持久化模型结果等待恢复；必须先恢复该 Run，不能再次调用模型',
          )
        }
      }
      const event = parseAgentRunEventV1({
        version: 1,
        runId: current.run.id,
        sequence: current.projection.lastSequence + 1,
        generation: current.projection.generation,
        projectId: current.run.projectId,
        worldGroupId: current.run.worldGroupId ?? null,
        contractHash: current.projection.contractHash,
        type: 'model.requested',
        createdAt: Date.now(),
        payload: {
          stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
          attempt: 1,
          bindingHash: input.requestBindingHash,
        },
      })
      return {
        snapshot: await appendPrivilegedAgentRunEventInTransactionV1(current, event),
        claimed: true,
      }
    },
  ))
}

async function resolveAgentPatch(input: {
  prepared: GenerationPreparedV1
  snapshot: AgentRunSnapshotV1
  registeredContext: string
  manifestHash: string
  aiConfig?: AIConfig
  runAI?: TextOpenWorldCreatorArtifactEditRunAI
  signal?: AbortSignal
  onDurableBoundary?: (
    boundary: TextOpenWorldCreatorArtifactEditBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<{
  snapshot: AgentRunSnapshotV1
  patch: TextOpenWorldCreatorEditPatchV1
  evidence: Pick<CreatorEditEvidenceEnvelopeV1,
  'requestArtifactHash' | 'modelResultArtifactHash' | 'responseArtifactHash'>
  modelEvidence: TextOpenWorldCreatorEditModelEvidenceV1
  modelUsage: TextOpenWorldCreatorEditModelUsageV1
}> {
  if (!input.prepared.authorInstruction) fail('instruction', 'Agent 模式缺少作者要求')
  const messages = buildTextOpenWorldCreatorArtifactEditMessagesV1({
    registeredContext: input.registeredContext,
    authorInstruction: input.prepared.authorInstruction,
  })
  const estimatedPromptTokens = messages.reduce(
    (total, message) => total + estimateTokens(message.content),
    0,
  )
  if (estimatedPromptTokens > input.snapshot.contract.budget.maxInputTokens) {
    fail('model-budget', '完整 rendered request 在模型调用前已超过 Run Contract 输入预算')
  }
  const requestContent = canonicalStringify({
    schema: 'storyforge.text-open-world-creator-edit-rendered-request',
    version: 1,
    registeredContext: input.registeredContext,
    authorInstruction: input.prepared.authorInstruction,
    messages,
    responseFormat: 'json_object',
  })
  let snapshot = input.snapshot
  const request = await recordAgentRunArtifactV1({
    scope: input.prepared.selection.scope,
    runId: snapshot.run.id,
    artifactKind: 'rendered-request',
    content: requestContent,
    stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
    attempt: 1,
    expectedLastSequence: snapshot.projection.lastSequence,
  })
  snapshot = request.snapshot
  await notifyBoundary(input.onDurableBoundary, 'request.recorded', snapshot)
  const requestBindingHash = await hashCanonicalValue({
    runtimeBindingHash: input.prepared.runtimeBindingHash,
    requestArtifactHash: request.artifact.contentHash,
    executionBinding: snapshot.contract.executionBindings?.[0],
  })
  const requested = eventFor(snapshot, 'model.requested')
  if (requested.length > 1) fail('model-evidence', 'model.requested 不唯一')
  const resultEvidence = exactArtifactEvent(snapshot, 'tool-result')
  const responseEvidence = exactArtifactEvent(snapshot, 'raw-response')
  if (requested.length && (requested[0]!.type !== 'model.requested'
    || requested[0]!.payload.bindingHash !== requestBindingHash)) {
    fail('model-evidence', '既有 model.requested 绑定不一致')
  }
  if ((resultEvidence || responseEvidence) && requested.length !== 1) {
    fail('model-evidence', '模型结果证据缺少唯一在先 model.requested')
  }
  if (responseEvidence && !resultEvidence) {
    fail('model-evidence', 'raw-response 缺少可恢复的 tool-result 模型结果证据')
  }
  let raw: string
  let durableResult: CreatorEditModelResultArtifactV1
  if (resultEvidence) {
    const requestEvent = exactArtifactEvent(snapshot, 'rendered-request')
      ?? fail('model-evidence', '已知模型结果缺少 rendered-request')
    await assertKnownModelRequestEvidenceV1({ snapshot, requestEvent, resultEvent: resultEvidence })
    const durableText = await readAgentRunArtifactExactV1({
      projectId: input.prepared.selection.scope.projectId,
      artifactKind: 'tool-result',
      contentHash: resultEvidence.payload.contentHash,
    })
    if (toolResultArtifactSchemaV1(durableText)
      === 'storyforge.text-open-world-creator-edit-model-failure') {
      const failure = parseModelFailureArtifactBody(durableText)
      assertModelFailureArtifactSemanticsV1(failure)
      if (failure.provider !== input.prepared.modelIdentity.provider
        || failure.model !== input.prepared.modelIdentity.model
        || exactArtifactEvent(snapshot, 'raw-response') !== null
        || eventFor(snapshot, 'model.responded').length !== 0
        || (failure.usage && (
          failure.usage.inputTokens > snapshot.contract.budget.maxInputTokens
          || failure.usage.outputTokens > snapshot.contract.budget.maxOutputTokens
        ))) {
        fail('model-result', '已持久化模型失败证据与当前运行绑定不一致')
      }
      await failCreatorEditRunV1({
        scope: input.prepared.selection.scope,
        runId: snapshot.run.id,
        code: failure.failureCode,
        retryable: failure.retryable,
        category: modelFailureCategoryV1(failure),
      })
      fail('model-response-failed', '模型请求已返回可证明的失败结果；用量证据已结算，不会自动重试')
    }
    durableResult = await parseModelResultArtifactBody(durableText)
    if (durableResult.provider !== input.prepared.modelIdentity.provider
      || durableResult.model !== input.prepared.modelIdentity.model) {
      fail('model-result', '已持久化模型结果与当前运行绑定不一致')
    }
    raw = durableResult.rawResponse
  } else {
    if (requested.length) {
      if (snapshot.projection.state === 'running') {
        snapshot = await appendRun(input.prepared.selection.scope, snapshot, 'run.paused', {
          reason: 'creator-edit-model-outcome-unknown',
          recoverable: false,
        })
      }
      fail('model-outcome-unknown', '模型请求已发出但没有 durable response；为避免重复计费不会自动重发')
    }
    const claim = await claimCreatorEditModelRequestV1({
      prepared: input.prepared,
      snapshot,
      requestBindingHash,
    })
    snapshot = claim.snapshot
    if (!claim.claimed) {
      fail(
        'model-request-in-flight',
        '同一模型请求已由另一个执行者取得执行权；本执行者不会暂停、重发或修改共享 Run',
      )
    }
    await notifyBoundary(input.onDurableBoundary, 'model.requested', snapshot)
    const startedAt = Date.now()
    const result: ChatResult = {}
    try {
      raw = input.runAI
        ? await input.runAI(messages, input.signal)
        : await executeFrozenFormalAIEntryV1(
            'text-open-world.creator-artifact.modify',
            input.prepared.formalEntry
              ?? fail('run-contract', 'Agent 模型调用缺少冻结正式入口'),
            projectFrozenAgentSkillDefinitionV1(
              input.prepared.executionBinding
                ?? fail('run-contract', 'Agent 模型调用缺少冻结 Skill'),
            ),
            'src/lib/open-world/creator-artifact-edit.ts',
            messages,
            input.aiConfig!,
            {
              category: 'authoring.text-open-world-creator-artifact-edit',
              projectId: input.prepared.selection.scope.projectId,
              configOverrides: {
                maxTokens: input.prepared.executionBinding?.maxOutputTokens
                  ?? fail('run-contract', 'Agent 模型调用缺少冻结输出预算'),
              },
              contextOverflowPolicy: 'reject',
            },
            input.signal,
            result,
            { responseFormat: 'json_object' },
            input.prepared.resolvedConfig ?? undefined,
          )
    } catch (cause) {
      const lifecycle = result.requestLifecycle
      const status = lifecycle?.phase === 'response-observed' ? lifecycle.responseStatus : null
      const providerUsage = safeProviderUsageV1(result.usage)
      const retryable = status != null && retryableCreatorEditResponseStatusV1(status)
      const knownFailure = lifecycle?.phase === 'pre-dispatch'
        || (lifecycle?.phase === 'response-observed' && status != null
          && (status < 200 || status >= 300 || providerUsage != null))
      if (knownFailure) {
        const durationMs = Math.max(0, Date.now() - startedAt)
        const usage: TextOpenWorldCreatorEditModelUsageV1 | null =
          lifecycle?.phase === 'response-observed' && providerUsage ? {
          modelCalls: 1,
          inputTokens: providerUsage.inputTokens,
          outputTokens: providerUsage.outputTokens,
          costUsd: computeKnownCostUsd(
            input.prepared.modelIdentity.model,
            providerUsage.inputTokens,
            providerUsage.outputTokens,
          ),
          durationMs,
        } : null
        const phase = lifecycle!.phase as 'pre-dispatch' | 'response-observed'
        const failureCode = phase === 'pre-dispatch'
          ? 'creator-edit-model-not-dispatched'
          : `creator-edit-model-response-${status}`
        const failureArtifact: CreatorEditModelFailureArtifactV1 = {
          schema: 'storyforge.text-open-world-creator-edit-model-failure',
          version: 1,
          provider: input.prepared.modelIdentity.provider,
          model: input.prepared.modelIdentity.model,
          phase,
          responseStatus: status,
          failureCode,
          retryable,
          usageKnown: usage !== null,
          usage,
        }
        assertModelFailureArtifactSemanticsV1(failureArtifact)
        parseModelFailureArtifactBody(canonicalStringify(failureArtifact))
        const recorded = await recordAgentRunArtifactV1({
          scope: input.prepared.selection.scope,
          runId: snapshot.run.id,
          artifactKind: 'tool-result',
          content: canonicalStringify(failureArtifact),
          stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
          attempt: 1,
          expectedLastSequence: snapshot.projection.lastSequence,
        })
        snapshot = recorded.snapshot
        await notifyBoundary(input.onDurableBoundary, 'model-result.recorded', snapshot)
        await failCreatorEditRunV1({
          scope: input.prepared.selection.scope,
          runId: snapshot.run.id,
          code: failureCode,
          retryable,
          category: phase === 'pre-dispatch'
            ? 'deterministic'
            : retryable
              ? 'transient'
              : status != null && (status < 200 || status >= 300)
                ? 'deterministic'
                : 'protocol',
        })
      } else {
        const current = await readAgentRunV1(input.prepared.selection.scope, snapshot.run.id)
        if (current.projection.state === 'running') {
          await appendRun(input.prepared.selection.scope, current, 'run.paused', {
            reason: 'creator-edit-model-outcome-unknown',
            recoverable: false,
          })
        }
      }
      throw cause
    }
    const durationMs = Math.max(0, Date.now() - startedAt)
    const providerUsage = safeProviderUsageV1(result.usage)
    const inputTokens = providerUsage?.inputTokens ?? estimatedPromptTokens
    const outputTokens = providerUsage?.outputTokens ?? estimateTokens(raw)
    const modelUsage: TextOpenWorldCreatorEditModelUsageV1 = {
      modelCalls: 1,
      inputTokens,
      outputTokens,
      costUsd: computeKnownCostUsd(input.prepared.modelIdentity.model, inputTokens, outputTokens),
      durationMs,
    }
    parseModelUsageArtifactV1(modelUsage, '模型结果')
    durableResult = await createModelResultArtifactBody({
      provider: input.prepared.modelIdentity.provider,
      model: input.prepared.modelIdentity.model,
      rawResponse: raw,
      usage: modelUsage,
    })
    const modelResult = await recordAgentRunArtifactV1({
      scope: input.prepared.selection.scope,
      runId: snapshot.run.id,
      artifactKind: 'tool-result',
      content: canonicalStringify(durableResult),
      stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
      attempt: 1,
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    snapshot = modelResult.snapshot
    await notifyBoundary(input.onDurableBoundary, 'model-result.recorded', snapshot)
  }
  let response = exactArtifactEvent(snapshot, 'raw-response')
  if (!response) {
    const response = await recordAgentRunArtifactV1({
      scope: input.prepared.selection.scope,
      runId: snapshot.run.id,
      artifactKind: 'raw-response',
      content: raw,
      stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
      attempt: 1,
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    snapshot = response.snapshot
    await notifyBoundary(input.onDurableBoundary, 'response.recorded', snapshot)
  } else {
    const existingRaw = await readAgentRunArtifactExactV1({
      projectId: input.prepared.selection.scope.projectId,
      artifactKind: 'raw-response',
      contentHash: response.payload.contentHash,
    })
    if (existingRaw !== raw) fail('model-result', 'raw-response 与可恢复模型结果正文不一致')
  }
  response = exactArtifactEvent(snapshot, 'raw-response')
    ?? fail('model-evidence', 'raw-response 记录缺失')
  const responded = eventFor(snapshot, 'model.responded')
  if (responded.length > 1) fail('model-evidence', 'model.responded 不唯一')
  if (!responded.length) {
    snapshot = await appendRun(input.prepared.selection.scope, snapshot, 'model.responded', {
      stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
      attempt: 1,
      outputHash: response.payload.contentHash,
    })
    await notifyBoundary(input.onDurableBoundary, 'model.responded', snapshot)
  } else if (responded[0]!.type !== 'model.responded'
    || responded[0]!.payload.outputHash !== response.payload.contentHash) {
    fail('model-evidence', 'model.responded 与 raw-response 不一致')
  }
  const modelUsage = durableResult.usage
  if (modelUsage.inputTokens > snapshot.contract.budget.maxInputTokens
    || modelUsage.outputTokens > snapshot.contract.budget.maxOutputTokens) {
    fail('model-output-unusable', '模型实际 token 用量超过 Run Contract 预算')
  }
  let patch: TextOpenWorldCreatorEditPatchV1
  try {
    const parsed = parseTextOpenWorldCreatorArtifactEditModelOutputV1(
      raw,
      input.prepared.workspace.targetContext.editableFields,
    )
    patch = await createTextOpenWorldCreatorEditPatchV1({
      baseDraftHash: input.prepared.workspace.targetContext.baseDraftHash,
      operations: parsed.operations,
    })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    fail('model-output-unusable', `模型响应不能形成受治理 Patch：${message}`)
  }
  const modelResult = exactArtifactEvent(snapshot, 'tool-result')
    ?? fail('model-evidence', 'tool-result 模型结果证据缺失')
  return {
    snapshot,
    patch,
    evidence: {
      requestArtifactHash: request.artifact.contentHash,
      modelResultArtifactHash: modelResult.payload.contentHash,
      responseArtifactHash: response.payload.contentHash,
    },
    modelEvidence: {
      schema: 'storyforge.text-open-world-creator-edit-model-evidence',
      version: 1,
      provider: input.prepared.modelIdentity.provider,
      model: input.prepared.modelIdentity.model,
      promptHash: request.artifact.contentHash,
      contextManifestHashes: [input.manifestHash],
      outputHash: response.payload.contentHash,
    },
    modelUsage,
  }
}

async function failCreatorEditRunV1(input: {
  scope: WorkspaceScope
  runId: number
  code: string
  retryable: boolean
  category: 'protocol' | 'transient' | 'deterministic' | 'budget'
}): Promise<void> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  if (snapshot.projection.state !== 'running') return
  const step = snapshot.projection.steps[TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1]
  if (step?.status === 'running') {
    snapshot = await appendRun(input.scope, snapshot, 'step.failed', {
      stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
      attempt: 1,
      code: input.code,
      retryable: input.retryable,
      category: input.category,
      action: 'fail',
    })
  }
  if (!['failed', 'cancelled', 'completed'].includes(snapshot.projection.state)) {
    await appendRun(input.scope, snapshot, 'run.failed', {
      code: input.code,
      retryable: input.retryable,
    })
  }
}

export interface TextOpenWorldCreatorArtifactEditGenerationInputV1 {
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
  mode: 'direct' | 'agent'
  operations?: readonly TextOpenWorldCreatorEditPatchOperationV1[]
  authorInstruction?: string
  aiConfig?: AIConfig
  runAI?: TextOpenWorldCreatorArtifactEditRunAI
  modelIdentity?: { provider: string; model: string }
  signal?: AbortSignal
  onDurableBoundary?: (
    boundary: TextOpenWorldCreatorArtifactEditBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}

export async function generateTextOpenWorldCreatorArtifactEditCandidateV1(
  input: TextOpenWorldCreatorArtifactEditGenerationInputV1,
): Promise<TextOpenWorldCreatorArtifactEditStateV1> {
  const prepared = await prepareGeneration(input)
  return withCreatorEditOperationLockV1(
    groupOperationLockKey(
      input.selection.scope,
      input.selection.buildId,
      prepared.workspace.targetContext.ownerSiblingGroup.baseGroupHash,
    ),
    async () => {
      const initial = await createOrReadRun(prepared)
      const intake = await ensureCreatorEditIntakeCheckpointV1(initial)
      if (intake.created) {
        await notifyBoundary(input.onDurableBoundary, 'intake.checkpoint', intake.snapshot)
      }
      return generateTextOpenWorldCreatorArtifactEditCandidateLockedV1(
        input,
        initial.prepared,
        initial.snapshot.run.id,
      )
    },
  )
}

export interface TextOpenWorldCreatorArtifactEditIntakeResumeInputV1 {
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
  runId: number
  aiConfig?: AIConfig
  runAI?: TextOpenWorldCreatorArtifactEditRunAI
  signal?: AbortSignal
  onDurableBoundary?: (
    boundary: TextOpenWorldCreatorArtifactEditBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}

/**
 * Explicitly resumes a durably frozen pre-candidate request. The caller may
 * provide current credentials or a test runner, but cannot replace the frozen
 * instruction, patch, model identity, Skill binding, relation, or base scope.
 */
export async function resumeTextOpenWorldCreatorArtifactEditIntakeV1(
  input: TextOpenWorldCreatorArtifactEditIntakeResumeInputV1,
): Promise<TextOpenWorldCreatorArtifactEditStateV1> {
  assertSelection(input.selection)
  if (!Number.isSafeInteger(input.runId) || input.runId < 1) {
    fail('intake-resume', '恢复 Creator edit intake 必须提供有效 runId')
  }
  const completedState = await readState(input.selection.scope, input.runId)
  if (completedState) {
    assertCandidateMatchesSelection(input.selection, completedState.candidate)
    return withCreatorEditOperationLockV1(
      groupOperationLockKey(
        input.selection.scope,
        input.selection.buildId,
        completedState.candidate.ownerSiblingGroup.baseGroupHash,
      ),
      async () => {
        const current = await readState(input.selection.scope, input.runId)
          ?? fail('intake-resume', '并发读取后已形成的 Creator edit 候选不可恢复')
        assertCandidateMatchesSelection(input.selection, current.candidate)
        return repairCandidateEvent(input.selection.scope, current)
      },
    )
  }
  const first = await readCreatorEditIntakeStateV1(input.selection.scope, input.runId)
    ?? fail('intake-resume', '该 Run 没有可显式恢复的 Creator edit intake')
  if (!sameJson(first.checkpoint.intake.selection, input.selection)) {
    fail('selection-mismatch', 'runId 不属于调用方声明的精确 Creator edit 目标')
  }
  return withCreatorEditOperationLockV1(
    groupOperationLockKey(
      input.selection.scope,
      input.selection.buildId,
      first.prepared.workspace.targetContext.ownerSiblingGroup.baseGroupHash,
    ),
    async () => {
      const state = await readCreatorEditIntakeStateV1(input.selection.scope, input.runId)
        ?? fail('intake-resume', '并发推进后 Creator edit intake 已不再是最新恢复边界')
      const intake = state.checkpoint.intake
      if (!sameJson(intake.selection, input.selection)) {
        fail('selection-mismatch', '并发恢复时 Creator edit selection 已变化')
      }
      const requested = eventFor(state.snapshot, 'model.requested')
      const result = exactArtifactEvent(state.snapshot, 'tool-result')
      if (requested.length > 0 && !result) {
        fail('model-outcome-unknown', '模型请求已发出但没有 durable response；不会通过 intake 恢复重发')
      }
      const generationInput: TextOpenWorldCreatorArtifactEditGenerationInputV1 = intake.mode === 'direct'
        ? {
            selection: input.selection,
            mode: 'direct',
            operations: intake.patch?.operations
              ?? fail('intake-resume', 'Direct Creator edit intake 缺少 Patch'),
            signal: input.signal,
            onDurableBoundary: input.onDurableBoundary,
          }
        : {
            selection: input.selection,
            mode: 'agent',
            authorInstruction: intake.authorInstruction
              ?? fail('intake-resume', 'Agent Creator edit intake 缺少作者要求'),
            aiConfig: input.aiConfig,
            runAI: input.runAI,
            modelIdentity: input.runAI ? intake.modelIdentity : undefined,
            signal: input.signal,
            onDurableBoundary: input.onDurableBoundary,
          }
      const preparedBase = await prepareGeneration({
        ...generationInput,
        frozenAgentExecution: intake.mode === 'agent'
          ? await frozenCreatorEditAgentExecutionFromRunV1(state.snapshot)
          : undefined,
      })
      const prepared = { ...preparedBase, relation: intake.relation }
      await assertCreatorEditIntakeAuthorityV1({
        scope: input.selection.scope,
        snapshot: state.snapshot,
        checkpointRecord: state.checkpointRecord,
        checkpoint: state.checkpoint,
        expectedPrepared: prepared,
      })
      return generateTextOpenWorldCreatorArtifactEditCandidateLockedV1(
        generationInput,
        prepared,
        input.runId,
      )
    },
  )
}

async function generateTextOpenWorldCreatorArtifactEditCandidateLockedV1(
  input: TextOpenWorldCreatorArtifactEditGenerationInputV1,
  prepared: GenerationPreparedV1,
  runId: number,
): Promise<TextOpenWorldCreatorArtifactEditStateV1> {
  let snapshot = await readAgentRunV1(input.selection.scope, runId)
  let candidateConstructed = false
  const restored = await readState(input.selection.scope, snapshot.run.id)
  if (restored) return repairCandidateEvent(input.selection.scope, restored)
  const intake = await readCreatorEditIntakeStateV1(input.selection.scope, snapshot.run.id)
    ?? fail('intake', 'Creator edit 候选生成前缺少 durable intake checkpoint')
  await assertCreatorEditIntakeAuthorityV1({
    scope: input.selection.scope,
    snapshot: intake.snapshot,
    checkpointRecord: intake.checkpointRecord,
    checkpoint: intake.checkpoint,
    expectedPrepared: prepared,
  })
  snapshot = intake.snapshot
  if (snapshot.projection.state === 'paused') {
    fail('paused', '该修改请求停在不可安全重发的模型边界，请创建新的修改请求')
  }
  if (!['planned', 'running'].includes(snapshot.projection.state)) {
    fail('run-state', `Creator edit Run 状态 ${snapshot.projection.state} 不可生成候选`)
  }
  snapshot = await ensureRunStarted(input.selection.scope, snapshot)
  await notifyBoundary(input.onDurableBoundary, 'run.started', snapshot)
  try {
    const context = await recordContext({ prepared, snapshot })
    snapshot = context.snapshot
    await notifyBoundary(input.onDurableBoundary, 'context.recorded', snapshot)
    let patch = prepared.patch
    let modelEvidence: TextOpenWorldCreatorEditModelEvidenceV1 | null = null
    let modelUsage: TextOpenWorldCreatorEditModelUsageV1 = {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      durationMs: 0,
    }
    let requestArtifactHash: string | null = null
    let modelResultArtifactHash: string | null = null
    let responseArtifactHash: string | null = null
    if (prepared.mode === 'agent') {
      const agent = await resolveAgentPatch({
        prepared,
        snapshot,
        registeredContext: context.registeredContext,
        manifestHash: context.manifestHash,
        aiConfig: input.aiConfig,
        runAI: input.runAI,
        signal: input.signal,
        onDurableBoundary: input.onDurableBoundary,
      })
      snapshot = agent.snapshot
      patch = agent.patch
      modelEvidence = agent.modelEvidence
      modelUsage = agent.modelUsage
      requestArtifactHash = agent.evidence.requestArtifactHash
      modelResultArtifactHash = agent.evidence.modelResultArtifactHash
      responseArtifactHash = agent.evidence.responseArtifactHash
    }
    if (!patch) fail('patch', 'Creator edit 缺少确定性 Patch')
    const candidate = await buildCandidate({
      workspace: prepared.workspace,
      patch,
      mode: prepared.mode,
      modelEvidence,
      modelUsage,
    })
    candidateConstructed = true
    const checkpoint: TextOpenWorldCreatorArtifactEditCheckpointV1 = {
      schema: 'storyforge.text-open-world-creator-edit-checkpoint',
      version: 1,
      portable: false,
      phase: 'candidate',
      requestHash: prepared.requestHash,
      evidence: {
        contextManifestHash: context.manifestHash,
        contextArtifactHash: context.contextArtifactHash,
        requestArtifactHash,
        modelResultArtifactHash,
        responseArtifactHash,
      },
      candidate,
      intent: null,
      terminalReceipt: null,
      verificationReceipt: null,
    }
    snapshot = (await createAgentRunCheckpointV1({
      scope: input.selection.scope,
      runId: snapshot.run.id,
      resumePayload: checkpoint,
      expectedLastSequence: snapshot.projection.lastSequence,
    })).snapshot
    await notifyBoundary(input.onDurableBoundary, 'candidate.checkpoint', snapshot)
    snapshot = await appendRun(input.selection.scope, snapshot, 'candidate.persisted', {
      stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
      attempt: 1,
      candidateHash: candidate.candidateHash,
      requiresConfirmation: true,
    })
    await notifyBoundary(input.onDurableBoundary, 'candidate.persisted', snapshot)
    return { snapshot, checkpoint, candidate, intent: null, terminalReceipt: null, verificationReceipt: null }
  } catch (cause) {
    if (cause instanceof CreatorEditDurableBoundaryInterruptionV1) throw cause.cause
    if (cause instanceof TextOpenWorldCreatorArtifactEditErrorV1
      && cause.code === 'model-request-in-flight') throw cause
    if (isConcurrentMutationError(cause)) {
      fail('concurrent-executor', '同一修改 Run 已由另一个执行者推进，请恢复该 Run 的最新状态')
    }
    const current = await readAgentRunV1(input.selection.scope, snapshot.run.id)
    let hasRecoverableCheckpoint = false
    try {
      hasRecoverableCheckpoint = await readState(input.selection.scope, current.run.id) !== null
    } catch {
      // A malformed checkpoint is not a recovery authority.
    }
    if (hasRecoverableCheckpoint) throw cause
    const requested = eventFor(current, 'model.requested')
    const modelResult = exactArtifactEvent(current, 'tool-result')
    const rawResponse = exactArtifactEvent(current, 'raw-response')
    const responded = eventFor(current, 'model.responded')
    if (requested.length > 0 && !modelResult) {
      if (current.projection.state === 'running') {
        await appendRun(input.selection.scope, current, 'run.paused', {
          reason: 'creator-edit-model-outcome-unknown',
          recoverable: false,
        })
      }
      throw cause
    }
    if (current.projection.state === 'running'
      && cause instanceof TextOpenWorldCreatorArtifactEditErrorV1
      && cause.code === 'model-output-unusable') {
      if (!modelResult || !rawResponse || responded.length !== 1) {
        fail('model-output-evidence', '模型输出不可用失败缺少完整的已知响应证据')
      }
      await failCreatorEditRunV1({
        scope: input.selection.scope,
        runId: snapshot.run.id,
        code: 'creator-edit-model-output-unusable',
        retryable: false,
        category: 'protocol',
      })
      throw cause
    }
    const knownResultPersistenceWindow = candidateConstructed || Boolean(modelResult)
    if (current.projection.state === 'running' && knownResultPersistenceWindow) {
      // A model result or fully built candidate already exists in memory/durable
      // evidence. Keep the same Run resumable; never turn this crash window into
      // a failed sibling that permits another paid provider request.
      throw cause
    }
    if (current.projection.state === 'running') {
      await failCreatorEditRunV1({
        scope: input.selection.scope,
        runId: snapshot.run.id,
        code: 'creator-edit-generation-failed',
        retryable: false,
        category: 'protocol',
      })
    }
    throw cause
  }
}

function selectionFromCandidate(
  scope: WorkspaceScope,
  candidate: TextOpenWorldCreatorEditCandidateV1,
): TextOpenWorldCreatorArtifactEditSelectionV1 {
  return {
    scope,
    productionId: candidate.production.productionId,
    buildId: candidate.baseBuild.buildId,
    expectedSnapshotHash: candidate.governanceSnapshotHash,
    artifactKey: candidate.target.artifactKey,
    entityIdentity: candidate.target.entityIdentity,
  }
}

function assertCandidateMatchesSelection(
  selection: TextOpenWorldCreatorArtifactEditSelectionV1,
  candidate: TextOpenWorldCreatorEditCandidateV1,
): void {
  assertSelection(selection)
  if (!candidateMatchesSelectionV1(selection, candidate)) {
    fail('selection-mismatch', 'runId 不属于调用方声明的精确 Creator edit 目标')
  }
}

function candidateMatchesSelectionV1(
  selection: TextOpenWorldCreatorArtifactEditSelectionV1,
  candidate: TextOpenWorldCreatorEditCandidateV1,
): boolean {
  return candidate.production.productionId === selection.productionId
    && candidate.baseBuild.buildId === selection.buildId
    && candidate.governanceSnapshotHash === selection.expectedSnapshotHash
    && candidate.target.artifactKey === selection.artifactKey
    && candidate.target.entityIdentity === selection.entityIdentity
}

interface CreatorEditFrozenProductionBuildAuthorityV1 {
  production: {
    id: number
    productionKey: string
    stateRevision: number
    status?: ProductProductionRecordV1['status']
  }
  build: {
    id: number
    buildNumber: number
    stateRevision: number
    controlEpoch: number
    planHash: string
    manifestHash: string
    rootTerminalReceiptHash: string
    status?: ProductBuildRecordV1['status']
  }
}

/**
 * Final transaction-local CAS before an irreversible model request or author
 * confirmation is recorded. The earlier semantic resolver proves the rich
 * governance snapshot; this guard closes the time-of-check/time-of-use gap by
 * enlisting the two authoritative Product stores in the same IndexedDB
 * transaction as the Run event.
 */
async function assertCreatorEditBaseRowsInTransactionV1(input: {
  scope: WorkspaceScope
} & CreatorEditFrozenProductionBuildAuthorityV1): Promise<void> {
  const [production, build] = await Promise.all([
    db.productProductions.get(input.production.id),
    db.productBuilds.get(input.build.id),
  ])
  if (!production || !build
    || production.id !== input.production.id
    || build.id !== input.build.id
    || production.projectId !== input.scope.projectId
    || production.worldId !== input.scope.worldId
    || production.workId !== input.scope.workId
    || build.projectId !== input.scope.projectId
    || build.worldId !== input.scope.worldId
    || build.workId !== input.scope.workId
    || production.productType !== 'text-open-world'
    || build.productionId !== input.production.id
    || production.productionKey !== input.production.productionKey
    || production.stateRevision !== input.production.stateRevision
    || production.currentBuildNumber !== input.build.buildNumber
    || build.buildNumber !== input.build.buildNumber
    || build.stateRevision !== input.build.stateRevision
    || build.controlEpoch !== input.build.controlEpoch
    || build.planHash !== input.build.planHash
    || build.manifestHash !== input.build.manifestHash
    || build.rootTerminalReceiptHash !== input.build.rootTerminalReceiptHash
    || (input.production.status != null && production.status !== input.production.status)
    || (input.build.status != null && build.status !== input.build.status)) {
    fail(
      'base-stale',
      '模型调用或确认写入前，ProductProduction/ProductBuild 权威已变化',
    )
  }
}

async function assertCandidateBaseFresh(
  scope: WorkspaceScope,
  candidate: TextOpenWorldCreatorEditCandidateV1,
): Promise<TextOpenWorldCreatorEditWorkspaceV1> {
  const workspace = await resolveTextOpenWorldCreatorEditWorkspaceV1(
    assembleInput(selectionFromCandidate(scope, candidate)),
  )
  const context = workspace.targetContext
  const currentBase = {
    production: {
      productionId: context.production.id,
      productionKey: context.production.productionKey,
      stateRevision: context.production.stateRevision,
    },
    baseBuild: {
      buildId: context.build.id,
      buildNumber: context.build.buildNumber,
      stateRevision: context.build.stateRevision,
      controlEpoch: context.build.controlEpoch,
      planHash: context.build.planHash,
      manifestHash: context.build.manifestHash,
      rootTerminalReceiptHash: context.build.rootTerminalReceiptHash,
    },
    governanceSnapshotHash: context.governanceSnapshotHash,
    ownerSiblingGroup: context.ownerSiblingGroup,
    producerEvidence: context.producerEvidence,
  }
  if (!sameJson(currentBase.production, candidate.production)
    || !sameJson(currentBase.baseBuild, candidate.baseBuild)
    || currentBase.governanceSnapshotHash !== candidate.governanceSnapshotHash
    || !sameJson(currentBase.ownerSiblingGroup, candidate.ownerSiblingGroup)
    || !sameJson(currentBase.producerEvidence, candidate.producerEvidence)
    || !sameJson(context.target, candidate.target)
    || context.baseDraftHash !== candidate.baseDraftHash
    || !sameJson(context.editableFields, candidate.editableFields)) {
    fail('base-stale', '当前治理快照、Build、owner sibling 或目标字段已变化')
  }
  const replayed = await buildCandidate({
    workspace,
    patch: candidate.patch,
    mode: candidate.mode,
    modelEvidence: candidate.modelEvidence,
    modelUsage: candidate.modelUsage,
    revisionProvenance: candidate.revisionProvenance,
    createdAt: candidate.createdAt,
  })
  if (replayed.candidateHash !== candidate.candidateHash) {
    fail('candidate-stale', '当前领域投影或验证代码不能重现该修改候选')
  }
  return workspace
}

export interface TextOpenWorldCreatorArtifactEditRevisionInputV1 {
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
  runId: number
  operations: readonly TextOpenWorldCreatorEditPatchOperationV1[]
  onDurableBoundary?: (
    boundary: TextOpenWorldCreatorArtifactEditBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}

export function reviseTextOpenWorldCreatorArtifactEditCandidateV1(
  input: TextOpenWorldCreatorArtifactEditRevisionInputV1,
): Promise<TextOpenWorldCreatorArtifactEditStateV1> {
  return withCreatorEditOperationLockV1(
    runOperationLockKey(input.selection.scope, input.runId),
    () => reviseTextOpenWorldCreatorArtifactEditCandidateLockedV1(input),
  )
}

async function reviseTextOpenWorldCreatorArtifactEditCandidateLockedV1(
  input: TextOpenWorldCreatorArtifactEditRevisionInputV1,
): Promise<TextOpenWorldCreatorArtifactEditStateV1> {
  let state = await readState(input.selection.scope, input.runId)
  if (!state || state.checkpoint.phase !== 'candidate'
    || !['running', 'awaiting_confirmation'].includes(state.snapshot.projection.state)) {
    fail('revision-state', 'Creator edit 没有可修订的待确认候选')
  }
  assertCandidateMatchesSelection(input.selection, state.candidate)
  state = await repairCandidateEvent(input.selection.scope, state)
  if (state.snapshot.projection.state !== 'awaiting_confirmation') {
    fail('revision-state', 'Creator edit 候选事件无法恢复到等待确认状态')
  }
  const workspace = await assertCandidateBaseFresh(input.selection.scope, state.candidate)
  const patch = await createTextOpenWorldCreatorEditPatchV1({
    baseDraftHash: state.candidate.baseDraftHash,
    operations: input.operations,
  })
  if (sameJson(patch, state.candidate.patch)) return state
  const revisedAt = Date.now()
  const candidate = await buildCandidate({
    workspace,
    patch,
    mode: state.candidate.mode,
    modelEvidence: state.candidate.modelEvidence,
    modelUsage: state.candidate.modelUsage,
    revisionProvenance: {
      source: 'deterministic-author-revision',
      originCandidateHash: state.candidate.revisionProvenance?.originCandidateHash
        ?? state.candidate.candidateHash,
      originPatchHash: state.candidate.revisionProvenance?.originPatchHash
        ?? state.candidate.patch.patchHash,
      previousCandidateHash: state.candidate.candidateHash,
      revisionPatchHash: patch.patchHash,
      revisedAt,
    },
    createdAt: revisedAt,
  })
  const checkpoint: Extract<TextOpenWorldCreatorArtifactEditCheckpointV1, { phase: 'candidate' }> = {
    schema: 'storyforge.text-open-world-creator-edit-checkpoint',
    version: 1,
    portable: false,
    phase: 'candidate',
    requestHash: state.checkpoint.requestHash,
    evidence: state.checkpoint.evidence,
    candidate,
    intent: null,
    terminalReceipt: null,
    verificationReceipt: null,
  }
  let snapshot = (await createAgentRunCheckpointV1({
    scope: input.selection.scope,
    runId: state.snapshot.run.id,
    resumePayload: checkpoint,
    expectedLastSequence: state.snapshot.projection.lastSequence,
  })).snapshot
  snapshot = await appendRun(input.selection.scope, snapshot, 'candidate.revised', {
    stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
    attempt: 1,
    previousCandidateHash: state.candidate.candidateHash,
    candidateHash: candidate.candidateHash,
  })
  await notifyBoundary(input.onDurableBoundary, 'candidate.revised', snapshot)
  return { snapshot, checkpoint, candidate, intent: null, terminalReceipt: null, verificationReceipt: null }
}

export function rejectTextOpenWorldCreatorArtifactEditCandidateV1(input: {
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
  runId: number
}): Promise<AgentRunSnapshotV1> {
  return withCreatorEditOperationLockV1(
    runOperationLockKey(input.selection.scope, input.runId),
    async () => {
      let state = await readState(input.selection.scope, input.runId)
      if (!state || state.checkpoint.phase !== 'candidate') {
        fail('reject-state', 'Creator edit 没有可拒绝的待确认候选')
      }
      assertCandidateMatchesSelection(input.selection, state.candidate)
      if (state.snapshot.projection.state === 'cancelled') {
        await verifyRecordedMemorySettlementV1({
          snapshot: state.snapshot,
          scope: input.selection.scope,
        })
        return state.snapshot
      }
      const step = state.snapshot.projection.steps[TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1]
      if (step?.confirmation !== 'reject') {
        state = await repairCandidateEvent(input.selection.scope, state)
        if (state.snapshot.projection.state !== 'awaiting_confirmation') {
          fail('reject-state', 'Creator edit 没有可拒绝的待确认候选')
        }
        const snapshot = await appendRun(
          input.selection.scope,
          state.snapshot,
          'confirmation.recorded',
          {
            stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
            candidateHash: state.candidate.candidateHash,
            decision: 'reject',
          },
        )
        state = { ...state, snapshot }
      }
      return appendRun(input.selection.scope, state.snapshot, 'run.cancelled', {
        reason: 'author-rejected-creator-edit-candidate',
      })
    },
  )
}

/** Cancel a frozen intake only while no provider request has been dispatched. */
export async function cancelTextOpenWorldCreatorArtifactEditIntakeV1(input: {
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
  runId: number
}): Promise<AgentRunSnapshotV1> {
  assertSelection(input.selection)
  if (!Number.isSafeInteger(input.runId) || input.runId < 1) {
    fail('intake-cancel', '取消 Creator edit intake 必须提供有效 runId')
  }
  const intakeState = await readCreatorEditStaticIntakeStateV1(input.selection.scope, input.runId)
    ?? fail('intake-cancel', '该 Run 没有可取消的 durable Creator edit intake')
  if (!sameJson(intakeState.checkpoint.intake.selection, input.selection)) {
    fail('selection-mismatch', 'runId 不属于调用方声明的精确 Creator edit 目标')
  }
  const baseGroupHash = intakeState.snapshot.run.parentArtifactHash
  if (!baseGroupHash || !isSha256Hash(baseGroupHash)) {
    fail('intake-cancel', 'Creator edit intake 缺少冻结 owner sibling group 身份')
  }
  return withCreatorEditOperationLockV1(
    groupOperationLockKey(
      input.selection.scope,
      input.selection.buildId,
      baseGroupHash,
    ),
    () => withAgentRunMutationLockV1(input.runId, () => db.transaction(
      'rw',
      agentRunScopeTransactionTablesV1(
        input.runId,
        db.agentRuns,
        db.agentRunEvents,
        db.agentRunCheckpoints,
        db.worlds,
        db.works,
      ),
      async () => {
        const snapshot = await readVerifiedAgentRunInTransactionV1(
          input.selection.scope,
          input.runId,
        )
        const rows = await db.agentRunCheckpoints.where('runId').equals(input.runId).sortBy('throughSequence')
        const latest = rows[rows.length - 1]
        if (!latest
          || latest.checkpointHash !== intakeState.checkpointRecord.checkpointHash
          || snapshot.projection.lastCheckpointHash !== latest.checkpointHash
          || snapshot.run.contractHash !== intakeState.snapshot.run.contractHash
          || snapshot.run.parentRelation !== intakeState.snapshot.run.parentRelation) {
          fail('intake-cancel', 'Creator edit intake 在取消前已被并发推进或替换')
        }
        if (snapshot.projection.state === 'cancelled') {
          if (!isExplicitlyCancelledUndispatchedIntakeV1(snapshot)) {
            fail('intake-cancel', '该 Run 已由其它原因终止，不能伪装成未派发取消')
          }
          await Dexie.waitFor(verifyRecordedMemorySettlementV1({
            snapshot,
            scope: input.selection.scope,
          }))
          return snapshot
        }
        if (!['planned', 'running'].includes(snapshot.projection.state)
          || eventFor(snapshot, 'model.requested').length !== 0
          || exactArtifactEvent(snapshot, 'tool-result') !== null
          || exactArtifactEvent(snapshot, 'raw-response') !== null
          || eventFor(snapshot, 'model.responded').length !== 0) {
          fail('intake-cancel', '只有尚未派发任何模型请求的 intake 可以安全取消')
        }
        const event = parseAgentRunEventV1({
          version: 1,
          runId: snapshot.run.id,
          sequence: snapshot.projection.lastSequence + 1,
          generation: snapshot.projection.generation,
          projectId: snapshot.run.projectId,
          worldGroupId: snapshot.run.worldGroupId ?? null,
          contractHash: snapshot.projection.contractHash,
          type: 'run.cancelled',
          createdAt: Date.now(),
          payload: { reason: UNDISPATCHED_INTAKE_CANCEL_REASON },
        })
        return appendAgentRunEventWithSettlementInTransactionV1({
          snapshot,
          event,
          scope: input.selection.scope,
          workspaceDirty: true,
        })
      },
    )),
  )
}

async function assertUnknownModelOutcomeRunBindingV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  workspace: TextOpenWorldCreatorEditWorkspaceV1
  verifyLineage?: boolean
}): Promise<FrozenCreatorEditAgentExecutionV1> {
  const { snapshot, workspace } = input
  const context = workspace.targetContext
  const frozenExecution = await frozenCreatorEditAgentExecutionFromRunV1(snapshot)
  const runtimeBindingHash = snapshot.contract.runtimeBindingHash
  const relation = parseCreatorEditRelationV1(snapshot.run.parentRelation)
  if (input.verifyLineage !== false) {
    await assertCreatorEditReplacementLineageV1(input.scope, snapshot, relation.requestHash)
  }
  if (!runtimeBindingHash || !HASH.test(runtimeBindingHash) || !HASH.test(relation.requestHash)) {
    fail('unknown-model-binding', '结果未知 Run 缺少有效的请求或 runtime binding hash')
  }
  const expected = creatorEditContractFromFacts({
    projectId: snapshot.run.projectId,
    target: context.target,
    producerEvidence: context.producerEvidence,
    ownerSiblingGroup: context.ownerSiblingGroup,
    productBuildId: context.build.id,
    buildNumber: context.build.buildNumber,
    controlEpoch: context.build.controlEpoch,
    planHash: context.build.planHash,
    relation: snapshot.run.parentRelation!,
    sourceKeys: [CONTEXT_SOURCE_KEY_V1, MANUAL_SOURCE_KEY_V1],
    runtimeBindingHash,
    mode: 'agent',
    executionBinding: frozenExecution.executionBinding,
    formalEntry: frozenExecution.formalEntry,
  })
  // The selected entity can differ while sharing the same owner sibling group.
  // Its exact target is bound inside runtimeBindingHash and rendered request;
  // cancellation authority is intentionally group-scoped.
  const expectedAtGroupScope = { ...expected, objective: snapshot.contract.objective }
  if (snapshot.run.productBuildId !== context.build.id
    || snapshot.run.parentRunId !== context.producerEvidence.runId
    || snapshot.run.parentReceiptHash !== context.producerEvidence.terminalReceiptHash
    || snapshot.run.parentArtifactHash !== context.ownerSiblingGroup.baseGroupHash
    || canonicalStringify(snapshot.contract) !== canonicalStringify(expectedAtGroupScope)) {
    fail('unknown-model-binding', '结果未知 Run 不属于当前 Build 的精确 owner sibling 治理边界')
  }
  const request = exactArtifactEvent(snapshot, 'rendered-request')
    ?? fail('unknown-model-binding', '结果未知 Run 缺少 rendered-request')
  await assertSingleModelRequestEvidenceV1({ snapshot, requestEvent: request })
  return frozenExecution
}

async function assertUnknownModelRequestMatchesIntakeV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  intakeState: CreatorEditIntakeStateV1
}): Promise<void> {
  const request = exactArtifactEvent(input.snapshot, 'rendered-request')
    ?? fail('unknown-model-binding', '结果未知 Run 缺少 rendered-request')
  await assertCreatorEditModelInputEvidenceV1({
    scope: input.scope,
    snapshot: input.snapshot,
    requestEvent: request,
    intakeState: input.intakeState,
  })
}

/**
 * The only escape hatch for a provider call whose outcome cannot be proven.
 * It never retries the model. The author acknowledges that the remote call may
 * already have incurred a charge, then the Work-owned Run is durably cancelled.
 */
export async function abandonTextOpenWorldCreatorArtifactEditUnknownModelOutcomeV1(
  input: TextOpenWorldCreatorArtifactEditUnknownOutcomeAbandonInputV1,
): Promise<AgentRunSnapshotV1> {
  assertSelection(input.selection)
  if (!Number.isSafeInteger(input.runId) || input.runId < 1
    || input.acknowledgePossibleCharge !== true) {
    fail('unknown-model-abandon', '放弃结果未知请求必须提供有效 runId 并明确确认可能已经计费')
  }
  const workspace = await resolveTextOpenWorldCreatorEditWorkspaceV1(assembleInput(input.selection))
  const context = workspace.targetContext
  const preflightSnapshot = await readAgentRunV1(input.selection.scope, input.runId)
  const preflightRequested = eventFor(preflightSnapshot, 'model.requested')
  const preflightResult = exactArtifactEvent(preflightSnapshot, 'tool-result')
  const preflightResponse = exactArtifactEvent(preflightSnapshot, 'raw-response')
  const preflightResponded = eventFor(preflightSnapshot, 'model.responded')
  if (!['running', 'paused', 'cancelled'].includes(preflightSnapshot.projection.state)
    || preflightRequested.length !== 1 || preflightResult || preflightResponse
    || preflightResponded.length) {
    fail('unknown-model-abandon', '只有唯一请求已发出且没有任何结果证据的 Run 可以显式放弃')
  }
  const intakeState = await readCreatorEditIntakeStateV1(input.selection.scope, input.runId)
    ?? fail('unknown-model-abandon', '结果未知 Run 缺少可验证的原始 intake')
  if (!sameJson(intakeState.checkpoint.intake.selection, input.selection)) {
    fail('selection-mismatch', 'runId 不属于调用方声明的精确 Creator edit 目标')
  }
  await assertUnknownModelOutcomeRunBindingV1({
    scope: input.selection.scope,
    snapshot: preflightSnapshot,
    workspace,
  })
  await assertUnknownModelRequestMatchesIntakeV1({
    scope: input.selection.scope,
    snapshot: preflightSnapshot,
    intakeState,
  })
  return withCreatorEditOperationLockV1(
    groupOperationLockKey(
      input.selection.scope,
      input.selection.buildId,
      context.ownerSiblingGroup.baseGroupHash,
    ),
    () => withAgentRunMutationLockV1(context.producerEvidence.runId, () => db.transaction(
      'rw',
      agentRunScopeTransactionTablesV1(
        input.runId,
        db.agentRuns,
        db.agentRunEvents,
        db.worlds,
        db.works,
      ),
      async () => {
        const snapshot = await readVerifiedAgentRunInTransactionV1(
          input.selection.scope,
          input.runId,
        )
        await Dexie.waitFor(assertUnknownModelOutcomeRunBindingV1({
          scope: input.selection.scope,
          snapshot,
          workspace,
          verifyLineage: false,
        }))
        const requested = eventFor(snapshot, 'model.requested')
        const result = exactArtifactEvent(snapshot, 'tool-result')
        const rawResponse = exactArtifactEvent(snapshot, 'raw-response')
        const responded = eventFor(snapshot, 'model.responded')
        if (snapshot.projection.state === 'cancelled') {
          const cancelled = eventFor(snapshot, 'run.cancelled')
          if (cancelled.length === 1 && cancelled[0]!.type === 'run.cancelled'
            && cancelled[0]!.payload.reason === UNKNOWN_MODEL_OUTCOME_ABANDON_REASON
            && requested.length === 1 && !result && !rawResponse && responded.length === 0) {
            await Dexie.waitFor(verifyRecordedMemorySettlementV1({
              snapshot,
              scope: input.selection.scope,
            }))
            return snapshot
          }
          fail('unknown-model-abandon', '该 Run 已由其它原因终止，不能伪装成作者放弃')
        }
        if (!['running', 'paused'].includes(snapshot.projection.state)
          || requested.length !== 1 || result || rawResponse || responded.length) {
          fail('unknown-model-abandon', '只有唯一请求已发出且没有任何结果证据的 Run 可以显式放弃')
        }
        const event = parseAgentRunEventV1({
          version: 1,
          runId: snapshot.run.id,
          sequence: snapshot.projection.lastSequence + 1,
          generation: snapshot.projection.generation,
          projectId: snapshot.run.projectId,
          worldGroupId: snapshot.run.worldGroupId ?? null,
          contractHash: snapshot.projection.contractHash,
          type: 'run.cancelled',
          createdAt: Date.now(),
          payload: { reason: UNKNOWN_MODEL_OUTCOME_ABANDON_REASON },
        })
        return appendAgentRunEventWithSettlementInTransactionV1({
          snapshot,
          event,
          scope: input.selection.scope,
          workspaceDirty: true,
        })
      },
    )),
  )
}

export function hashTextOpenWorldCreatorEditImpactPlanHandoffV1(
  intent: TextOpenWorldCreatorEditIntentV1,
): Promise<string> {
  return hashProductProductionValueV2({
    schema: 'storyforge.text-open-world-creator-edit-impact-plan-handoff',
    version: 1,
    intentHash: intent.intentHash,
    productionKey: intent.candidate.production.productionKey,
    baseBuildNumber: intent.candidate.baseBuild.buildNumber,
    ownerTaskKey: intent.candidate.ownerSiblingGroup.ownerTaskKey,
    baseGroupHash: intent.candidate.ownerSiblingGroup.baseGroupHash,
    rebuiltArtifacts: intent.candidate.rebuiltArtifacts.map(artifact => ({
      artifactKey: artifact.artifactKey,
      baseContentHash: artifact.baseContentHash,
      contentHash: artifact.contentHash,
    })),
  })
}

async function persistIntentClaimV1(input: {
  scope: WorkspaceScope
  runId: number
  candidate: TextOpenWorldCreatorEditCandidateV1
  checkpoint: Extract<TextOpenWorldCreatorArtifactEditCheckpointV1, { phase: 'intent' }> | null
}): Promise<AgentRunSnapshotV1 | null> {
  const parentRunId = input.candidate.producerEvidence.runId
  return withAgentRunMutationLockV1(parentRunId, () => db.transaction(
    'rw',
    agentRunScopeTransactionTablesV1(
      input.runId,
      db.agentRuns,
      db.agentRunEvents,
      db.agentRunCheckpoints,
      db.productProductions,
      db.productBuilds,
    ),
    async () => {
      const current = await readVerifiedAgentRunInTransactionV1(input.scope, input.runId)
      await assertCreatorEditBaseRowsInTransactionV1({
        scope: input.scope,
        production: {
          id: input.candidate.production.productionId,
          productionKey: input.candidate.production.productionKey,
          stateRevision: input.candidate.production.stateRevision,
        },
        build: {
          id: input.candidate.baseBuild.buildId,
          buildNumber: input.candidate.baseBuild.buildNumber,
          stateRevision: input.candidate.baseBuild.stateRevision,
          controlEpoch: input.candidate.baseBuild.controlEpoch,
          planHash: input.candidate.baseBuild.planHash,
          manifestHash: input.candidate.baseBuild.manifestHash,
          rootTerminalReceiptHash: input.candidate.baseBuild.rootTerminalReceiptHash,
        },
      })
      const currentStep = current.projection.steps[TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1]
      if (currentStep?.confirmation === 'adopt') return null
      if (current.projection.state !== 'awaiting_confirmation'
        || currentStep?.candidateHash !== input.candidate.candidateHash) {
        fail('confirmation-state', 'Creator edit 候选已被其它执行者推进')
      }
      const siblings = await db.agentRuns.where('parentRunId').equals(parentRunId).toArray()
      for (const sibling of siblings) {
        if (sibling.id == null || sibling.id === input.runId
          || sibling.productBuildId !== input.candidate.baseBuild.buildId
          || sibling.parentArtifactHash !== input.candidate.ownerSiblingGroup.baseGroupHash
          || !sibling.parentRelation?.startsWith(RUN_RELATION_PREFIX)) continue
        const competing = await readVerifiedAgentRunInTransactionV1(input.scope, sibling.id)
        const competingStep = competing.projection
          .steps[TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1]
        if (competingStep?.confirmation === 'adopt') {
          fail('competing-intent', '同一 owner sibling 基线已有已确认修改，必须先完成影响分析')
        }
        if (!['completed', 'failed', 'cancelled'].includes(competing.projection.state)
          && eventFor(competing, 'model.requested').length > 0) {
          fail(
            'competing-model-request',
            '同一 owner sibling 已有模型请求或候选尚未处置；必须先恢复、确认、拒绝或显式放弃该 Run',
          )
        }
      }
      const checkpointed = input.checkpoint
        ? await createAgentRunCheckpointInTransactionV1({
            snapshot: current,
            resumePayload: input.checkpoint,
          })
        : { snapshot: current }
      const event = parseAgentRunEventV1({
        version: 1,
        runId: checkpointed.snapshot.run.id,
        sequence: checkpointed.snapshot.projection.lastSequence + 1,
        generation: checkpointed.snapshot.projection.generation,
        projectId: checkpointed.snapshot.run.projectId,
        worldGroupId: checkpointed.snapshot.run.worldGroupId ?? null,
        contractHash: checkpointed.snapshot.projection.contractHash,
        type: 'confirmation.recorded',
        createdAt: Date.now(),
        payload: {
          stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
          candidateHash: input.candidate.candidateHash,
          decision: 'adopt',
        },
      })
      return appendPrivilegedAgentRunEventInTransactionV1(checkpointed.snapshot, event)
    },
  ))
}

export interface TextOpenWorldCreatorArtifactEditConfirmationInputV1 {
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
  runId: number
  warningAcknowledgementCodes: readonly string[]
  confirmedAt?: number
  onDurableBoundary?: (
    boundary: TextOpenWorldCreatorArtifactEditBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}

export function confirmTextOpenWorldCreatorArtifactEditIntentV1(
  input: TextOpenWorldCreatorArtifactEditConfirmationInputV1,
): Promise<TextOpenWorldCreatorArtifactEditHandoffV1> {
  assertSelection(input.selection)
  return resolveTextOpenWorldCreatorEditWorkspaceV1(assembleInput(input.selection)).then(workspace => (
    withCreatorEditOperationLockV1(
      groupOperationLockKey(
        input.selection.scope,
        input.selection.buildId,
        workspace.targetContext.ownerSiblingGroup.baseGroupHash,
      ),
      () => confirmTextOpenWorldCreatorArtifactEditIntentLockedV1(input),
    )
  ))
}

async function confirmTextOpenWorldCreatorArtifactEditIntentLockedV1(
  input: TextOpenWorldCreatorArtifactEditConfirmationInputV1,
): Promise<TextOpenWorldCreatorArtifactEditHandoffV1> {
  const scope = input.selection.scope
  let restored = await readState(scope, input.runId)
  if (!restored) fail('confirmation-state', 'Creator edit 缺少 durable candidate checkpoint')
  assertCandidateMatchesSelection(input.selection, restored.candidate)
  const warningAcknowledgementCodes = [...new Set(input.warningAcknowledgementCodes)]
    .sort((left, right) => left.localeCompare(right))
  if (restored.snapshot.projection.state === 'completed') {
    if (!restored.intent
      || !sameJson(restored.intent.warningAcknowledgementCodes, warningAcknowledgementCodes)) {
      fail('warning-acknowledgement', '重复确认与已冻结 warning acknowledgement 不一致')
    }
    await assertCandidateBaseFresh(scope, restored.candidate)
    return assertCompletedHandoff(scope, restored)
  }
  if (!['awaiting_confirmation', 'running', 'verifying'].includes(restored.snapshot.projection.state)) {
    fail('confirmation-state', 'Creator edit 不在可确认或可恢复的状态')
  }
  await assertCandidateBaseFresh(scope, restored.candidate)

  if (restored.checkpoint.phase === 'candidate') {
    if (restored.snapshot.projection.state !== 'awaiting_confirmation') {
      fail('confirmation-state', '尚未冻结 intent 的候选必须处于等待确认状态')
    }
    const intentBody: Omit<TextOpenWorldCreatorEditIntentV1, 'intentHash'> = {
      schema: 'storyforge.text-open-world-creator-edit-intent',
      version: 1,
      portable: false,
      candidate: restored.candidate,
      candidateHash: restored.candidate.candidateHash,
      warningAcknowledgementCodes,
      warningAcknowledgementHash:
        await hashTextOpenWorldCreatorEditWarningAcknowledgementV1(warningAcknowledgementCodes),
      confirmedAt: input.confirmedAt ?? Date.now(),
    }
    const intent = await parseTextOpenWorldCreatorEditIntentV1({
      ...intentBody,
      intentHash: await hashTextOpenWorldCreatorEditIntentV1(intentBody),
    })
    const baseUnchangedHash = await hashTextOpenWorldCreatorEditBaseStateV1(restored.candidate)
    const impactPlanHandoffHash = await hashTextOpenWorldCreatorEditImpactPlanHandoffV1(intent)
    const terminalReceipt = await createTextOpenWorldCreatorEditTerminalReceiptV1({
      intent,
      baseUnchangedHash,
      impactPlanHandoffHash,
      completedAt: intent.confirmedAt,
    })
    const verificationReceipt = await createVerificationReceiptV1({
      version: 1,
      runId: restored.snapshot.run.id,
      generation: restored.snapshot.projection.generation,
      contractHash: restored.snapshot.projection.contractHash,
      contextManifestHashes: [restored.checkpoint.evidence.contextManifestHash],
      candidateHashes: [restored.candidate.candidateHash],
      adoptionEventIds: [],
      postStateHash: terminalReceipt.receiptHash,
      verifierSetVersion: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_VERIFIER_SET_V1,
      lineage: {
        runId: restored.candidate.producerEvidence.runId,
        receiptHash: restored.candidate.producerEvidence.terminalReceiptHash,
        relation: restored.snapshot.run.parentRelation!,
        artifactHash: restored.candidate.ownerSiblingGroup.baseGroupHash,
      },
      criteria: terminalReceipt.criteria.map(criterion => ({
        id: criterion.id,
        status: 'passed' as const,
        evidenceRefs: [`hash:${criterion.evidenceHash}`],
      })),
      acceptedAt: intent.confirmedAt,
    })
    const checkpoint: Extract<TextOpenWorldCreatorArtifactEditCheckpointV1, { phase: 'intent' }> = {
      ...restored.checkpoint,
      phase: 'intent',
      candidate: null,
      intent,
      terminalReceipt,
      verificationReceipt,
    }
    const claimed = await persistIntentClaimV1({
      scope,
      runId: restored.snapshot.run.id,
      candidate: restored.candidate,
      checkpoint,
    })
    if (claimed) {
      restored = {
        snapshot: claimed,
        checkpoint,
        candidate: restored.candidate,
        intent,
        terminalReceipt,
        verificationReceipt,
      }
      await notifyBoundary(input.onDurableBoundary, 'intent.checkpoint', claimed)
      await notifyBoundary(input.onDurableBoundary, 'confirmation.recorded', claimed)
    } else {
      restored = await readState(scope, input.runId)
        ?? fail('confirmation-state', '并发确认后无法恢复 durable intent')
    }
  }

  const intent = restored.intent ?? fail('confirmation-state', '已冻结 checkpoint 缺少 intent')
  const terminalReceipt = restored.terminalReceipt
    ?? fail('confirmation-state', '已冻结 checkpoint 缺少自定义 terminal receipt')
  const verificationReceipt = restored.verificationReceipt
    ?? fail('confirmation-state', '已冻结 checkpoint 缺少标准 verification receipt')
  if (!sameJson(intent.warningAcknowledgementCodes, warningAcknowledgementCodes)) {
    fail('warning-acknowledgement', '恢复确认时的 warning acknowledgement 与已冻结 intent 不一致')
  }
  const impactPlanHandoffHash = await hashTextOpenWorldCreatorEditImpactPlanHandoffV1(intent)
  let snapshot = restored.snapshot
  const currentStep = () => snapshot.projection.steps[TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1]
  if (currentStep()?.confirmation !== 'adopt') {
    if (snapshot.projection.state !== 'awaiting_confirmation') {
      fail('confirmation-state', 'intent 已冻结但候选不在等待确认状态')
    }
    const claimed = await persistIntentClaimV1({
      scope,
      runId: restored.snapshot.run.id,
      candidate: restored.candidate,
      checkpoint: null,
    })
    if (claimed) snapshot = claimed
    else snapshot = (await readState(scope, input.runId)
      ?? fail('confirmation-state', '并发恢复确认后无法读取 durable intent')).snapshot
    await notifyBoundary(input.onDurableBoundary, 'confirmation.recorded', snapshot)
  }
  if (currentStep()?.status !== 'succeeded') {
    snapshot = await appendRun(scope, snapshot, 'step.succeeded', {
      stepId: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1,
      attempt: 1,
      outputHash: impactPlanHandoffHash,
    })
  }
  if (snapshot.projection.state !== 'verifying') {
    snapshot = await appendRun(scope, snapshot, 'verification.started', {
      verifierSetVersion: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_VERIFIER_SET_V1,
    })
    await notifyBoundary(input.onDurableBoundary, 'verification.checkpoint', snapshot)
  }
  await assertCandidateBaseFresh(scope, restored.candidate)
  snapshot = await appendRun(scope, snapshot, 'verification.accepted', {
    receiptHash: verificationReceipt.receiptHash,
  })
  await notifyBoundary(input.onDurableBoundary, 'verification.accepted', snapshot)
  return assertCompletedHandoff(scope, {
    snapshot,
    checkpoint: restored.checkpoint,
    candidate: restored.candidate,
    intent,
    terminalReceipt,
    verificationReceipt,
  })
}

async function assertCompletedHandoff(
  scope: WorkspaceScope,
  state: TextOpenWorldCreatorArtifactEditStateV1,
): Promise<TextOpenWorldCreatorArtifactEditHandoffV1> {
  if (!state.intent || !state.terminalReceipt || !state.verificationReceipt
    || state.checkpoint.phase !== 'intent'
    || state.checkpoint.intent.intentHash !== state.intent.intentHash
    || state.checkpoint.intent.candidate.candidateHash !== state.candidate.candidateHash
    || state.checkpoint.terminalReceipt.receiptHash !== state.terminalReceipt.receiptHash
    || state.checkpoint.verificationReceipt.receiptHash !== state.verificationReceipt.receiptHash) {
    fail('handoff', 'Creator edit intent checkpoint 内部身份不闭合')
  }
  const expectedVerificationReceipt = await createVerificationReceiptV1({
    version: 1,
    runId: state.snapshot.run.id,
    generation: state.snapshot.projection.generation,
    contractHash: state.snapshot.projection.contractHash,
    contextManifestHashes: [state.checkpoint.evidence.contextManifestHash],
    candidateHashes: [state.candidate.candidateHash],
    adoptionEventIds: [],
    postStateHash: state.terminalReceipt.receiptHash,
    verifierSetVersion: TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_VERIFIER_SET_V1,
    lineage: {
      runId: state.candidate.producerEvidence.runId,
      receiptHash: state.candidate.producerEvidence.terminalReceiptHash,
      relation: state.snapshot.run.parentRelation!,
      artifactHash: state.candidate.ownerSiblingGroup.baseGroupHash,
    },
    criteria: state.terminalReceipt.criteria.map(criterion => ({
      id: criterion.id,
      status: 'passed' as const,
      evidenceRefs: [`hash:${criterion.evidenceHash}`],
    })),
    acceptedAt: state.intent.confirmedAt,
  })
  const step = state.snapshot.projection.steps[TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1]
  const expectedOutputHash = await hashTextOpenWorldCreatorEditImpactPlanHandoffV1(state.intent)
  const confirmations = eventFor(state.snapshot, 'confirmation.recorded')
  const verificationStarts = eventFor(state.snapshot, 'verification.started')
  const verificationAccepts = eventFor(state.snapshot, 'verification.accepted')
  const hasAdoptionMutation = state.snapshot.events.some(event => [
    'adoption.started', 'adoption.committed', 'adoption.rejected', 'runtime.candidate.adopted',
  ].includes(event.type))
  if (state.snapshot.projection.state !== 'completed'
    || state.snapshot.projection.terminalReceiptHash !== state.verificationReceipt.receiptHash
    || state.verificationReceipt.receiptHash !== expectedVerificationReceipt.receiptHash
    || step?.confirmation !== 'adopt' || step.status !== 'succeeded'
    || step.candidateHash !== state.candidate.candidateHash
    || step.outputHash !== expectedOutputHash
    || confirmations.length !== 1
    || confirmations[0]!.type !== 'confirmation.recorded'
    || confirmations[0]!.payload.decision !== 'adopt'
    || confirmations[0]!.payload.candidateHash !== state.candidate.candidateHash
    || verificationStarts.length !== 1
    || verificationStarts[0]!.type !== 'verification.started'
    || verificationStarts[0]!.payload.verifierSetVersion
      !== TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_VERIFIER_SET_V1
    || verificationAccepts.length !== 1
    || verificationAccepts[0]!.type !== 'verification.accepted'
    || verificationAccepts[0]!.payload.receiptHash !== state.verificationReceipt.receiptHash
    || hasAdoptionMutation) {
    fail('handoff', 'Creator edit 外层 Run、标准回执与自定义影响分析回执不闭合')
  }
  try {
    await verifyRecordedMemorySettlementV1({ snapshot: state.snapshot, scope })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    fail('handoff-memory-settlement', `Creator edit 终态记忆结算无效：${message}`)
  }
  return state as TextOpenWorldCreatorArtifactEditHandoffV1
}

export async function readTextOpenWorldCreatorArtifactEditHandoffV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<TextOpenWorldCreatorArtifactEditHandoffV1> {
  const state = await readState(input.scope, input.runId)
  if (!state) fail('handoff', 'Creator edit durable checkpoint 不存在')
  const handoff = await assertCompletedHandoff(input.scope, state)
  await assertCandidateBaseFresh(input.scope, handoff.candidate)
  return handoff
}

function recoverySelectionFromRenderedContextV1(input: {
  scope: WorkspaceScope
  renderedRequest: CreatorEditRenderedRequestArtifactV1
}): TextOpenWorldCreatorArtifactEditSelectionV1 {
  let parsed: unknown
  try {
    parsed = JSON.parse(input.renderedRequest.registeredContext)
  } catch {
    return fail('known-result-recovery', '持久化 rendered context 不是 JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('known-result-recovery', '持久化 rendered context 必须是对象')
  }
  const context = parsed as Record<string, unknown>
  const production = context.production && typeof context.production === 'object'
    && !Array.isArray(context.production) ? context.production as Record<string, unknown> : null
  const build = context.build && typeof context.build === 'object'
    && !Array.isArray(context.build) ? context.build as Record<string, unknown> : null
  const target = context.target && typeof context.target === 'object'
    && !Array.isArray(context.target) ? context.target as Record<string, unknown> : null
  if (context.schema !== 'storyforge.text-open-world-creator-edit-target-context'
    || context.version !== 1 || !production || !build || !target
    || !Number.isSafeInteger(production.id) || Number(production.id) < 1
    || !Number.isSafeInteger(build.id) || Number(build.id) < 1
    || !isSha256Hash(context.governanceSnapshotHash)
    || typeof target.artifactKey !== 'string' || !target.artifactKey
    || (target.entityIdentity !== null && typeof target.entityIdentity !== 'string')) {
    return fail('known-result-recovery', '持久化 rendered context 缺少精确恢复身份')
  }
  return {
    scope: input.scope,
    productionId: Number(production.id),
    buildId: Number(build.id),
    expectedSnapshotHash: context.governanceSnapshotHash as string,
    artifactKey: target.artifactKey,
    entityIdentity: target.entityIdentity as string | null,
  }
}

async function recoverTextOpenWorldCreatorArtifactEditKnownModelResultV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  expectedBaseGroupHash: string
}): Promise<TextOpenWorldCreatorArtifactEditStateV1 | null> {
  const intakeState = await readCreatorEditIntakeStateV1(input.scope, input.snapshot.run.id)
    ?? fail('known-result-recovery', '持久化模型结果缺少可验证的原始 intake')
  const requestEvent = exactArtifactEvent(input.snapshot, 'rendered-request')
    ?? fail('known-result-recovery', '持久化模型结果缺少 rendered-request')
  const resultEvent = exactArtifactEvent(input.snapshot, 'tool-result')
    ?? fail('known-result-recovery', '没有可恢复的持久化模型结果')
  if (eventFor(input.snapshot, 'model.requested').length !== 1
    || input.snapshot.projection.state !== 'running') {
    fail('known-result-recovery', '已知模型结果 Run 不处于唯一可恢复执行窗口')
  }
  const [modelInputEvidence, resultText] = await Promise.all([
    assertCreatorEditModelInputEvidenceV1({
      scope: input.scope,
      snapshot: input.snapshot,
      requestEvent,
      intakeState,
    }),
    readAgentRunArtifactExactV1({
      projectId: input.scope.projectId,
      artifactKind: 'tool-result',
      contentHash: resultEvent.payload.contentHash,
    }),
  ])
  await assertKnownModelRequestEvidenceV1({
    snapshot: input.snapshot,
    requestEvent,
    resultEvent,
  })
  const renderedRequest = modelInputEvidence.renderedRequest
  const failureResult = toolResultArtifactSchemaV1(resultText)
      === 'storyforge.text-open-world-creator-edit-model-failure'
    ? parseModelFailureArtifactBody(resultText)
    : null
  const durableResult = failureResult ? null : await parseModelResultArtifactBody(resultText)
  const selection = recoverySelectionFromRenderedContextV1({
    scope: input.scope,
    renderedRequest,
  })
  const recoveryInput: TextOpenWorldCreatorArtifactEditGenerationInputV1 = {
    selection,
    mode: 'agent',
    authorInstruction: renderedRequest.authorInstruction,
    modelIdentity: {
      provider: failureResult?.provider ?? durableResult!.provider,
      model: failureResult?.model ?? durableResult!.model,
    },
    runAI: async () => fail(
      'known-result-recovery',
      '恢复已持久化模型结果时禁止再次调用 provider',
    ),
  }
  const frozenAgentExecution = await frozenCreatorEditAgentExecutionFromRunV1(input.snapshot)
  const prepared = await prepareGeneration({
    ...recoveryInput,
    modelExecutionIdentity: intakeState.checkpoint.intake.modelIdentity,
    frozenAgentExecution,
  })
  const relation = parseCreatorEditRelationV1(input.snapshot.run.parentRelation)
  if (prepared.workspace.targetContext.ownerSiblingGroup.baseGroupHash
      !== input.expectedBaseGroupHash
    || prepared.runtimeBindingHash !== input.snapshot.contract.runtimeBindingHash
    || relation.requestHash !== prepared.requestHash) {
    fail('known-result-recovery', '持久化结果与当前 owner sibling 或请求绑定不一致')
  }
  if (failureResult) {
    assertModelFailureArtifactSemanticsV1(failureResult)
    if (failureResult.provider !== prepared.modelIdentity.provider
      || failureResult.model !== prepared.modelIdentity.model
      || exactArtifactEvent(input.snapshot, 'raw-response') !== null
      || eventFor(input.snapshot, 'model.responded').length !== 0
      || (failureResult.usage && (
        failureResult.usage.inputTokens > input.snapshot.contract.budget.maxInputTokens
        || failureResult.usage.outputTokens > input.snapshot.contract.budget.maxOutputTokens
      ))) {
      fail('known-result-recovery', '持久化模型失败与冻结模型绑定、预算或事件形态不一致')
    }
    await failCreatorEditRunV1({
      scope: input.scope,
      runId: input.snapshot.run.id,
      code: failureResult.failureCode,
      retryable: failureResult.retryable,
      category: modelFailureCategoryV1(failureResult),
    })
    const failed = await readAgentRunV1(input.scope, input.snapshot.run.id)
    const stepFailures = eventFor(failed, 'step.failed')
    const runFailures = eventFor(failed, 'run.failed')
    if (stepFailures.length !== 1 || stepFailures[0]!.type !== 'step.failed'
      || stepFailures[0]!.payload.code !== failureResult.failureCode
      || stepFailures[0]!.payload.retryable !== failureResult.retryable
      || stepFailures[0]!.payload.category !== modelFailureCategoryV1(failureResult)
      || stepFailures[0]!.payload.action !== 'fail'
      || runFailures.length !== 1 || runFailures[0]!.type !== 'run.failed'
      || runFailures[0]!.payload.code !== failureResult.failureCode
      || runFailures[0]!.payload.retryable !== failureResult.retryable) {
      fail('known-result-recovery', '模型失败 Artifact 与终态事件不一致')
    }
    await verifyRecordedMemorySettlementV1({ snapshot: failed, scope: input.scope })
    return null
  }
  const recoveredPrepared = {
    ...prepared,
    relation: input.snapshot.run.parentRelation!,
  }
  return withCreatorEditOperationLockV1(
    groupOperationLockKey(
      selection.scope,
      selection.buildId,
      prepared.workspace.targetContext.ownerSiblingGroup.baseGroupHash,
    ),
    () => generateTextOpenWorldCreatorArtifactEditCandidateLockedV1(
      recoveryInput,
      recoveredPrepared,
      input.snapshot.run.id,
    ),
  )
}

export async function readLatestTextOpenWorldCreatorArtifactEditStateV1(
  selection: TextOpenWorldCreatorArtifactEditSelectionV1,
): Promise<TextOpenWorldCreatorArtifactEditStateV1 | TextOpenWorldCreatorArtifactEditBlockerV1 | null> {
  assertSelection(selection)
  const workspace = await resolveTextOpenWorldCreatorEditWorkspaceV1(assembleInput(selection))
  const rows = (await readOwnedRows<AgentRunRecord>(selection.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => row.id && row.productBuildId === selection.buildId
      && row.parentRunId === workspace.targetContext.producerEvidence.runId
      && row.parentArtifactHash === workspace.targetContext.ownerSiblingGroup.baseGroupHash
      && row.parentRelation?.startsWith(RUN_RELATION_PREFIX))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  let selected: TextOpenWorldCreatorArtifactEditStateV1
    | TextOpenWorldCreatorArtifactEditIntakeBlockerV1
    | null = null
  for (const row of rows) {
    try {
      const checkpointState = await readState(selection.scope, row.id!)
      if (checkpointState) {
        if (['failed', 'cancelled'].includes(checkpointState.snapshot.projection.state)) {
          await verifyRecordedMemorySettlementV1({
            snapshot: checkpointState.snapshot,
            scope: selection.scope,
          })
          continue
        }
        const repaired = await repairCandidateEvent(selection.scope, checkpointState)
        const exactTarget = candidateMatchesSelectionV1(selection, repaired.candidate)
        if (repaired.intent && repaired.snapshot.projection.state !== 'completed') {
          const recovered = await confirmTextOpenWorldCreatorArtifactEditIntentV1({
            selection: selectionFromCandidate(selection.scope, repaired.candidate),
            runId: repaired.snapshot.run.id,
            warningAcknowledgementCodes: repaired.intent.warningAcknowledgementCodes,
          })
          if (!exactTarget) {
            return {
              kind: 'impact-analysis-pending',
              runId: recovered.snapshot.run.id,
              runState: recovered.snapshot.projection.state as 'completed',
              ownerTaskKey: recovered.candidate.ownerSiblingGroup.ownerTaskKey,
              target: {
                artifactKey: recovered.candidate.target.artifactKey,
                entityIdentity: recovered.candidate.target.entityIdentity,
              },
              message: '同一 sibling 内容组已有作者确认的修改，必须先由影响分析与修复 Build 承接。',
              snapshot: recovered.snapshot,
            }
          }
          if (!selected) selected = recovered
          continue
        }
        if (repaired.intent && !exactTarget) {
          const runState = repaired.snapshot.projection.state
          if (!['running', 'verifying', 'completed'].includes(runState)) {
            fail('impact-analysis-blocker', `已确认 Creator edit Run 状态 ${runState} 无法形成影响分析阻塞`)
          }
          return {
            kind: 'impact-analysis-pending',
            runId: repaired.snapshot.run.id,
            runState: runState as 'running' | 'verifying' | 'completed',
            ownerTaskKey: repaired.candidate.ownerSiblingGroup.ownerTaskKey,
            target: {
              artifactKey: repaired.candidate.target.artifactKey,
              entityIdentity: repaired.candidate.target.entityIdentity,
            },
            message: '同一 sibling 内容组已有作者确认的修改，必须先由影响分析与修复 Build 承接。',
            snapshot: repaired.snapshot,
          }
        }
        if (exactTarget && !selected) selected = repaired
        continue
      }
      const staticIntakeState = await readCreatorEditStaticIntakeStateV1(selection.scope, row.id!)
      if (staticIntakeState) {
        const snapshot = staticIntakeState.snapshot
        if (['failed', 'cancelled'].includes(snapshot.projection.state)) {
          await verifyRecordedMemorySettlementV1({ snapshot, scope: selection.scope })
          continue
        }
        const intakeState = await readCreatorEditIntakeStateV1(selection.scope, row.id!)
          ?? fail('intake-state', '活动 Creator edit intake 无法重建完整治理权限')
        const requested = eventFor(snapshot, 'model.requested')
        const modelResult = exactArtifactEvent(snapshot, 'tool-result')
        if (requested.length === 0 && modelResult === null) {
          if (!['planned', 'running'].includes(snapshot.projection.state)) {
            fail('intake-state', '尚未派发模型的 intake 不处于可显式恢复状态')
          }
          if (sameJson(intakeState.checkpoint.intake.selection, selection) && !selected) {
            selected = {
              kind: 'intake-ready',
              runId: snapshot.run.id,
              runState: snapshot.projection.state as 'planned' | 'running',
              mode: intakeState.checkpoint.intake.mode,
              ownerTaskKey: workspace.targetContext.ownerSiblingGroup.ownerTaskKey,
              message: '修改请求已安全保存，尚未形成候选；请由作者明确继续。',
              snapshot,
            }
          }
          continue
        }
        await assertUnknownModelOutcomeRunBindingV1({
          scope: selection.scope,
          snapshot,
          workspace,
        })
        if (requested.length > 0 && modelResult === null) {
          if (!['running', 'paused'].includes(snapshot.projection.state)) {
            fail('unknown-model-binding', '结果未知 Run 不处于 running/paused 状态')
          }
          await assertUnknownModelRequestMatchesIntakeV1({
            scope: selection.scope,
            snapshot,
            intakeState,
          })
          return {
            kind: 'model-outcome-unknown',
            runId: snapshot.run.id,
            runState: snapshot.projection.state as 'running' | 'paused',
            ownerTaskKey: workspace.targetContext.ownerSiblingGroup.ownerTaskKey,
            message: '同一 sibling 内容组存在结果未知的模型请求；系统不会自动重发或再次计费。',
            snapshot,
          }
        }
        if (requested.length === 1 && modelResult && snapshot.projection.state === 'running') {
          const recovered = await recoverTextOpenWorldCreatorArtifactEditKnownModelResultV1({
            scope: selection.scope,
            snapshot,
            expectedBaseGroupHash: workspace.targetContext.ownerSiblingGroup.baseGroupHash,
          })
          if (recovered && candidateMatchesSelectionV1(selection, recovered.candidate) && !selected) {
            selected = recovered
          }
          continue
        }
        fail('intake-state', 'Creator edit intake 的模型请求、结果与 Run 状态组合无效')
      }
      const snapshot = await readAgentRunV1(selection.scope, row.id!)
      if (['failed', 'cancelled'].includes(snapshot.projection.state)) {
        await verifyRecordedMemorySettlementV1({ snapshot, scope: selection.scope })
        continue
      }
      if (snapshot.projection.state === 'paused' || snapshot.projection.state === 'running') {
        fail('intake-missing', `Run ${row.id} 没有候选或 durable intake，拒绝猜测恢复输入`)
      }
      fail('checkpoint-missing', `Run ${row.id} 处于 ${snapshot.projection.state} 但缺少恢复 checkpoint`)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      fail(
        'resume-evidence',
        `当前 owner sibling group 的 Run ${row.id} 无法安全读取或恢复：${message}`,
      )
    }
  }
  return selected
}

/** G5-07 consumes only completed, fully verified impact-analysis handoffs. */
export async function listTextOpenWorldCreatorArtifactEditHandoffsV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
}): Promise<TextOpenWorldCreatorArtifactEditHandoffV1[]> {
  if (!Number.isSafeInteger(input.productionId) || input.productionId < 1
    || !Number.isSafeInteger(input.buildId) || input.buildId < 1) {
    fail('handoff-list', '影响分析交接缺少有效 Production 或 Build 身份')
  }
  const [production, build] = await Promise.all([
    db.productProductions.get(input.productionId),
    db.productBuilds.get(input.buildId),
  ])
  if (!production || !await assertRecordInScope(
    input.scope,
    'productProductions',
    production,
    { owner: 'work' },
  ) || !build || !await assertRecordInScope(
    input.scope,
    'productBuilds',
    build,
    { owner: 'work' },
  ) || build.productionId !== input.productionId) {
    fail('handoff-list', 'Production、Build 与当前 Work 作用域不匹配')
  }
  const rows = (await readOwnedRows<AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => row.id && row.productBuildId === input.buildId
      && row.parentRelation?.startsWith(RUN_RELATION_PREFIX))
    .sort((left, right) => (left.id ?? 0) - (right.id ?? 0))
  const handoffs: TextOpenWorldCreatorArtifactEditHandoffV1[] = []
  for (const row of rows) {
    try {
      const snapshot = await readAgentRunV1(input.scope, row.id!)
      if (['failed', 'cancelled'].includes(snapshot.projection.state)) {
        await verifyRecordedMemorySettlementV1({ snapshot, scope: input.scope })
        continue
      }
      if (snapshot.projection.state !== 'completed') {
        const step = snapshot.projection.steps[TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_STEP_ID_V1]
        if (step?.confirmation === 'adopt') {
          fail(
            'handoff-list-pending-confirmation-settlement',
            `Run ${row.id} 已确认修改但尚未完成验证与终态结算；必须先恢复该 Run`,
          )
        }
        continue
      }
      const handoff = await readTextOpenWorldCreatorArtifactEditHandoffV1({
        scope: input.scope,
        runId: row.id!,
      })
      if (handoff.candidate.production.productionId !== input.productionId
        || handoff.candidate.baseBuild.buildId !== input.buildId) {
        fail('handoff-list', `Run ${row.id} 的 Production/Build 身份不属于请求范围`)
      }
      handoffs.push(handoff)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      fail('handoff-list', `Run ${row.id} 不能成为影响分析权限输入：${message}`)
    }
  }
  return handoffs
}

/** Convenience for direct editor forms: emit an operation only when value changed. */
export async function createTextOpenWorldCreatorDirectEditOperationsV1(input: {
  context: TextOpenWorldCreatorEditTargetContextV1
  values: Readonly<Record<string, unknown>>
}): Promise<TextOpenWorldCreatorEditPatchOperationV1[]> {
  const operations: TextOpenWorldCreatorEditPatchOperationV1[] = []
  for (const field of input.context.editableFields) {
    if (!Object.prototype.hasOwnProperty.call(input.values, field.fieldId)) continue
    const value = input.values[field.fieldId]
    if (sameJson(value, contextFieldValue(input.context, field.fieldId))) continue
    operations.push({
      op: 'replace',
      fieldId: field.fieldId,
      baseValueHash: field.baseValueHash,
      value,
    })
  }
  if (!operations.length) fail('no-change', '没有任何字段发生变化')
  return operations
}

export function isTextOpenWorldCreatorArtifactEditRunV1(snapshot: AgentRunSnapshotV1): boolean {
  return Boolean(
    snapshot.run.parentRelation?.startsWith(RUN_RELATION_PREFIX)
      && snapshot.contract.scope.productProduction?.taskKey.startsWith('creator-edit:')
      && snapshot.contract.permissions.writeTargets.length === 0
      && HASH.test(snapshot.contract.runtimeBindingHash ?? ''),
  )
}
