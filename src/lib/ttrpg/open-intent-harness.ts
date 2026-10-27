import { readTtrpgOpenSituationKernelSnapshotV1, projectTtrpgOpenSituationCandidateSummaryV1, assertTtrpgOpenSituationHumanGmV1, assertTtrpgOpenSituationRequesterV1, readTtrpgOpenSituationCandidateSummaryV1, type TtrpgOpenSituationCandidateV1 } from './open-generated-situation-candidate'
import { reviewTtrpgOpenDeliveredSituationV1 } from './open-generated-situation-delivery'
import { reviewTtrpgOpenDeliveredPublicSituationV1 } from './open-public-situation-delivery'
import { readTtrpgOpenPublicSituationKernelSnapshotV1, projectTtrpgOpenPublicSituationCandidateSummaryV1, readTtrpgOpenPublicSituationCandidateSummaryV1 } from './open-public-situation-candidate'
import { prepareTtrpgOpenEntityInputV1 } from './open-intent-input'
import { assertTtrpgOpenEntityCandidateReaderV1, type TtrpgOpenEntityCandidateV1 } from './open-entity-candidate'
import { reviewTtrpgOpenEntityModelDeliveryV1 } from './open-entity-model-contract'
import { parseTtrpgOpenBriefV1, ttrpgOpenDeliveredBriefAttributionsV1, type TtrpgOpenBriefV1, type TtrpgOpenBriefAttributionV1 } from './open-brief-output'
import type { ContextGatewaySourceSnapshotInputV1 } from '../context-gateway/attempt-evidence'
import { ttrpgOpenDeliveredKpSourceKeysV1, assertTtrpgOpenKpDeliveryCurrentV1 } from './open-kp-delivered-sources'
import { parseTtrpgOpenKpNarrationV1, type TtrpgOpenKpNarrationV1 } from './open-kp-candidate'
/** One authorized transport attempt, raw receipt first, then a recoverable semantic candidate. */
import type { AIConfig, ChatMessage, WorkspaceScope } from '../types'
import { resolveRequestConfig, type ChatResult } from '../ai/client'
import { estimateTokens } from '../ai/context-budget'
import { estimateTtrpgOpenRuntimeFallbackInputV1 } from './open-runtime-wire-budget'
import { computeKnownCostUsd } from '../ai/usage-log'
import { executeFrozenFormalAIEntryV1 } from '../agent/formal-ai-entry'
import { projectFrozenAgentSkillDefinitionV1 } from '../agent/execution-binding'
import { parseStructuredOutputV1 } from '../agent/structured-output-pipeline'
import { parseCreativeArtifactV1, parseCreativeAssumptionV1, type CreativeArtifactIssueV1, type CreativeAssumptionV1 } from '../agent/creative-reliability'
import { createCreativeIssueV1 } from '../agent/creative-execution'
import { readInstanceAgentRunV1, appendAgentRunEventV1 } from '../agent/run/event-store'
import { createAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { hashCanonicalValue } from '../agent/run/hash'
import { finalizeContextGatewayAttemptEvidenceV1, readContextGatewayManifestV3ForAttemptV1 } from '../context-gateway/attempt-evidence'
import { recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../product/runtime-core'
import { prepareTtrpgOpenIntentInputV1, prepareTtrpgOpenOracleInputV1, prepareTtrpgOpenOracleInputV2, prepareTtrpgOpenFactNormalizationInputV1, prepareTtrpgOpenFactNormalizationInputV2, prepareTtrpgOpenCompanionInputV1, prepareTtrpgOpenKpInputV1, prepareTtrpgOpenBriefInputV1, prepareTtrpgOpenSituationInputV1, prepareTtrpgOpenPublicSituationInputV1 } from './open-intent-input'
import { dispatchTtrpgOpenModelCallV1, finishTtrpgOpenModelCallV1 } from './runtime-commands'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { loadTtrpgOpenModelContextV1, ttrpgOpenModelPurposeForSkillV1, type TtrpgOpenModelPurposeV1 } from './open-model-purpose'
import { parseTtrpgOpenOracleSemanticCandidateV1, parseTtrpgOpenFactNormalizationCandidateV1, type TtrpgOpenOracleCandidateV1 } from './open-oracle-candidate'
import { parseTtrpgOpenIntentV1, type TtrpgOpenIntentV1 } from './open-intent'
import { ttrpgOpenScopedKeyV1, TTRPG_OPEN_ORACLE_INSTANCE_INPUT_V1, TTRPG_OPEN_NORMALIZATION_INSTANCE_INPUT_V1 } from './open-coordination'
import { assertTtrpgOpenHostingDelegationV1 } from './open-hosting-delegation'
import { verifyTtrpgOpenModelCallEvidenceV1 } from './open-model-call-evidence'
import type { TtrpgOpenInputEvidenceV1 } from './open-input-evidence'
import { prepareTtrpgOpenCommonOracleInputV1 } from './open-intent-input'
import { parseTtrpgOpenCommonOracleSemanticCandidateV1, assertTtrpgOpenCommonOracleCandidateReaderV1 } from './open-common-oracle-candidate'
import { reviewTtrpgOpenCommonOracleDeliveryV1 } from './open-common-oracle-delivery'
import { assertInstanceBinding } from '../product/runtime-instances'
import { verifyProductRuntimeSessionSourceV1 } from '../product-production/preview-source'
import { isTtrpgRuntimeContentV2 } from './content-version'

import { readTtrpgOpenRuntimeCandidateForKernelV1 as readTtrpgOpenRuntimeCandidateV1, readTtrpgOpenUnfinishedCandidateForKernelV1 as readTtrpgOpenUnfinishedCandidateArtifactV1, type TtrpgOpenRuntimeCandidateV1, type TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import type { TtrpgOpenIntentCandidateV1 } from './open-intent-candidate'
export { readTtrpgOpenIntentCandidateV1 } from './open-intent-candidate'
export type { TtrpgOpenIntentCandidateV1 } from './open-intent-candidate'
export { readTtrpgOpenBriefCandidateV1 } from './open-brief-candidate'
export { readTtrpgOpenKpCandidateV1 } from './open-kp-candidate'
export { readTtrpgOpenOracleCandidateV1, readTtrpgOpenFactNormalizationCandidateV1 } from './open-oracle-candidate'
export { readTtrpgOpenCommonOracleCandidateV1 } from './open-common-oracle-candidate'

/** The window already froze this exact model and budget. Preparation and dispatch share its original Run. */
export async function generateTtrpgOpenCommonOracleCandidateV1(input: RuntimeRequest) {
  const prepared = await prepareTtrpgOpenCommonOracleInputV1(input)
  const result = await executeTtrpgOpenCommonOracleRequestV1(input)
  if (result.status !== 'candidate') throw new Error('原共同事实请求已有执行器接管，未重复发送')
  return { prepared, ...result }
}
export async function executeTtrpgOpenCommonOracleRequestV1(input: RuntimeRequest) {
  await assertTtrpgOpenCommonOracleCandidateReaderV1(input)
  const result = await executeTtrpgOpenRuntimeRequestV1(input, 'common-oracle-interpret')
  if (result.status === 'candidate' && result.candidate.schema !== 'storyforge.ttrpg-open-common-oracle-candidate') throw new Error('共同事实候选种类与本次独立用途不一致')
  return result.status === 'candidate' ? { status: 'candidate' as const, candidate: result.candidate as import('./open-common-oracle-candidate').TtrpgOpenCommonOracleCandidateV1 } : result
}
export async function recoverTtrpgOpenCommonOracleCandidateV1(input: TtrpgOpenCandidateReadV1) {
  await assertTtrpgOpenCommonOracleCandidateReaderV1(input)
  const candidate = await recoverTtrpgOpenRuntimeCandidateV1(input)
  if (candidate && candidate.schema !== 'storyforge.ttrpg-open-common-oracle-candidate') throw new Error('不能以旧私域候选修复共同事实请求')
  return candidate
}

type Prepared = Awaited<ReturnType<typeof prepareTtrpgOpenIntentInputV1>>
type TestTransport = (messages: ChatMessage[], signal: AbortSignal, result: ChatResult) => Promise<string>

/** Explicit request only; no UI read, reload or recovery calls this preparation. */
export async function generateTtrpgOpenEntityCandidateV1(input: Omit<Parameters<typeof prepareTtrpgOpenEntityInputV1>[0], 'modelIdentity'> & {
  aiConfig?: AIConfig; runAI?: TestTransport
  onPrepared?: (request: TtrpgOpenCandidateReadV1) => void | Promise<void>
}) {
  if (!input.aiConfig && !input.runAI) throw new Error('[ttrpg-entity] 缺少明确模型配置')
  const meta = { category: 'runtime.ttrpg-open.entity-propose', projectId: input.scope.projectId,
    configOverrides: { maxTokens: input.maximumOutputTokens }, contextOverflowPolicy: 'reject' as const }
  const resolved = input.aiConfig ? resolveRequestConfig(input.aiConfig, meta) : null
  const modelIdentity = input.runAI ? { provider: 'test-adapter', model: 'injected' }
    : { provider: resolved!.config.provider, model: resolved!.config.model }
  if (!input.runAI && modelIdentity.provider === 'poe') throw new Error('[ttrpg-entity] 当前 provider 不支持冻结输出上限')
  const prepared = await prepareTtrpgOpenEntityInputV1({ ...input, modelIdentity })
  await input.onPrepared?.({ scope: input.scope, sessionId: input.sessionId, viewerKey: input.viewerKey, runId: prepared.runId, requestKey: prepared.requestKey })
  const result = await executeTtrpgOpenEntityRequestV1({ ...input, runId: prepared.runId, requestKey: prepared.requestKey })
  if (result.status !== 'candidate') throw new Error('[ttrpg-entity] 原请求已有执行器接管，未重复发送')
  return { prepared, ...result }
}

async function currentEnvelope(sessionId: number, commandId: string) {
  const state = await readProductRuntimeStateVersion(sessionId)
  return { sessionId, commandId, baseSequence: state.sequence, baseStateHash: state.stateHash }
}

function parseSemanticIntent(output: string, binding: {
  actorKey: string; intentKey: string; inputRevision: string; source: TtrpgOpenIntentV1['source']
  visibleRefs: Set<string>; visibleResources: Set<string>
}): TtrpgOpenIntentV1 {
  return parseStructuredOutputV1({ raw: output,
    contract: { version: 1, schemaId: 'storyforge.ttrpg-open-semantic-intent', target: 'runtime-candidate', root: 'object',
      maxChars: 120_000, allowedRootFields: ['goal', 'method', 'targetRefs', 'declaredResources', 'declaredAssumptions', 'requestedOutcome'],
      requiredRootFields: ['goal', 'method', 'targetRefs', 'declaredResources', 'declaredAssumptions', 'requestedOutcome'] },
    parse: value => {
      const fields = value as Record<string, unknown>
      const intent = parseTtrpgOpenIntentV1({ ...fields, intentKey: binding.intentKey, clarificationThreadKey: binding.intentKey,
        actorKey: binding.actorKey, inputRevision: binding.inputRevision, source: binding.source })
      if (intent.targetRefs.some(ref => !binding.visibleRefs.has(ref))
        || intent.declaredResources.some(ref => !binding.visibleResources.has(ref))) {
        throw new Error('[ttrpg-open-intent] 候选引用了本次未读取或未授权的目标/资源')
      }
      return intent
    } })
}

/** A test adapter is explicit and never supplies credentials or counts as real-model acceptance. */
export async function generateTtrpgOpenIntentCandidateV1(input: Omit<Parameters<typeof prepareTtrpgOpenIntentInputV1>[0], 'modelIdentity'> & {
  aiConfig?: AIConfig; runAI?: TestTransport
}): Promise<{ status: 'candidate'; prepared: Prepared; candidate: TtrpgOpenIntentCandidateV1 }> {
  if (!input.aiConfig && !input.runAI) throw new Error('[ttrpg-open-intent] 缺少明确模型配置')
  const meta = { category: 'runtime.ttrpg-open.intent', projectId: input.scope.projectId,
    configOverrides: { maxTokens: input.maximumOutputTokens }, contextOverflowPolicy: 'reject' as const }
  const resolved = input.aiConfig ? resolveRequestConfig(input.aiConfig, meta) : null
  const modelIdentity = input.runAI ? { provider: 'test-adapter', model: 'injected' }
    : { provider: resolved!.config.provider, model: resolved!.config.model }
  if (!input.runAI && modelIdentity.provider === 'poe') throw new Error('[ttrpg-open-intent] 当前 provider 不支持本次要求的输出上限')
  const prepared = await prepareTtrpgOpenIntentInputV1({ ...input, modelIdentity })
  const result = await executeTtrpgOpenIntentRequestV1({ scope: input.scope, sessionId: input.sessionId,
    runId: prepared.runId, requestKey: prepared.requestKey, viewerKey: input.viewerKey,
    aiConfig: input.aiConfig, runAI: input.runAI, signal: input.signal })
  if (result.status !== 'candidate') throw new Error('[ttrpg-open-intent] 本次请求已经被其他执行器接管；未重复发送')
  return { status: 'candidate', prepared, candidate: result.candidate }
}

type OracleGenerationInputV1 = Omit<Parameters<typeof prepareTtrpgOpenOracleInputV1>[0], 'modelIdentity'> & { aiConfig?: AIConfig; runAI?: TestTransport }
export async function generateTtrpgOpenOracleCandidateV1(input: OracleGenerationInputV1) {
  return generateTtrpgOpenOracleCandidate(input, false)
}
export async function generateTtrpgOpenOracleCandidateV2(input: Omit<OracleGenerationInputV1, 'rawInput'> & { referencePolicy: 'recorded-oracle-instances-v1';
  onPrepared?: (prepared: Awaited<ReturnType<typeof prepareTtrpgOpenOracleInputV2>>) => void | Promise<void> }) {
  if (input.referencePolicy !== 'recorded-oracle-instances-v1') throw new Error('请明确使用原 Oracle 的已创建对象引用策略')
  return generateTtrpgOpenOracleCandidate({ ...input, rawInput: TTRPG_OPEN_ORACLE_INSTANCE_INPUT_V1 }, true, input.onPrepared)
}
async function generateTtrpgOpenOracleCandidate(input: OracleGenerationInputV1, runtimeReferences: boolean,
  onPrepared?: (prepared: Awaited<ReturnType<typeof prepareTtrpgOpenOracleInputV2>>) => void | Promise<void>) {
  if (!input.aiConfig && !input.runAI) throw new Error('[ttrpg-open-oracle] 缺少明确模型配置')
  const meta = { category: 'runtime.ttrpg-open.oracle-interpret', projectId: input.scope.projectId,
    configOverrides: { maxTokens: input.maximumOutputTokens }, contextOverflowPolicy: 'reject' as const }
  const resolved = input.aiConfig ? resolveRequestConfig(input.aiConfig, meta) : null
  const modelIdentity = input.runAI ? { provider: 'test-adapter', model: 'injected' }
    : { provider: resolved!.config.provider, model: resolved!.config.model }
  if (!input.runAI && modelIdentity.provider === 'poe') throw new Error('[ttrpg-open-oracle] 当前 provider 不支持本次要求的输出上限')
  const prepared = runtimeReferences ? await prepareTtrpgOpenOracleInputV2({ ...input, modelIdentity, referencePolicy: 'recorded-oracle-instances-v1' })
    : await prepareTtrpgOpenOracleInputV1({ ...input, modelIdentity })
  await onPrepared?.(prepared)
  const result = await executeTtrpgOpenOracleRequestV1({ ...input, runId: prepared.runId, requestKey: prepared.requestKey })
  if (result.status !== 'candidate') throw new Error('[ttrpg-open-oracle] 请求已被其他执行器接管，未重复发送')
  return { prepared, ...result }
}

export async function generateTtrpgOpenCompanionCandidateV1(input: Omit<Parameters<typeof prepareTtrpgOpenCompanionInputV1>[0], 'modelIdentity'> & {
  aiConfig?: AIConfig; runAI?: TestTransport
}) {
  if (!input.aiConfig && !input.runAI) throw new Error('[ttrpg-open-oracle] 缺少明确模型配置')
  const meta = { category: 'runtime.ttrpg-open.companion', projectId: input.scope.projectId,
    configOverrides: { maxTokens: input.maximumOutputTokens }, contextOverflowPolicy: 'reject' as const }
  const resolved = input.aiConfig ? resolveRequestConfig(input.aiConfig, meta) : null
  const modelIdentity = input.runAI ? { provider: 'test-adapter', model: 'injected' }
    : { provider: resolved!.config.provider, model: resolved!.config.model }
  if (!input.runAI && modelIdentity.provider === 'poe') throw new Error('[ttrpg-open-oracle] 当前 provider 不支持本次要求的输出上限')
  const prepared = await prepareTtrpgOpenCompanionInputV1({ ...input, modelIdentity })
  const result = await executeTtrpgOpenCompanionRequestV1({ ...input, runId: prepared.runId, requestKey: prepared.requestKey })
  if (result.status !== 'candidate') throw new Error('[ttrpg-open-oracle] 请求已被其他执行器接管，未重复发送')
  return { prepared, ...result }
}

export async function generateTtrpgOpenKpCandidateV1(input: Omit<Parameters<typeof prepareTtrpgOpenKpInputV1>[0], 'modelIdentity'> & {
  aiConfig?: AIConfig; runAI?: TestTransport
}) {
  if (!input.aiConfig && !input.runAI) throw new Error('[ttrpg-open-oracle] 缺少明确模型配置')
  const meta = { category: 'runtime.ttrpg-open.kp', projectId: input.scope.projectId,
    configOverrides: { maxTokens: input.maximumOutputTokens }, contextOverflowPolicy: 'reject' as const }
  const resolved = input.aiConfig ? resolveRequestConfig(input.aiConfig, meta) : null
  const modelIdentity = input.runAI ? { provider: 'test-adapter', model: 'injected' }
    : { provider: resolved!.config.provider, model: resolved!.config.model }
  if (!input.runAI && modelIdentity.provider === 'poe') throw new Error('[ttrpg-open-oracle] 当前 provider 不支持本次要求的输出上限')
  const prepared = await prepareTtrpgOpenKpInputV1({ ...input, modelIdentity })
  const result = await executeTtrpgOpenKpRequestV1({ ...input, runId: prepared.runId, requestKey: prepared.requestKey })
  if (result.status !== 'candidate') throw new Error('[ttrpg-open-oracle] 请求已被其他执行器接管，未重复发送')
  return { prepared, ...result }
}

/** Public failures retain only an original-request locator, never provider/private validation text. */
export class TtrpgOpenSituationRequestError extends Error {
  readonly runId?: number
  readonly requestKey?: string
  constructor(locator?: { runId: number; requestKey: string }) {
    super('局势生成未完成；请核对原请求状态，私域诊断由真人 GM 审阅。')
    this.name = 'TtrpgOpenSituationRequestError'; this.runId = locator?.runId; this.requestKey = locator?.requestKey
  }
}
async function situationPublicBoundary<T>(job: () => Promise<T>, locator: () => { runId: number; requestKey: string } | undefined): Promise<T> {
  try { return await job() } catch (error) { throw error instanceof TtrpgOpenSituationRequestError ? error : new TtrpgOpenSituationRequestError(locator()) }
}
/** Human-facing result contains no private prepared messages or candidate body. */
export async function generateTtrpgOpenSituationCandidateV1(input: Omit<Parameters<typeof prepareTtrpgOpenSituationInputV1>[0], 'modelIdentity'> & { aiConfig?: AIConfig; runAI?: TestTransport }) {
  let locator: { runId: number; requestKey: string } | undefined
  return situationPublicBoundary(async () => {
    if (!input.aiConfig && !input.runAI) throw new Error('[ttrpg-situation] 缺少明确模型配置')
    const meta = { category: 'runtime.ttrpg-open.situation-propose', projectId: input.scope.projectId,
      configOverrides: { maxTokens: input.maximumOutputTokens }, contextOverflowPolicy: 'reject' as const }
    const resolved = input.aiConfig ? resolveRequestConfig(input.aiConfig, meta) : null
    const modelIdentity = input.runAI ? { provider: 'test-adapter', model: 'injected' } : { provider: resolved!.config.provider, model: resolved!.config.model }
    if (!input.runAI && modelIdentity.provider === 'poe') throw new Error('[ttrpg-situation] 当前 provider 不支持冻结输出上限')
    const prepared = await prepareTtrpgOpenSituationInputV1({ ...input, modelIdentity })
    locator = { runId: prepared.runId, requestKey: prepared.requestKey }
    return executeTtrpgOpenSituationRequestV1({ ...input, runId: prepared.runId, requestKey: prepared.requestKey })
  }, () => locator)
}

export async function executeTtrpgOpenSituationRequestV1(input: RuntimeRequest) {
  return situationPublicBoundary(async () => {
    await assertTtrpgOpenSituationRequesterV1(input)
    const result = await executeTtrpgOpenRuntimeRequestV1(input, 'situation-proposal')
    if (result.status === 'not-sent') return result
    if (result.candidate.schema !== 'storyforge.ttrpg-open-situation-candidate') throw new Error('局势候选格式错误')
    return { status: 'candidate' as const, summary: projectTtrpgOpenSituationCandidateSummaryV1(result.candidate) }
  }, () => input)
}

/** Continue exactly the original explicit public request. Human fallback receives status only. */
export async function generateTtrpgOpenPublicSituationCandidateV1(input: RuntimeRequest) {
  return situationPublicBoundary(async () => {
    await prepareTtrpgOpenPublicSituationInputV1(input)
    return executeTtrpgOpenPublicSituationRequestV1(input)
  }, () => input)
}
export async function executeTtrpgOpenPublicSituationRequestV1(input: RuntimeRequest) {
  return situationPublicBoundary(async () => {
    await assertTtrpgOpenSituationRequesterV1(input)
    const result = await executeTtrpgOpenRuntimeRequestV1(input, 'public-situation-proposal')
    if (result.status === 'not-sent') return result
    if (result.candidate.schema !== 'storyforge.ttrpg-open-public-situation-candidate') throw new Error('共同局势候选格式错误')
    return { status: 'candidate' as const, summary: projectTtrpgOpenPublicSituationCandidateSummaryV1(result.candidate) }
  }, () => input)
}
export async function recoverTtrpgOpenPublicSituationCandidateV1(input: TtrpgOpenCandidateReadV1) {
  return situationPublicBoundary(async () => {
    const current = await assertTtrpgOpenSituationRequesterV1(input)
    const state = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
    const call = state?.openRun?.coordination.calls.find(c => c.requestKey === input.requestKey)
    if (!call || ttrpgOpenModelPurposeForSkillV1(call.skillId).purpose !== 'public-situation-proposal') throw new Error('不是原共同局势请求')
    await readTtrpgOpenUnfinishedCandidateArtifactV1(input, 'public-situation-proposal')
    const epoch = current.runtime.openRun!.coordination.epochs.find(row => row.epochKey === call.authorizationEpochKey)
    if (epoch?.status === 'closed' || current.runtime.openRun!.situationReceipts?.some(row => row.model.requestKey === input.requestKey)) return readTtrpgOpenPublicSituationCandidateSummaryV1(input)
    if (call.status !== 'succeeded') return null
    const candidate = await materializeSucceededCandidate(input, 'public-situation-proposal', null, false)
    if (candidate.schema !== 'storyforge.ttrpg-open-public-situation-candidate') throw new Error('共同局势候选格式错误')
    return projectTtrpgOpenPublicSituationCandidateSummaryV1(candidate)
  }, () => input)
}

export async function recoverTtrpgOpenSituationCandidateV1(input: TtrpgOpenCandidateReadV1) {
  return situationPublicBoundary(async () => {
    const current = await assertTtrpgOpenSituationRequesterV1(input)
    const state = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
    const call = state?.openRun?.coordination.calls.find(c => c.requestKey === input.requestKey)
    if (!call || ttrpgOpenModelPurposeForSkillV1(call.skillId).purpose !== 'situation-proposal') throw new Error('不是原局势生成请求')
    await readTtrpgOpenUnfinishedCandidateArtifactV1(input, 'situation-proposal')
    const epoch = current.runtime.openRun!.coordination.epochs.find(e => e.epochKey === call.authorizationEpochKey)
    if (epoch?.status === 'closed' || current.runtime.openRun!.situationReceipts?.some(r => r.model.requestKey === input.requestKey)) return readTtrpgOpenSituationCandidateSummaryV1(input)
    if (call.status !== 'succeeded') return null
    const candidate = await materializeSucceededCandidate(input, 'situation-proposal', null, false)
    if (candidate.schema !== 'storyforge.ttrpg-open-situation-candidate') throw new Error('局势恢复格式错误')
    return projectTtrpgOpenSituationCandidateSummaryV1(candidate)
  }, () => input)
}

export async function generateTtrpgOpenBriefCandidateV1(input: Omit<Parameters<typeof prepareTtrpgOpenBriefInputV1>[0], 'modelIdentity'> & {
  aiConfig?: AIConfig; runAI?: TestTransport
}) {
  if (!input.aiConfig && !input.runAI) throw new Error('[ttrpg-brief] 缺少明确模型配置')
  const meta = { category: 'runtime.ttrpg-open.brief', projectId: input.scope.projectId,
    configOverrides: { maxTokens: input.maximumOutputTokens }, contextOverflowPolicy: 'reject' as const }
  const resolved = input.aiConfig ? resolveRequestConfig(input.aiConfig, meta) : null
  const modelIdentity = input.runAI ? { provider: 'test-adapter', model: 'injected' }
    : { provider: resolved!.config.provider, model: resolved!.config.model }
  if (!input.runAI && modelIdentity.provider === 'poe') throw new Error('[ttrpg-brief] 当前 provider 不支持本次要求的输出上限')
  const prepared = await prepareTtrpgOpenBriefInputV1({ ...input, modelIdentity })
  const result = await executeTtrpgOpenBriefRequestV1({ ...input, runId: prepared.runId, requestKey: prepared.requestKey })
  if (result.status !== 'candidate') throw new Error('[ttrpg-brief] 请求已被其他执行器接管，未重复发送')
  return { prepared, ...result }
}

type NormalizationGenerationInputV1 = Omit<Parameters<typeof prepareTtrpgOpenFactNormalizationInputV1>[0], 'modelIdentity'> & { aiConfig?: AIConfig; runAI?: TestTransport }
export async function generateTtrpgOpenFactNormalizationCandidateV1(input: NormalizationGenerationInputV1) {
  return generateTtrpgOpenFactNormalizationCandidate(input, false)
}
export async function generateTtrpgOpenFactNormalizationCandidateV2(input: Omit<NormalizationGenerationInputV1, 'rawInput' | 'hostingDelegationRef'> & {
  referencePolicy: 'accepted-interpretation-instances-v1'; onPrepared?: (prepared: Awaited<ReturnType<typeof prepareTtrpgOpenFactNormalizationInputV2>>) => void | Promise<void>;
}) {
  if (input.referencePolicy !== 'accepted-interpretation-instances-v1') throw new Error('请明确使用原已接受解释的实例事实归一策略')
  return generateTtrpgOpenFactNormalizationCandidate({ ...input, rawInput: TTRPG_OPEN_NORMALIZATION_INSTANCE_INPUT_V1 }, true, input.onPrepared)
}
async function generateTtrpgOpenFactNormalizationCandidate(input: NormalizationGenerationInputV1, runtimeReferences: boolean,
  onPrepared?: (prepared: Awaited<ReturnType<typeof prepareTtrpgOpenFactNormalizationInputV2>>) => void | Promise<void>) {
  if (!input.aiConfig && !input.runAI) throw new Error('[ttrpg-open-fact-normalize] 缺少明确模型配置')
  const meta = { category: 'runtime.ttrpg-open.fact-normalize', projectId: input.scope.projectId,
    configOverrides: { maxTokens: input.maximumOutputTokens }, contextOverflowPolicy: 'reject' as const }
  const resolved = input.aiConfig ? resolveRequestConfig(input.aiConfig, meta) : null
  const modelIdentity = input.runAI ? { provider: 'test-adapter', model: 'injected' }
    : { provider: resolved!.config.provider, model: resolved!.config.model }
  if (!input.runAI && modelIdentity.provider === 'poe') throw new Error('[ttrpg-open-fact-normalize] 当前 provider 不支持本次要求的输出上限')
  const prepared = runtimeReferences ? await prepareTtrpgOpenFactNormalizationInputV2({ ...input, modelIdentity, referencePolicy: 'accepted-interpretation-instances-v1' })
    : await prepareTtrpgOpenFactNormalizationInputV1({ ...input, modelIdentity })
  await onPrepared?.(prepared)
  const result = await executeTtrpgOpenFactNormalizationRequestV1({ ...input, runId: prepared.runId, requestKey: prepared.requestKey })
  if (result.status !== 'candidate') throw new Error('[ttrpg-open-fact-normalize] 请求已被其他执行器接管，未重复发送')
  return { prepared, ...result }
}

/** Resumes only a prepared request. A dispatched or terminal request never receives another send permit. */
type RuntimeRequest = {
  scope: WorkspaceScope; sessionId: number; runId: number; requestKey: string; viewerKey: string
  aiConfig?: AIConfig; runAI?: TestTransport; signal?: AbortSignal
}
export async function executeTtrpgOpenIntentRequestV1(input: RuntimeRequest): Promise<{ status: 'not-sent' } | { status: 'candidate'; candidate: TtrpgOpenIntentCandidateV1 }> {
  const result = await executeTtrpgOpenRuntimeRequestV1(input, 'intent')
  if (result.status === 'not-sent') return result
  if (result.candidate.schema !== 'storyforge.ttrpg-open-intent-candidate') throw new Error('运行候选格式不匹配')
  return { status: 'candidate', candidate: result.candidate }
}
export async function executeTtrpgOpenCompanionRequestV1(input: RuntimeRequest) {
  const result = await executeTtrpgOpenRuntimeRequestV1(input, 'companion')
  if (result.status === 'not-sent') return result
  if (result.candidate.schema !== 'storyforge.ttrpg-open-intent-candidate') throw new Error('[ttrpg-companion] 候选类型错误')
  return { status: 'candidate' as const, candidate: result.candidate }
}
export async function executeTtrpgOpenKpRequestV1(input: RuntimeRequest) {
  const result = await executeTtrpgOpenRuntimeRequestV1(input, 'kp-narration')
  if (result.status === 'not-sent') return result
  if (result.candidate.schema !== 'storyforge.ttrpg-open-kp-candidate') throw new Error('[ttrpg-kp] 候选类型错误')
  return { status: 'candidate' as const, candidate: result.candidate }
}
export async function executeTtrpgOpenBriefRequestV1(input: RuntimeRequest) {
  const result = await executeTtrpgOpenRuntimeRequestV1(input, 'stage-brief')
  if (result.status === 'not-sent') return result
  if (result.candidate.schema !== 'storyforge.ttrpg-open-brief-candidate') throw new Error('[ttrpg-brief] 候选类型错误')
  return { status: 'candidate' as const, candidate: result.candidate }
}
export async function executeTtrpgOpenEntityRequestV1(input: RuntimeRequest) {
  await assertTtrpgOpenEntityCandidateReaderV1(input)
  const result = await executeTtrpgOpenRuntimeRequestV1(input, 'entity-proposal')
  await assertTtrpgOpenEntityCandidateReaderV1(input)
  if (result.status === 'not-sent') return result
  if (result.candidate.schema !== 'storyforge.ttrpg-open-entity-candidate') throw new Error('[ttrpg-entity] 候选类型不匹配')
  return { status: 'candidate' as const, candidate: result.candidate }
}
export async function executeTtrpgOpenOracleRequestV1(input: RuntimeRequest): Promise<{ status: 'not-sent' } | { status: 'candidate'; candidate: TtrpgOpenOracleCandidateV1 }> {
  const result = await executeTtrpgOpenRuntimeRequestV1(input, 'oracle-interpret')
  if (result.status === 'not-sent') return result
  if (result.candidate.schema !== 'storyforge.ttrpg-open-oracle-candidate') throw new Error('运行候选格式不匹配')
  return { status: 'candidate', candidate: result.candidate }
}
export async function executeTtrpgOpenFactNormalizationRequestV1(input: RuntimeRequest): Promise<{ status: 'not-sent' } | { status: 'candidate'; candidate: TtrpgOpenOracleCandidateV1 }> {
  const result = await executeTtrpgOpenRuntimeRequestV1(input, 'fact-normalize')
  if (result.status === 'not-sent') return result
  if (result.candidate.schema !== 'storyforge.ttrpg-open-oracle-candidate') throw new Error('运行候选格式不匹配')
  return { status: 'candidate', candidate: result.candidate }
}
async function executeTtrpgOpenRuntimeRequestV1(input: RuntimeRequest, purpose: TtrpgOpenModelPurposeV1): Promise<{ status: 'not-sent' } | { status: 'candidate'; candidate: TtrpgOpenRuntimeCandidateV1 }> {
  let snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
  if (snapshot.run.portableRuntimeOriginJson !== undefined) throw new Error('[ttrpg-open-call] 导入的原请求只保留历史证据，不授予新的发送权限')
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  const call = runtime?.openRun?.coordination.calls.find(call => call.requestKey === input.requestKey)
  if (!call || snapshot.run.productRuntimeSessionId !== input.sessionId || call.runContractHash !== snapshot.run.contractHash) {
    throw new Error('[ttrpg-open-intent] 请求不属于当前实例运行')
  }
  const definition = ttrpgOpenModelPurposeForSkillV1(call.skillId)
  if (definition.purpose !== purpose) throw new Error('[ttrpg-open-call] 执行入口与冻结运行目的不一致')
  const epoch = runtime!.openRun!.coordination.epochs.find(epoch => epoch.epochKey === call.authorizationEpochKey)
  if (!epoch || (call.narrationBinding?.viewerKey ?? epoch.viewerKey) !== input.viewerKey) throw new Error('[ttrpg-open-intent] 请求不属于当前真人授权')
  if (call.status !== 'prepared') return { status: 'not-sent' }
  if (input.signal?.aborted) throw new Error('[ttrpg-open-intent] 请求已取消，未派发')
  const handledByAnotherExecutor = async () => {
    const current = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
    const latest = current?.openRun?.coordination.calls.find(row => row.requestKey === call.requestKey)
    return latest?.runContractHash === call.runContractHash && latest.status !== 'prepared'
  }
  try { await verifyTtrpgOpenModelCallEvidenceV1({ ...input, call, mode: 'dispatch' }) }
  catch (error) {
    if (await handledByAnotherExecutor()) return { status: 'not-sent' }
    throw error
  }
  const rendered = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId,
    artifactKind: 'rendered-request', contentHash: call.requestHash })) as { messages: ChatMessage[]; modelIdentity: { provider: string; model: string } }
  const binding = snapshot.contract.executionBindings?.find(binding => binding.stepId === call.stepId)
  if (!binding || binding.version !== 2 || !binding.formalEntry || call.stepId !== definition.stepId) {
    throw new Error('[ttrpg-open-intent] 请求缺少冻结正式入口/Skill')
  }
  const meta = { category: purpose === 'common-oracle-interpret' ? 'runtime.ttrpg-open.common-oracle-interpret' : purpose === 'entity-proposal' ? 'runtime.ttrpg-open.entity-propose' : purpose === 'public-situation-proposal' ? 'runtime.ttrpg-open.public-situation-propose' : purpose === 'situation-proposal' ? 'runtime.ttrpg-open.situation-propose' : purpose === 'stage-brief' ? 'runtime.ttrpg-open.brief' : purpose === 'companion' ? 'runtime.ttrpg-open.companion' : purpose === 'kp-narration' ? 'runtime.ttrpg-open.kp' : purpose === 'intent' ? 'runtime.ttrpg-open.intent' : purpose === 'oracle-interpret' ? 'runtime.ttrpg-open.oracle-interpret' : 'runtime.ttrpg-open.fact-normalize', projectId: input.scope.projectId,
    configOverrides: { maxTokens: call.reservedOutputTokens }, contextOverflowPolicy: 'reject' as const }
  const resolved = input.aiConfig ? resolveRequestConfig(input.aiConfig, meta) : null
  const identity = input.runAI ? { provider: 'test-adapter', model: 'injected' }
    : resolved ? { provider: resolved.config.provider, model: resolved.config.model } : null
  if (!identity || identity.provider !== rendered.modelIdentity?.provider || identity.model !== rendered.modelIdentity?.model
    || (!input.runAI && identity.provider === 'poe')) throw new Error('[ttrpg-open-intent] 模型配置与冻结请求不一致')
  const envelope = async () => ({ ...await currentEnvelope(input.sessionId, `intent.${call.requestKey}`),
    requestKey: call.requestKey, viewerKey: input.viewerKey, runId: input.runId })
  let permit: Awaited<ReturnType<typeof dispatchTtrpgOpenModelCallV1>>
  try { permit = await dispatchTtrpgOpenModelCallV1(await envelope()) }
  catch (error) {
    if (await handledByAnotherExecutor()) return { status: 'not-sent' }
    throw error
  }
  if (!permit.sendAuthorized) return { status: 'not-sent' }
  const result: ChatResult = { requestLifecycle: { phase: 'pre-dispatch', responseStatus: null } }
  const controller = new AbortController()
  const abort = () => controller.abort(input.signal?.reason)
  if (input.signal?.aborted) abort()
  else input.signal?.addEventListener('abort', abort, { once: true })
  const timeout = globalThis.setTimeout(() => controller.abort(new DOMException('跑团意图请求超时', 'TimeoutError')), 60_000)
  const startedAt = Date.now()
  let rejectAbort: (() => void) | undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(controller.signal.reason ?? new DOMException('跑团意图请求已取消', 'AbortError'))
    if (controller.signal.aborted) rejectAbort()
    else controller.signal.addEventListener('abort', rejectAbort, { once: true })
  })
  let output: string
  try {
    const transport = async () => {
      if (controller.signal.aborted) throw controller.signal.reason
      if (input.runAI) {
        result.requestLifecycle = { phase: 'request-dispatched', responseStatus: null }
        const text = await input.runAI(rendered.messages, controller.signal, result)
        result.requestLifecycle = { phase: 'response-observed', responseStatus: 200 }
        return text
      }
      const frozenSkill = projectFrozenAgentSkillDefinitionV1(binding)
      if (purpose === 'entity-proposal') return executeFrozenFormalAIEntryV1('ttrpg.open.entity-propose', binding.formalEntry!, frozenSkill, 'src/lib/ttrpg/open-intent-harness.ts', rendered.messages, input.aiConfig!, { ...meta, category: 'runtime.ttrpg-open.entity-propose' }, controller.signal, result, undefined, resolved!)
      if (purpose === 'public-situation-proposal') return executeFrozenFormalAIEntryV1('ttrpg.open.public-situation-propose', binding.formalEntry!, frozenSkill, 'src/lib/ttrpg/open-intent-harness.ts', rendered.messages, input.aiConfig!, { ...meta, category: 'runtime.ttrpg-open.public-situation-propose' }, controller.signal, result, undefined, resolved!)
      if (purpose === 'companion') return executeFrozenFormalAIEntryV1('ttrpg.open.companion', binding.formalEntry!, frozenSkill, 'src/lib/ttrpg/open-intent-harness.ts', rendered.messages, input.aiConfig!, { ...meta, category: 'runtime.ttrpg-open.companion' }, controller.signal, result, undefined, resolved!)
      if (purpose === 'situation-proposal') return executeFrozenFormalAIEntryV1('ttrpg.open.situation-propose', binding.formalEntry!, frozenSkill, 'src/lib/ttrpg/open-intent-harness.ts', rendered.messages, input.aiConfig!, { ...meta, category: 'runtime.ttrpg-open.situation-propose' }, controller.signal, result, undefined, resolved!)
      if (purpose === 'stage-brief') return executeFrozenFormalAIEntryV1('ttrpg.open.brief', binding.formalEntry!, frozenSkill, 'src/lib/ttrpg/open-intent-harness.ts', rendered.messages, input.aiConfig!, { ...meta, category: 'runtime.ttrpg-open.brief' }, controller.signal, result, undefined, resolved!)
      if (purpose === 'kp-narration') return executeFrozenFormalAIEntryV1('ttrpg.open.kp', binding.formalEntry!, frozenSkill, 'src/lib/ttrpg/open-intent-harness.ts', rendered.messages, input.aiConfig!, { ...meta, category: 'runtime.ttrpg-open.kp' }, controller.signal, result, undefined, resolved!)
      if (purpose === 'common-oracle-interpret') return executeFrozenFormalAIEntryV1('ttrpg.open.common-oracle-interpret', binding.formalEntry!, frozenSkill,
        'src/lib/ttrpg/open-intent-harness.ts', rendered.messages, input.aiConfig!, { ...meta, category: 'runtime.ttrpg-open.common-oracle-interpret' }, controller.signal, result, undefined, resolved!)
      return purpose === 'intent'
        ? executeFrozenFormalAIEntryV1('ttrpg.open.intent', binding.formalEntry!, frozenSkill,
          'src/lib/ttrpg/open-intent-harness.ts', rendered.messages, input.aiConfig!, { ...meta, category: 'runtime.ttrpg-open.intent' }, controller.signal, result, undefined, resolved!)
        : purpose === 'oracle-interpret' ? executeFrozenFormalAIEntryV1('ttrpg.open.oracle-interpret', binding.formalEntry!, frozenSkill,
          'src/lib/ttrpg/open-intent-harness.ts', rendered.messages, input.aiConfig!, { ...meta, category: 'runtime.ttrpg-open.oracle-interpret' }, controller.signal, result, undefined, resolved!)
        : executeFrozenFormalAIEntryV1('ttrpg.open.fact-normalize', binding.formalEntry!, frozenSkill,
          'src/lib/ttrpg/open-intent-harness.ts', rendered.messages, input.aiConfig!, { ...meta, category: 'runtime.ttrpg-open.fact-normalize' }, controller.signal, result, undefined, resolved!)
    }
    output = await Promise.race([transport(), cancelled])
  } catch (error) {
    const lifecycle = result.requestLifecycle
    const noSend = lifecycle?.phase === 'pre-dispatch'
    const denied = lifecycle?.phase === 'response-observed' && lifecycle.responseStatus !== null
      && lifecycle.responseStatus >= 400 && lifecycle.responseStatus < 500
    await finishTtrpgOpenModelCallV1({ ...await envelope(), status: noSend || denied ? 'failed' : 'unknown', responseArtifactHash: null,
      usage: { source: 'unknown', inputTokens: noSend ? 0 : null, outputTokens: noSend ? 0 : null, actualCostUsd: noSend ? 0 : null },
      terminalReason: noSend ? 'transport-rejected-before-send' : denied ? 'provider-denied-no-retry' : 'transport-result-unknown' })
    snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
    snapshot = await appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: input.runId,
      type: 'step.failed', payload: { stepId: call.stepId, attempt: call.attempt, code: 'ttrpg-open-transport-failed', retryable: false,
        category: denied || noSend ? 'deterministic' : 'unknown', action: 'pause-for-author' }, expectedLastSequence: snapshot.projection.lastSequence })
    await appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: input.runId,
      type: 'run.failed', payload: { code: 'ttrpg-open-transport-failed', retryable: false }, expectedLastSequence: snapshot.projection.lastSequence })
    throw error
  } finally {
    globalThis.clearTimeout(timeout); input.signal?.removeEventListener('abort', abort)
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort)
  }
  snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
  // Exact provider text is saved before JSON normalization, protocol checks, stale checks or candidate creation.
  const raw = await recordAgentRunArtifactV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: input.runId,
    artifactKind: 'raw-response', content: output, stepId: call.stepId, attempt: call.attempt,
    expectedLastSequence: snapshot.projection.lastSequence })
  snapshot = await appendAgentRunEventV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: input.runId,
    type: 'model.responded', payload: { stepId: call.stepId, attempt: call.attempt, outputHash: raw.artifact.contentHash },
    expectedLastSequence: raw.snapshot.projection.lastSequence })
  const inputTokens = result.usage?.inputTokens ?? estimateTtrpgOpenRuntimeFallbackInputV1(rendered)
  const outputTokens = result.usage?.outputTokens ?? estimateTokens(output)
  // Token receipts are not a billing receipt. Unknown actual cost stays null and consumes the conservative reservation.
  await finishTtrpgOpenModelCallV1({ ...await envelope(), status: 'succeeded', responseArtifactHash: raw.artifact.contentHash,
    usage: { source: result.usage ? 'provider' : 'estimated', inputTokens, outputTokens, actualCostUsd: null },
    terminalReason: inputTokens > call.reservedInputTokens || outputTokens > call.reservedOutputTokens ? 'token-budget-overrun' : 'response-recorded' })
  return { status: 'candidate', candidate: await materializeSucceededCandidate(input, purpose, Math.max(0, Date.now() - startedAt), input.signal?.aborted ?? false) }
}

/** Finishes retained successful output only. No credentials, send permit, new request or budget renewal. */
export async function recoverTtrpgOpenRuntimeCandidateV1(input: TtrpgOpenCandidateReadV1): Promise<TtrpgOpenRuntimeCandidateV1 | null> {
  const state = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  const call = state?.openRun?.coordination.calls.find(row => row.requestKey === input.requestKey)
  if (!call) throw new Error('[ttrpg-open-recovery] 请求不存在')
  // Read validates the original viewer, Run and purpose even when no candidate is present.
  const purpose = ttrpgOpenModelPurposeForSkillV1(call.skillId).purpose
  if (purpose === 'entity-proposal') await assertTtrpgOpenEntityCandidateReaderV1(input)
  if (purpose === 'situation-proposal' || purpose === 'public-situation-proposal') await assertTtrpgOpenSituationHumanGmV1(input)
  await readTtrpgOpenUnfinishedCandidateArtifactV1(input, purpose)
  if (call.status !== 'succeeded') return null
  return materializeSucceededCandidate(input, purpose, null, false)
}

async function materializeSucceededCandidate(input: TtrpgOpenCandidateReadV1, purpose: TtrpgOpenModelPurposeV1,
  latencyMs: number | null, cancelled: boolean): Promise<TtrpgOpenRuntimeCandidateV1> {
  // Existing Run sequence CAS arbitrates same-tab and cross-tab recovery. Retry only local evidence conflicts.
  for (let attempt = 0; attempt < 6; attempt++) {
    try { return await materializeSucceededCandidateOnce(input, purpose, latencyMs, cancelled) }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null
      if (!['sequence-conflict', 'sequence_conflict', 'duplicate-finalize'].includes(String(code)) || attempt === 5) throw error
    }
  }
  throw new Error('[ttrpg-open-recovery] 运行持续推进，请刷新后继续恢复')
}

async function materializeSucceededCandidateOnce(input: TtrpgOpenCandidateReadV1, purpose: TtrpgOpenModelPurposeV1,
  latencyMs: number | null, cancelled: boolean): Promise<TtrpgOpenRuntimeCandidateV1> {
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  const call = runtime?.openRun?.coordination.calls.find(row => row.requestKey === input.requestKey)
  if (!call || call.status !== 'succeeded' || !call.responseArtifactHash || !call.usage
    || call.usage.inputTokens === null || call.usage.outputTokens === null) throw new Error('[ttrpg-open-recovery] 缺少实际成功响应和原用量')
  await verifyTtrpgOpenModelCallEvidenceV1({ ...input, call, mode: 'finish' })
  let snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
  const epoch = runtime!.openRun!.coordination.epochs.find(row => row.epochKey === call.authorizationEpochKey)
  if (!epoch || (call.narrationBinding?.viewerKey ?? epoch.viewerKey) !== input.viewerKey
    || ttrpgOpenModelPurposeForSkillV1(call.skillId).purpose !== purpose) throw new Error('[ttrpg-open-recovery] 恢复角色或目的不匹配')
  const rendered = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId,
    artifactKind: 'rendered-request', contentHash: call.requestHash })) as { modelIdentity: { provider: string; model: string } }
  let evidence: TtrpgOpenInputEvidenceV1 | undefined
  for (const event of snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'source-snapshot'
      || event.payload.stepId !== call.stepId || event.payload.attempt !== call.attempt) continue
    const body = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId,
      artifactKind: 'source-snapshot', contentHash: event.payload.contentHash })) as TtrpgOpenInputEvidenceV1
    if (body.schema === 'storyforge.ttrpg-open-input-evidence' && body.manifest.manifestHash === call.inputManifestHash) evidence = body
  }
  if (!evidence) throw new Error('[ttrpg-open-intent] 无法回读冻结输入')
  const frozen = evidence
  const output = await readAgentRunArtifactExactV1({ projectId: input.scope.projectId,
    artifactKind: 'raw-response', contentHash: call.responseArtifactHash })
  const retained = await readTtrpgOpenUnfinishedCandidateArtifactV1(input, purpose)
  const candidate = retained ?? await buildSucceededCandidate({ input, purpose, runtime: runtime!, call, epoch,
    frozen, output, identity: rendered.modelIdentity, latencyMs, cancelled })
  // Keep the sequence captured before reading/building the candidate. A competing writer must win CAS,
  // never let a refreshed sequence authorize a second body with different latency/issue observations.
  const candidateRecord = await recordAgentRunArtifactV1({ scope: input.scope, productRuntimeSessionId: input.sessionId,
    runId: input.runId, artifactKind: 'source-snapshot', content: JSON.stringify(candidate), stepId: call.stepId,
    attempt: call.attempt, expectedLastSequence: snapshot.projection.lastSequence })
  snapshot = candidateRecord.snapshot
  const hasManifest = snapshot.events.some(event => event.type === 'context.assembled'
    && event.payload.stepId === call.stepId && event.payload.attempt === call.attempt)
  const finalized = hasManifest ? await readContextGatewayManifestV3ForAttemptV1({ ...input, stepId: call.stepId, attempt: call.attempt })
    : await finalizeContextGatewayAttemptEvidenceV1({ scope: input.scope, runId: input.runId, stepId: call.stepId,
      attempt: call.attempt, baseManifest: frozen.manifest, preflight: frozen.preflight, selector: frozen.selector,
      sufficiency: frozen.sufficiency, retrievalTrace: frozen.retrievalTrace, gatewayVersionHash: frozen.gatewayVersionHash,
      policyHash: frozen.policyHash, rawResponse: output, candidateHash: candidate.candidateHash,
      expectedLastSequence: snapshot.projection.lastSequence })
  if (finalized.manifest.candidate.candidateHash !== candidate.candidateHash) throw new Error('[ttrpg-open-recovery] 已存 Manifest 与候选不一致')
  snapshot = finalized.snapshot
  const persisted = snapshot.events.filter(event => event.type === 'candidate.persisted'
    && event.payload.stepId === call.stepId && event.payload.attempt === call.attempt)
  if (persisted.length > 1 || persisted.some(event => event.type === 'candidate.persisted'
    && event.payload.candidateHash !== candidate.candidateHash)) throw new Error('[ttrpg-open-recovery] 候选回执冲突')
  if (!persisted.length) snapshot = await appendAgentRunEventV1({ scope: input.scope, runId: input.runId, productRuntimeSessionId: input.sessionId,
    type: 'candidate.persisted', payload: { stepId: call.stepId, attempt: call.attempt,
      candidateHash: candidate.candidateHash, requiresConfirmation: true }, expectedLastSequence: snapshot.projection.lastSequence })
  const verified = await readTtrpgOpenRuntimeCandidateV1(input, purpose)
  if (!verified || verified.candidateHash !== candidate.candidateHash) throw new Error('[ttrpg-open-recovery] 候选完整证据未通过')
  const candidateIndex = snapshot.events.findIndex(event => event.type === 'candidate.persisted')
  if (!snapshot.events.slice(candidateIndex + 1).some(event => event.type === 'checkpoint.created')) {
    await createAgentRunCheckpointV1({ scope: input.scope, runId: input.runId, productRuntimeSessionId: input.sessionId,
      resumePayload: candidate, expectedLastSequence: snapshot.projection.lastSequence })
  }
  return verified
}

async function buildSucceededCandidate(args: {
  input: TtrpgOpenCandidateReadV1; purpose: TtrpgOpenModelPurposeV1
  runtime: NonNullable<ReturnType<typeof parseTtrpgRuntimeStateV2>>
  call: import('./open-model-calls').TtrpgOpenModelCallV1
  epoch: import('./open-coordination').TtrpgOpenEpochV1
  frozen: TtrpgOpenInputEvidenceV1; output: string; identity: { provider: string; model: string }
  latencyMs: number | null; cancelled: boolean
}): Promise<TtrpgOpenRuntimeCandidateV1> {
  const { input, purpose, runtime, call, epoch, frozen, output, identity, latencyMs, cancelled } = args
  const inputTokens = call.usage!.inputTokens!, outputTokens = call.usage!.outputTokens!
  const issues: CreativeArtifactIssueV1[] = []
  if (cancelled) issues.push(createCreativeIssueV1({ code: 'ttrpg-open-intent-cancelled', path: 'runtime',
    message: '请求已由真人取消，保留响应与用量，不采用候选。', disposition: 'blocking', action: 'replan' }))
  let situation: TtrpgOpenSituationCandidateV1['review'] = null
  let references: TtrpgOpenSituationCandidateV1['references'] = []
  let publicReferences: import('./open-public-situation-candidate').TtrpgOpenPublicSituationCandidateV1['references'] = []
  let brief: TtrpgOpenBriefV1 | null = null
  let entityProposals: TtrpgOpenEntityCandidateV1['proposals'] = null
  let attributions: TtrpgOpenBriefAttributionV1[] = []
  const deliveredReads: ContextGatewaySourceSnapshotInputV1[] = []
  let narration: TtrpgOpenKpNarrationV1 | null = null
  const deliveredValues: unknown[] = []
  let intent: TtrpgOpenIntentV1 | null = null
  let assumptions: CreativeAssumptionV1[] = []
  let oracleCandidate: ReturnType<typeof parseTtrpgOpenOracleSemanticCandidateV1> | null = null
  let oracleContract: unknown, oraclePacket: unknown, normalizationPacket: unknown
  const visibleRefs = new Set([call.actorKey]), visibleResources = new Set<string>()
  let source: TtrpgOpenIntentV1['source'] = 'player'
  for (const ref of frozen.preflight.artifacts.filter(ref => ref.role === 'source-snapshot')) {
    const stored = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId,
      artifactKind: ref.artifactKind, contentHash: ref.contentHash })) as { content: string }
    const value = JSON.parse(stored.content)
    deliveredReads.push({ sourceKey: ref.sourceKey, resourceKey: ref.resourceKey, content: stored.content })
    deliveredValues.push(value)
    if (value.schema === 'storyforge.ttrpg-open-gm-oracle-contract') oracleContract = value
    if (value.schema === 'storyforge.ttrpg-open-gm-oracle-input') oraclePacket = value
    if (value.schema === 'storyforge.ttrpg-open-gm-fact-normalization-input') normalizationPacket = value
    if ((ref.resourceKey?.endsWith(':authority') || ref.resourceKey?.endsWith(':authority.v3'))) {
      if (purpose === 'companion' || value.authority.controller === 'ai') source = `companion:${call.actorKey}`
      if (value.self.locationKey) visibleRefs.add(value.self.locationKey)
      for (const actor of value.actorsHere) visibleRefs.add(actor.actorKey)
      for (const item of value.self.inventory) if (item.quantity > 0) visibleResources.add(item.itemInstanceId)
    }
    if (ref.resourceKey?.endsWith(':rules-core')) for (const resource of value.resources) visibleResources.add(resource.key)
    if (ref.resourceKey?.includes(':initial.')) {
      if (value.subjectRef) visibleRefs.add(value.subjectRef)
      if (value.objectRef) visibleRefs.add(value.objectRef)
    }
  }
  try {
    if (purpose === 'common-oracle-interpret') {
      const source = await verifyProductRuntimeSessionSourceV1({ scope: input.scope, session: await assertInstanceBinding(input.sessionId, input.scope), ttrpgProtocol: 2 })
      if (!epoch.commonOracle || !source.runtimePackage.ttrpg || !isTtrpgRuntimeContentV2(source.runtimePackage.ttrpg)) throw new Error('共同事实缺少准确原授权和冻结来源')
      const delivered = await reviewTtrpgOpenCommonOracleDeliveryV1({ basis: epoch.commonOracle.basis, content: source.runtimePackage.ttrpg, snapshots: deliveredReads })
      oraclePacket = delivered.packet
      oracleCandidate = parseTtrpgOpenCommonOracleSemanticCandidateV1(output, delivered)
    }
    else if (purpose === 'entity-proposal') entityProposals = reviewTtrpgOpenEntityModelDeliveryV1(call.entityProposal, deliveredReads, JSON.parse(output)).proposals
    else if (purpose === 'public-situation-proposal') {
      const kernel = await readTtrpgOpenPublicSituationKernelSnapshotV1(input, call, epoch, frozen)
      const result = await reviewTtrpgOpenDeliveredPublicSituationV1({ value: JSON.parse(output), snapshot: kernel, reads: deliveredReads })
      situation = result.review; publicReferences = result.references
      if (!situation.evaluation.accepted) issues.push(createCreativeIssueV1({ code: 'ttrpg-public-situation-generation-gate', path: 'situation', message: '共同局势候选未通过确定性生成检查，不能采用。', disposition: 'blocking', action: 'edit' }))
    }
    else if (purpose === 'situation-proposal') {
      const kernel = await readTtrpgOpenSituationKernelSnapshotV1(input, call, epoch)
      const result = await reviewTtrpgOpenDeliveredSituationV1({ value: JSON.parse(output), snapshot: kernel, reads: deliveredReads })
      situation = result.review; references = result.references
      if (!situation.evaluation.accepted) issues.push(createCreativeIssueV1({ code: 'ttrpg-situation-generation-gate', path: 'situation', message: '局势未通过确定性生成检查，不能采用。', disposition: 'blocking', action: 'edit' }))
    }
    else if (purpose === 'stage-brief') {
      attributions = await ttrpgOpenDeliveredBriefAttributionsV1(deliveredReads)
      brief = parseTtrpgOpenBriefV1(JSON.parse(output), attributions)
    }
    else if (purpose === 'kp-narration') { narration = parseTtrpgOpenKpNarrationV1(JSON.parse(output), ttrpgOpenDeliveredKpSourceKeysV1(deliveredValues)) }
    else if (purpose === 'fact-normalize') oracleCandidate = parseTtrpgOpenFactNormalizationCandidateV1(output,{ contract: oracleContract,oracle: oraclePacket,review: normalizationPacket })
    else if (purpose === 'oracle-interpret') oracleCandidate = parseTtrpgOpenOracleSemanticCandidateV1(output, { contract: oracleContract, oracle: oraclePacket })
    else {
      const proposed = parseSemanticIntent(output, { actorKey: call.actorKey, source, inputRevision: epoch.inputRevision,
        intentKey: await ttrpgOpenScopedKeyV1(runtime!.sessionKey, 'intent', [call.requestKey]), visibleRefs, visibleResources })
      // Declared guesses remain provisional raw-response claims. Validate their
      // canonical artifact shape before accepting the intent, inside repair handling.
      assumptions = proposed.declaredAssumptions.map((text, index) => parseCreativeAssumptionV1({ version: 1,
        id: `assumption.${index}`, text, derivedFrom: [`raw-response:${call.responseArtifactHash}:declaredAssumptions[${index}]`],
        confidence: 'low', conflictsWith: [], status: 'provisional' }, index))
      intent = proposed
    }
  } catch (error) {
    if (purpose === 'common-oracle-interpret') issues.push(createCreativeIssueV1({ code: 'ttrpg-common-oracle-protocol', path: 'facts',
      message: '共同解释、事实格式、主体、来源或准确范围未通过检查；原始回答已保存。', disposition: 'blocking', action: 'edit' }))
    else if (purpose === 'entity-proposal') issues.push(createCreativeIssueV1({ code: 'ttrpg-entity-protocol', path: 'proposals',
      message: '实体提案格式、参数、位置、数量或原范围未通过检查；原始回答已保存。', disposition: 'blocking', action: 'edit' }))
    else if (purpose === 'public-situation-proposal') issues.push(createCreativeIssueV1({ code: 'ttrpg-public-situation-protocol', path: 'situation',
      message: '共同局势格式或完整交付引用未通过验证；原始回答已保存。', disposition: 'blocking', action: 'edit' }))
    else
    issues.push(createCreativeIssueV1({ code: purpose === 'situation-proposal' ? 'ttrpg-situation-protocol' : purpose === 'stage-brief' ? 'ttrpg-open-brief-protocol' : 'ttrpg-open-intent-protocol', path: purpose === 'situation-proposal' ? 'situation' : purpose === 'stage-brief' ? 'brief' : 'intent',
      message: purpose === 'situation-proposal' ? '局势私域验证未通过：' + (error instanceof Error ? error.message.slice(0, 1000) : '格式或来源不完整') + '；原始回答已保存。' : purpose === 'stage-brief' ? '复盘格式不完整，或引用了本次未实际交付的资料；原始回复已保留。' : '意图格式不完整，或引用了本次未授权读取的对象；原始响应已保留。', action: 'edit' }))
  }
  if (inputTokens > call.reservedInputTokens || outputTokens > call.reservedOutputTokens || estimateTokens(output) > call.reservedOutputTokens) {
    issues.push(createCreativeIssueV1({ code: 'ttrpg-open-intent-budget', path: 'usage',
      message: '模型实际 token 用量或响应正文估算超过冻结预算，保留响应与用量并停止候选采用。', disposition: 'blocking', action: 'replan' }))
  }
  try {
    const current = await loadTtrpgOpenModelContextV1({ scope: input.scope, sessionId: input.sessionId, actorKey: call.actorKey, skillId: call.skillId })
    if (purpose === 'kp-narration') {
      if (!('modernResources' in current)) throw new Error('KP 缺少当前准确交付视图')
      assertTtrpgOpenKpDeliveryCurrentV1(deliveredValues, current.modernResources)
    }
    const latestState = await readProductRuntimeState(input.sessionId),latest = parseTtrpgRuntimeStateV2(latestState.ttrpg)
    if (call.hostingDelegationRef) assertTtrpgOpenHostingDelegationV1(latestState,{ epochKey: call.authorizationEpochKey,viewerKey: input.viewerKey,delegationRef: call.hostingDelegationRef })
    if (current.admissionStateHash !== call.admissionStateHash || current.visibilityHash !== call.visibilityHash
      || current.readEvidence.runtimeSourceHash !== call.runtimeSourceHash || latest?.openRun?.coordination.activeEpochKey !== epoch.epochKey) {
      throw new Error('stale')
    }
  } catch {
    issues.push(createCreativeIssueV1({ code: 'ttrpg-open-intent-stale', path: 'runtime',
      message: '生成期间角色权限、机械状态或授权窗口发生变化，需要真人重新发起。', disposition: 'blocking', action: 'replan' }))
  }
  issues.push(createCreativeIssueV1({ code: 'ttrpg-open-intent-cost-unknown', path: 'usage.actualCostUsd',
    message: '已保留 token 回执；provider 未提供实际账单金额，按本次预留额度继续记账。',
    severity: 'warning', disposition: 'advisory', action: 'none' }))
  const artifact = parseCreativeArtifactV1({ version: 1, policyVersion: 'creative-reliability-v1',
    status: issues.some(issue => issue.disposition === 'blocking') ? 'blocked' : (entityProposals || intent || oracleCandidate || narration || brief || situation) ? 'usable-with-warnings' : 'manual-repair',
    qualityMode: 'economy', originalText: output.slice(0, 120_000), editableText: output.slice(0, 120_000), validFragments: entityProposals ? [{ version: 1, id: 'entities', path: 'proposals', text: JSON.stringify(entityProposals), status: 'valid', issueCodes: [] }] : situation ? [{ version: 1, id: 'situation', path: 'situation', text: JSON.stringify(situation.proposal), status: 'valid', issueCodes: [] }] : intent ? [{ version: 1,
      id: 'intent', path: 'intent', text: JSON.stringify(intent), status: 'valid', issueCodes: [] }] : oracleCandidate ? [{ version: 1, id: 'oracle', path: 'oracle', text: JSON.stringify(oracleCandidate), status: 'valid', issueCodes: [] }] : narration ? [{ version: 1, id: 'narration', path: 'narration', text: JSON.stringify(narration), status: 'valid', issueCodes: [] }] : brief ? [{ version: 1, id: 'brief', path: 'brief', text: JSON.stringify(brief), status: 'valid', issueCodes: [] }] : [], rejectedFragments: [], issues,
    assumptions,
    canonEvidenceRefs: [], repair: null, callEvidence: [{ version: 1, callIndex: 1, purpose: 'generate', status: 'succeeded',
      provider: identity.provider, model: identity.model, usageSource: call.usage!.source, inputTokens,
      outputTokens, totalTokens: inputTokens + outputTokens, latencyMs,
      estimatedCostUsd: computeKnownCostUsd(identity.model, inputTokens, outputTokens), outputHash: call.responseArtifactHash! }] })
  const common = { version: 1 as const, portable: false as const,
    runId: input.runId, productRuntimeSessionId: input.sessionId, requestKey: call.requestKey, epochKey: epoch.epochKey,
    actorKey: call.actorKey, viewerKey: input.viewerKey, admissionStateHash: call.admissionStateHash, visibilityHash: call.visibilityHash,
    runtimeSourceHash: call.runtimeSourceHash, inputManifestHash: call.inputManifestHash, rawResponseHash: call.responseArtifactHash!, artifact }
  const body = purpose === 'common-oracle-interpret' ? { schema: 'storyforge.ttrpg-open-common-oracle-candidate' as const, ...common,
    basisHash: call.commonOracle!.basisHash, oracleSourceRef: call.commonOracle!.oracleSourceRef,
    interpretation: oracleCandidate?.interpretation ?? null, facts: oracleCandidate?.facts ?? null }
    : purpose === 'entity-proposal' ? { schema: 'storyforge.ttrpg-open-entity-candidate' as const, ...common, selection: call.entityProposal!, proposals: entityProposals } : purpose === 'public-situation-proposal' ? { schema: 'storyforge.ttrpg-open-public-situation-candidate' as const, ...common, review: situation, references: publicReferences } : purpose === 'situation-proposal' ? { schema: 'storyforge.ttrpg-open-situation-candidate' as const, ...common, review: situation, references } : purpose === 'stage-brief' ? { schema: 'storyforge.ttrpg-open-brief-candidate' as const, ...common, brief, attributions } : purpose === 'kp-narration' ? { schema: 'storyforge.ttrpg-open-kp-candidate' as const, ...common, binding: call.narrationBinding!, narration } : purpose === 'intent' || purpose === 'companion' ? { schema: 'storyforge.ttrpg-open-intent-candidate' as const, ...common, intent }
    : { schema: 'storyforge.ttrpg-open-oracle-candidate' as const, ...common,
      oracleSourceRef: (oraclePacket as { sourceRef: TtrpgOpenOracleCandidateV1['oracleSourceRef'] }).sourceRef,
      interpretation: oracleCandidate?.interpretation ?? null, facts: oracleCandidate?.facts ?? null,
      ...(call.supportSlot ? { normalizationOf: { sourceRef: call.supportSlot.sourceRef,reviewHash: call.supportSlot.sourceHash } } : {}) }
  return { ...body, candidateHash: await hashCanonicalValue(body) }
}
