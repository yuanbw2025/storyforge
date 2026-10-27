/** One explicit S2 request. Exact raw output is durable before parsing.
 * Recovery materializes retained bytes only; it never obtains a send permit. */
import { readOwnedRows } from '../workspace/scope'
import type { AIConfig, ChatMessage, ContextManifestV2, WorkspaceScope } from '../types'
import type { AssembleContextResult } from '../registry/types'
import { assembleContext } from '../registry/assemble-context'
import { resolveRequestConfig, type ChatResult } from '../ai/client'
import { readBoundCodexReceiptV1, acknowledgeBoundCodexReceiptV1, CODEX_DURABLE_RECEIPT_RETENTION_V1,
  CODEX_REQUEST_HASH_ALGORITHM_V1, type CodexRequestRefV1, type CodexReceipt } from '../ai/codex-transport'
import { estimateTokens, trimMessagesToFit } from '../ai/context-budget'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { createAgentSkillExecutionBindingV2 } from '../agent/execution-binding'
import { executeFrozenFormalAIEntryV1, freezeFormalAIEntryBindingV1 } from '../agent/formal-ai-entry'
import { createAgentRunV1, readAgentRunV1, appendAgentRunEventV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { beginAgentRunRecoveryV1, completeAgentRunRecoveryV1, createAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { createContextManifestFromAssemblyV1, createContextManifestV2FromV1 } from '../agent/run/context-manifest'
import { hashCanonicalValue, canonicalStringify } from '../agent/run/hash'
import { runCreativeExecutionV1, createCreativeIssueV1, type CreativeRawModelResultV1 } from '../agent/creative-execution'
import { parseCreativeArtifactV1, type CreativeArtifactV1 } from '../agent/creative-reliability'
import { AgentTeamBudgetTracker } from '../agent/team-budget'
import { recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { executeContextGatewayV1, type ContextGatewayExecutionV1 } from '../context-gateway/execution'
import { recordContextGatewayPreflightEvidenceV1, finalizeContextGatewayAttemptEvidenceV1, readContextGatewayManifestV3ForAttemptV1,
  type ContextGatewayPreflightEvidenceV1 } from '../context-gateway/attempt-evidence'
import { resolveProductSourceReadBoundaryV1 } from '../product/source-contracts'
import { assertTtrpgOpenAuthoringDesignSourceCurrentV1, type TtrpgOpenAuthoringDesignSourceV1 } from './open-authoring-design-source'
import { parseTtrpgOpenAuthoringDesignRequestV1, parseTtrpgOpenAuthoringDesignProposalsV1,
  ttrpgOpenDesignNeedsInitialFactsV1, ttrpgOpenDesignProfileV1, ttrpgOpenDesignProfileForSkillV1, TTRPG_OPEN_DESIGN_PROFILES_V1,
  ttrpgOpenDesignRuleRefsV1, TTRPG_OPEN_DESIGN_PROMPT_VERSION_V2, TTRPG_OPEN_DESIGN_PROMPT_VERSION_V3,
  type TtrpgOpenAuthoringDesignRequestV1, type TtrpgOpenAuthoringDesignProposalsV1 } from './open-authoring-design-contract'
import { buildTtrpgOpenAuthoringDesignMessagesV1, renderTtrpgOpenDesignWorldReadsV1 } from './open-authoring-design-prompt'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { withTtrpgOpenDesignOwnerV1 } from './open-authoring-design-owner'

export const TTRPG_OPEN_DESIGN_STEP_V1 = 'ttrpg:open-authoring-design' as const
const CATEGORY = 'authoring.ttrpg-open-design'
const SOURCE = 'ttrpg.open.authoring-design', STEP = TTRPG_OPEN_DESIGN_STEP_V1
const EVIDENCE = 'storyforge.ttrpg-open-authoring-design-request-evidence'
const CANDIDATE = 'storyforge.ttrpg-open-authoring-design-candidate'
const TRANSPORT = 'storyforge.ttrpg-open-design-local-request'
const RESPONSE = 'storyforge.ttrpg-open-design-response-metadata'
const terminal = new Set(['completed', 'failed', 'cancelled'])
function fail(message: string): never { throw new Error(`[ttrpg-authoring-design] ${message}`) }

interface RequestEvidence {
  schema: typeof EVIDENCE; version: 1; source: TtrpgOpenAuthoringDesignSourceV1; request: TtrpgOpenAuthoringDesignRequestV1
  modelIdentity: { provider: string; model: string }; messages: ChatMessage[]; readResourceKeys: string[]; requestBindingHash: string
  preflight: ContextGatewayPreflightEvidenceV1; manifest: ContextManifestV2
  selector: ContextGatewayExecutionV1['selector']; sufficiency: ContextGatewayExecutionV1['sufficiency']
  retrievalTrace: ContextGatewayExecutionV1['retrievalTrace']; gatewayVersionHash: string; policyHash: string
}
interface LocalRequestEvidence {
  schema: typeof TRANSPORT; version: 1; portable: false; runId: number
  requestArtifactHash: string; requestBindingHash: string; request: CodexRequestRefV1
}
interface ResponseMetadata {
  schema: typeof RESPONSE; version: 1; rawResponseHash: string
  usage: CreativeRawModelResultV1['usage'] | null; durationMs: number | null
  localRequestHash?: string; transportStatus?: CodexReceipt['status']
  receiptMetadata?: Omit<CodexReceipt, 'text'>
}
function usesRuleRefs(skillId: string, promptVersion?: string): boolean {
  if ((promptVersion === TTRPG_OPEN_DESIGN_PROMPT_VERSION_V2 || promptVersion === TTRPG_OPEN_DESIGN_PROMPT_VERSION_V3)
    && ttrpgOpenDesignProfileForSkillV1(skillId)) return true
  if (skillId === TTRPG_OPEN_DESIGN_PROFILES_V1[0].skillId && promptVersion === 'ttrpg-open-authoring-design-v1') return false
  return fail('设计格式版本尚未支持；请保留原记录，不能发送或继续采用')
}
function frozenRuleRefs(snapshot: AgentRunSnapshotV1, evidence: RequestEvidence) {
  const binding = snapshot.contract.executionBindings?.find(item => item.stepId === STEP)
  if (binding?.version !== 2) fail('设计请求缺少原冻结 Skill')
  const definition = JSON.parse(binding.skillDefinitionJson) as { promptVersion?: string }
  return usesRuleRefs(binding.skillId, definition.promptVersion) ? ttrpgOpenDesignRuleRefsV1(evidence.source.rulePack) : undefined
}
export interface TtrpgOpenAuthoringDesignCandidateV1 {
  schema: typeof CANDIDATE; version: 1; portable: false; runId: number
  requestArtifactHash: string; rawResponseHash: string; sourceBasisHash: string
  proposals: TtrpgOpenAuthoringDesignProposalsV1 | null; artifact: CreativeArtifactV1; candidateHash: string
}
async function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: unknown) {
  return appendAgentRunEventV1({ scope, runId: snapshot.run.id, type, payload,
    expectedLastSequence: snapshot.projection.lastSequence } as Parameters<typeof appendAgentRunEventV1>[0])
}
function assertRun(snapshot: AgentRunSnapshotV1): void {
  const binding = snapshot.contract.executionBindings?.find(item => item.stepId === STEP)
  const profile = binding ? ttrpgOpenDesignProfileForSkillV1(binding.skillId) : undefined
  if (snapshot.run.productRuntimeSessionId != null || snapshot.run.productBuildId != null || binding?.version !== 2
    || !profile || binding.formalEntry?.entryId !== profile.entryId || snapshot.contract.executionBindings?.length !== 1) fail('不是当前作品的设计请求')
}
async function bindingHash(input: Pick<RequestEvidence, 'source' | 'request' | 'messages' | 'modelIdentity' | 'readResourceKeys'>) {
  return hashCanonicalValue({ sourceBasisHash: input.source.basisHash, request: input.request, messages: input.messages,
    modelIdentity: input.modelIdentity, readResourceKeys: input.readResourceKeys })
}
async function snapshotsWithSchema<T>(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, schema: string) {
  const found: { value: T; hash: string }[] = []
  for (const event of snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'source-snapshot' || event.payload.stepId !== STEP) continue
    const text = await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: 'source-snapshot', contentHash: event.payload.contentHash })
    let value: unknown
    try { value = JSON.parse(text) } catch { continue }
    if (value && typeof value === 'object' && 'schema' in value && value.schema === schema) found.push({ value: value as T, hash: event.payload.contentHash })
  }
  if (found.length > 1) fail('同一请求的精确证据出现冲突')
  return found[0] ?? null
}
async function frozen(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1) {
  assertRun(snapshot)
  const result = await snapshotsWithSchema<RequestEvidence>(scope, snapshot, EVIDENCE)
  if (!result || result.value.version !== 1 || result.value.requestBindingHash !== snapshot.contract.runtimeBindingHash
    || await bindingHash(result.value) !== result.value.requestBindingHash) fail('冻结请求证据不完整或已变化，不能重发')
  return result
}

async function verifyLocalRequest(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1,
  retained: { hash: string; value: RequestEvidence }, local: LocalRequestEvidence) {
  const ref = local?.request, evidence = retained.value
  if (local?.schema !== TRANSPORT || local.version !== 1 || local.portable !== false || local.runId !== snapshot.run.id
    || local.requestArtifactHash !== retained.hash || local.requestBindingHash !== evidence.requestBindingHash
    || canonicalStringify(scope) !== canonicalStringify(evidence.source.scope)
    || snapshot.events.some(event => (event.type === 'run.cancelled' && event.payload.reason === 'project-import-nonportable-checkpoint')
      || (event.type === 'verification.staled' && event.payload.reason === 'project-import-scope-rebound'))
    || evidence.modelIdentity.provider !== 'codex' || ref?.model !== evidence.modelIdentity.model
    || ref?.version !== 1 || ref.provider !== 'codex' || Object.keys(ref).length !== 6
    || !/^[a-f0-9-]{36}$/i.test(ref.requestId) || ref.requestHashAlgorithm !== CODEX_REQUEST_HASH_ALGORITHM_V1
    || !/^[a-f0-9]{64}$/.test(ref.requestHash)
    || !snapshot.events.some(event => event.type === 'model.requested' && event.payload.bindingHash === evidence.requestBindingHash)
    || await sha256Text(JSON.stringify({ id: ref.requestId, model: ref.model, messages: evidence.messages,
      receiptRetention: CODEX_DURABLE_RECEIPT_RETENTION_V1 })) !== ref.requestHash) {
    fail('原本机引用与冻结请求、作品或发送记录不一致；不能关联服务记录或重发')
  }
}

const HANDOFF = 'storyforge.ttrpg-open-design-local-handoff'
async function handoff(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, request: CodexRequestRefV1, rawResponseHash: string) {
  const saved = await snapshotsWithSchema<{ requestHash: string; rawResponseHash: string }>(scope, snapshot, HANDOFF)
  if (saved) {
    if (saved.value.requestHash !== request.requestHash || saved.value.rawResponseHash !== rawResponseHash) fail('原回执交接记录不一致')
    return snapshot
  }
  // The owner already holds exact raw and metadata. A failed retention handoff
  // leaves the native copy protected and visible for an explicit later action.
  let receipt: Awaited<ReturnType<typeof acknowledgeBoundCodexReceiptV1>>
  try { receipt = await acknowledgeBoundCodexReceiptV1({ request, rawResponseHash, confirmation: 'owner-record-saved-v1' }) }
  catch { return snapshot }
  if (terminal.has(snapshot.run.status)) return snapshot
  return (await recordAgentRunArtifactV1({ scope, runId: snapshot.run.id, stepId: STEP, attempt: 1, artifactKind: 'source-snapshot',
    content: JSON.stringify({ schema: HANDOFF, version: 1, portable: false, runId: snapshot.run.id,
      requestHash: request.requestHash, rawResponseHash, receipt }), expectedLastSequence: snapshot.projection.lastSequence })).snapshot
}

/** Explicit original-ID lookup only. No inference POST, new Run, credential,
 * source read, author adoption or legacy hash-based association is performed. */
export async function recoverTtrpgOpenDesignOriginalReceiptV1(input: { scope: WorkspaceScope; runId: number }) {
  return withTtrpgOpenDesignOwnerV1(input.scope, async () => {
    let snapshot = await readAgentRunV1(input.scope, input.runId)
    const retained = await frozen(input.scope, snapshot)
    const local = await snapshotsWithSchema<LocalRequestEvidence>(input.scope, snapshot, TRANSPORT)
    if (!local) {
      // Existing non-Codex/legacy saved raw still uses its original local path.
      // Missing raw must never invent a pre-dispatch binding for an old Run.
      return { status: 'local' as const, candidate: await materialize(input), handoffPending: false }
    }
    await verifyLocalRequest(input.scope, snapshot, retained, local.value)
    if (typeof window !== 'undefined' && !navigator.locks?.request) fail('当前浏览器不能确认其他页面是否仍在执行，请使用支持安全恢复的本机浏览器；原记录保留')
    const ref = local.value.request
    const raw = snapshot.events.find(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response' && event.payload.stepId === STEP)
    const metadata = await snapshotsWithSchema<ResponseMetadata>(input.scope, snapshot, RESPONSE)
    if (raw?.type === 'evidence.artifact.recorded' && metadata?.value.transportStatus === 'completed') {
      // Owner storage survives native retention release/pruning. No remote read
      // is necessary to reconstruct an already-saved successful answer.
      const candidate = await materialize(input)
      snapshot = await readAgentRunV1(input.scope, input.runId)
      snapshot = await handoff(input.scope, snapshot, ref, candidate.rawResponseHash)
      return { status: 'completed' as const, candidate, handoffPending: !await snapshotsWithSchema(input.scope, snapshot, HANDOFF) }
    }
    if (terminal.has(snapshot.run.status)) fail('原请求已经结束，保留历史记录，不能重新领取服务结果')
    const receipt = await readBoundCodexReceiptV1(ref)
    if (receipt.receiptRetention !== CODEX_DURABLE_RECEIPT_RETENTION_V1) fail('原本机回执没有约定的作品交接保留策略')
    if (receipt.status === 'accepted' || receipt.status === 'running') return { status: receipt.status, candidate: null, handoffPending: true }
    if (receipt.status === 'completed' && (!receipt.dispatched || !receipt.text.trim())) fail('原本机完成回执不包含有效完整回答')
    if (snapshot.run.status === 'paused' || snapshot.run.status === 'recovering') {
      const recovery = await beginAgentRunRecoveryV1({ ...input, expectedLastSequence: snapshot.projection.lastSequence })
      snapshot = await completeAgentRunRecoveryV1({ ...input, checkpointHash: recovery.checkpointHash,
        expectedLastSequence: recovery.snapshot.projection.lastSequence })
    }
    if (snapshot.run.status !== 'running') fail('原请求当前不能领取回执，请保留记录核对')
    const rawHash = await sha256Text(receipt.text)
    if (raw?.type === 'evidence.artifact.recorded' && raw.payload.contentHash !== rawHash) fail('服务回执与作品原始回答冲突，不能追加第二份回答')
    if (metadata && (metadata.value.rawResponseHash !== rawHash || metadata.value.transportStatus !== receipt.status
      || metadata.value.localRequestHash !== ref.requestHash)) fail('服务回执与作品已保存的回答元数据冲突')
    // Store terminal status before raw so an interrupted unknown/failed partial
    // response can never be mistaken for a complete local answer.
    const { text: _text, ...receiptMetadata } = receipt
    if (!metadata) snapshot = (await recordAgentRunArtifactV1({ ...input, stepId: STEP, attempt: 1, artifactKind: 'source-snapshot',
      content: JSON.stringify({ schema: RESPONSE, version: 1, rawResponseHash: rawHash, usage: receipt.usage ?? null,
        durationMs: null, localRequestHash: ref.requestHash, transportStatus: receipt.status, receiptMetadata }), expectedLastSequence: snapshot.projection.lastSequence })).snapshot
    snapshot = (await recordAgentRunArtifactV1({ ...input, stepId: STEP, attempt: 1, artifactKind: 'raw-response',
      content: receipt.text, expectedLastSequence: snapshot.projection.lastSequence })).snapshot
    snapshot = await handoff(input.scope, snapshot, ref, rawHash)
    const handoffPending = !await snapshotsWithSchema(input.scope, snapshot, HANDOFF)
    if (receipt.status !== 'completed') {
      snapshot = await append(input.scope, snapshot, receipt.status === 'unknown' ? 'run.paused' : 'run.failed', receipt.status === 'unknown'
        ? { reason: '原本机请求结果未知，部分回答已保留；不能生成候选或重发', recoverable: true }
        : { code: `ttrpg-design-local-${receipt.status}-no-retry`, retryable: false })
      return { status: receipt.status, candidate: null, handoffPending }
    }
    return { status: receipt.status, candidate: await materialize(input), handoffPending }
  })
}

/** All Work-owned requests remain in the existing Run lifecycle, including
 * orphaned planned requests. No parallel conversation store or silent discard. */
export async function listTtrpgOpenAuthoringDesignRunsV1(scope: WorkspaceScope) {
  const rows = await readOwnedRows<AgentRunSnapshotV1['run']>(scope, 'agentRuns', { owner: 'work' })
  return rows.filter(row => {
    if (!TTRPG_OPEN_DESIGN_PROFILES_V1.some(profile => row.contractJson.includes(profile.skillId))) return false
    let contract: { executionBindings?: { stepId?: string; skillId?: string }[] }
    try { contract = JSON.parse(row.contractJson) }
    catch { fail('设计运行合同损坏，请先检查原记录；未创建第二条会谈数据') }
    return Array.isArray(contract.executionBindings) && contract.executionBindings.some(binding => binding.stepId === STEP
      && typeof binding.skillId === 'string' && !!ttrpgOpenDesignProfileForSkillV1(binding.skillId))
  }).sort((a, b) => b.id - a.id)
}
async function assertFirstPending(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1) {
  const older = (await listTtrpgOpenAuthoringDesignRunsV1(scope)).filter(row => row.id < snapshot.run.id)
  // IDs are allocated by the same native IndexedDB store. A later request
  // cannot win while an earlier request remains live or finished after it began.
  if (older.some(row => !terminal.has(row.status) || row.updatedAt >= snapshot.run.createdAt)) fail('另一份设计请求尚待处理或与本次重叠，请先查看原请求')
}

export async function generateTtrpgOpenAuthoringDesignCandidateV1(input: {
  scope: WorkspaceScope; revision: number; request: unknown; aiConfig?: AIConfig; signal?: AbortSignal
  runAI?: (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>
  onPrepared?: (runId: number) => void
}): Promise<TtrpgOpenAuthoringDesignCandidateV1> {
  return withTtrpgOpenDesignOwnerV1(input.scope, () => generateOwned(input))
}
async function generateOwned(input: Parameters<typeof generateTtrpgOpenAuthoringDesignCandidateV1>[0]): Promise<TtrpgOpenAuthoringDesignCandidateV1> {
  const request = parseTtrpgOpenAuthoringDesignRequestV1(input.request), profile = ttrpgOpenDesignProfileV1(request.sections)
  const skill = getAgentSkillV1(profile.skillId), outputBudget = profile.maxOutputTokens
  if (outputBudget !== skill.maxOutputTokens) fail('登记的设计容量与本次分区不一致；尚未发送请求')
  usesRuleRefs(skill.id, skill.promptVersion)
  if (!input.runAI && !input.aiConfig) fail('请先配置现有 AI 连接')
  const basisAssembly = await assembleContext({ projectId: input.scope.projectId, scope: input.scope,
    sourceKeys: [SOURCE], ttrpgAuthoringDesignRevision: input.revision, inputBudgetTokens: 24_000 })
  if (basisAssembly.included.length !== 1 || basisAssembly.trimmed.length || basisAssembly.overBudgetAfterTrim) fail('作者来源未能完整交付')
  const source = JSON.parse(basisAssembly.segments[0].content) as TtrpgOpenAuthoringDesignSourceV1
  if (ttrpgOpenDesignNeedsInitialFactsV1(source.settings.openAuthoring) && request.sections.includes('situationTemplates') && !request.sections.includes('factProposals'))
    fail('空白作品的局势需要事实来源，请同时选择“新增世界事实”；生成后仍需本人逐条核对，尚未发送请求')
  const boundary = await resolveProductSourceReadBoundaryV1(source.sourcePlan), selected = new Set(source.sourceSelection.resourceKeys)
  const allowedResourceKeys = boundary.allowedResourceKeys.filter(key => selected.has(key))
  const retained = [...source.settings.openAuthoring.situationTemplates, ...source.settings.openAuthoring.pressure.clocks,
    ...source.settings.openAuthoring.pressure.fronts].flatMap(item => item.sourceRefs)
  retained.push(...source.settings.openAuthoring.factPolicy.flatMap(item => item.fact.sourceResourceRefs))
  const mandatoryResourceKeys = [...new Set([...boundary.mandatoryResourceKeys, ...retained])]
  if (mandatoryResourceKeys.some(key => !allowedResourceKeys.includes(key))) fail('已选出口缺少必读或保留设计来源；请明确修改出口范围')
  const gateway = await executeContextGatewayV1({ skill, scope: input.scope, resourceScope: boundary.sourceScope,
    accessPolicyOverride: source.sourcePlan.gatewayPolicy, allowedResourceKeys, mandatoryResourceKeys,
    mandatoryFullResourceKeys: [...new Set([...boundary.mandatoryFullResourceKeys, ...retained])],
    targetResourceKeys: boundary.targetResourceKeys.filter(key => selected.has(key)),
    query: request.instruction, budgetTokens: 20_000, additionalReadsEnabled: false, signal: input.signal })
  const readResourceKeys = [...new Set(gateway.sourceSnapshots.filter(item => item.sourceKey === 'worldRelease')
    .map(item => item.resourceKey).filter((key): key is string => !!key))].sort()
  if (!readResourceKeys.length || readResourceKeys.some(key => !selected.has(key))) fail('世界实际读取未满足已选出口范围')
  const worldText = await renderTtrpgOpenDesignWorldReadsV1(gateway), worldTokens = estimateTokens(worldText)
  const messages = buildTtrpgOpenAuthoringDesignMessagesV1({ request, authorContext: basisAssembly.text,
    worldContext: worldText, readResourceKeys, ruleRefs: ttrpgOpenDesignRuleRefsV1(source.rulePack) })
  const requestTokens = messages.reduce((sum, item) => sum + estimateTokens(item.content), 0)
  if (requestTokens > 64_000) fail('完整请求超过本次输入预算，请缩小设计分区或来源；未发起模型请求')
  const meta = { category: CATEGORY, projectId: input.scope.projectId, contextOverflowPolicy: 'reject' as const, configOverrides: { maxTokens: outputBudget } }
  const resolved = input.aiConfig ? resolveRequestConfig(input.aiConfig, meta) : null
  if (!input.runAI && resolved) {
    // Assert with the same pure request-side budget calculation as the original
    // client. Never pass the returned trimmed copy to the model. A known local
    // capacity failure must not create an apparently unknown dispatched Run.
    const config = resolved.config
    const fit = trimMessagesToFit(messages, config.provider, config.model, config.maxTokens, config.contextWindow)
    if (fit.trimmed || !fit.protectedEnvelopePreserved || requestTokens > fit.inputBudget)
      fail(`当前连接输入预算不足以容纳完整设计请求（原始约 ${requestTokens} / 可用 ${fit.inputBudget} tokens）。请在通用设置核对上下文窗口，或明确调整读取范围与分区；尚未发送请求`)
  }
  const modelIdentity = input.runAI ? { provider: 'test-adapter', model: 'injected' }
    : { provider: resolved!.config.provider, model: resolved!.config.model }
  const requestBindingHash = await bindingHash({ source, request, messages, modelIdentity, readResourceKeys })
  const binding = { stepId: STEP, ...await createAgentSkillExecutionBindingV2(skill, {
    writeTargets: [{ table: 'ttrpgAuthoringDrafts', fields: ['settingsJson'], mode: 'author-confirmed' }],
  }), formalEntry: await freezeFormalAIEntryBindingV1(profile.entryId) }
  await assertTtrpgOpenAuthoringDesignSourceCurrentV1(source)
  let snapshot = await createAgentRunV1({ scope: input.scope, worldGroupId: null, contract: {
    version: 3, executionBoundary: 'formal', objective: request.instruction.slice(0, 4000), workflowKind: 'direct-generation',
    scope: { projectId: input.scope.projectId, worldGroupId: null }, executionBindings: [binding], runtimeBindingHash: requestBindingHash,
    permissions: { contextSourceKeys: [...binding.contextSourceKeys], writeTargets: [...binding.writeTargets] },
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 64_000, maxOutputTokens: outputBudget, maxAttemptsPerStep: 1 },
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
    acceptance: ['design.candidate-valid', 'design.source-current', 'design.author-adopted'].map(id => ({ id, kind: 'deterministic-check' as const, required: true })),
    verificationPlan: [{ id: 'design.terminal', kind: 'terminal', verifier: 'ttrpg-open-authoring-design-adoption-v1',
      criterionIds: ['design.candidate-valid', 'design.source-current', 'design.author-adopted'] }],
  } })
  let transportResult: ChatResult | undefined
  try {
    input.onPrepared?.(snapshot.run.id)
    await assertFirstPending(input.scope, snapshot)
    snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: STEP })
    snapshot = await append(input.scope, snapshot, 'step.started', { stepId: STEP, attempt: 1 })
    const assembled: AssembleContextResult = { ...basisAssembly, text: `${basisAssembly.text}\n\n${worldText}`,
      segments: [...basisAssembly.segments, { label: 'worldRelease', layer: 'L0', content: worldText, tokens: worldTokens, trimmable: false }],
      included: [SOURCE, 'worldRelease'], totalInputTokens: basisAssembly.totalInputTokens + worldTokens, inputBudget: 64_000,
      sourceEvidence: [...basisAssembly.sourceEvidence!, { key: 'worldRelease', status: 'included', delivery: 'full', sourceHash: await sha256Text(worldText),
        originalCharacters: worldText.length, inputCharacters: worldText.length, originalTokens: worldTokens, inputTokens: worldTokens }] }
    const manifestV1 = await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId: STEP, attempt: 1,
      projectId: input.scope.projectId, worldGroupId: null, declaredSourceKeys: [...binding.contextSourceKeys], assembled, readerVersion: TTRPG_OPEN_DESIGN_PROMPT_VERSION_V3 })
    const manifest = await createContextManifestV2FromV1({ manifest: manifestV1, scope: input.scope })
    const preflight = await recordContextGatewayPreflightEvidenceV1({ scope: input.scope, runId: snapshot.run.id, stepId: STEP, attempt: 1,
      contextPacket: gateway.contextPacket, selector: gateway.selector, renderedRequest: { messages, modelIdentity },
      sourceSnapshots: [...gateway.sourceSnapshots, { sourceKey: SOURCE, content: source }], toolTranscript: gateway.toolTranscript,
      expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = preflight.snapshot
    const evidence: RequestEvidence = { schema: EVIDENCE, version: 1, source, request, modelIdentity, messages, readResourceKeys, requestBindingHash,
      manifest, preflight: preflight.evidence, selector: gateway.selector, sufficiency: gateway.sufficiency, retrievalTrace: gateway.retrievalTrace,
      gatewayVersionHash: gateway.contextPacket.gatewayVersionHash, policyHash: gateway.contextPacket.policyHash }
    const recordedRequest = await recordAgentRunArtifactV1({ scope: input.scope, runId: snapshot.run.id, stepId: STEP, attempt: 1,
      artifactKind: 'source-snapshot', content: JSON.stringify(evidence), expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = recordedRequest.snapshot
    snapshot = (await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id,
      resumePayload: { schema: 'storyforge.ttrpg-open-design-prepared-checkpoint', version: 1, portable: false, requestArtifactHash: recordedRequest.artifact.contentHash },
      expectedLastSequence: snapshot.projection.lastSequence })).snapshot
    await assertTtrpgOpenAuthoringDesignSourceCurrentV1(source)
    if (input.signal?.aborted) throw input.signal.reason ?? new Error('请求已取消，尚未发送')
    await assertFirstPending(input.scope, snapshot)
    snapshot = await append(input.scope, snapshot, 'model.requested', { stepId: STEP, attempt: 1, bindingHash: requestBindingHash })
    const result: ChatResult = {}, started = Date.now()
    transportResult = result
    if (!input.runAI && modelIdentity.provider === 'codex') result.onCodexRequestPrepared = async request => {
      const value: LocalRequestEvidence = { schema: TRANSPORT, version: 1, portable: false, runId: snapshot.run.id,
        requestArtifactHash: recordedRequest.artifact.contentHash, requestBindingHash, request: { ...request } }
      await verifyLocalRequest(input.scope, snapshot, { hash: recordedRequest.artifact.contentHash, value: evidence }, value)
      snapshot = (await recordAgentRunArtifactV1({ scope: input.scope, runId: snapshot.run.id, stepId: STEP, attempt: 1,
        artifactKind: 'source-snapshot', content: JSON.stringify(value), expectedLastSequence: snapshot.projection.lastSequence })).snapshot
    }
    const output = input.runAI ? await input.runAI(messages, input.signal)
      : profile.entryId === 'ttrpg.open.authoring-design.full'
        ? await executeFrozenFormalAIEntryV1('ttrpg.open.authoring-design.full', binding.formalEntry, skill, 'src/lib/ttrpg/open-authoring-design-harness.ts',
          messages, input.aiConfig!, { ...meta, category: 'authoring.ttrpg-open-design' }, input.signal, result, undefined, resolved!)
        : await executeFrozenFormalAIEntryV1('ttrpg.open.authoring-design', binding.formalEntry, skill, 'src/lib/ttrpg/open-authoring-design-harness.ts',
          messages, input.aiConfig!, { ...meta, category: 'authoring.ttrpg-open-design' }, input.signal, result, undefined, resolved!)
    const raw = await recordAgentRunArtifactV1({ scope: input.scope, runId: snapshot.run.id, stepId: STEP, attempt: 1,
      artifactKind: 'raw-response', content: output, expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = raw.snapshot
    snapshot = (await recordAgentRunArtifactV1({ scope: input.scope, runId: snapshot.run.id, stepId: STEP, attempt: 1,
      artifactKind: 'source-snapshot', content: JSON.stringify({ schema: RESPONSE, version: 1,
        rawResponseHash: raw.artifact.contentHash, usage: result.usage ?? null, durationMs: Math.max(0, Date.now() - started),
        ...(result.localCodexRequest ? { localRequestHash: result.localCodexRequest.requestHash, transportStatus: 'completed' } : {}) }),
      expectedLastSequence: snapshot.projection.lastSequence })).snapshot
    if (result.localCodexRequest) snapshot = await handoff(input.scope, snapshot, result.localCodexRequest, raw.artifact.contentHash)
    snapshot = await append(input.scope, snapshot, 'model.responded', { stepId: STEP, attempt: 1, outputHash: raw.artifact.contentHash })
    return await materialize({ scope: input.scope, runId: snapshot.run.id })
  } catch (error) {
    // No transport retry. A durable requested marker is conservative even if a
    // provider cannot report its transport phase; only explicit review can close it.
    try {
      snapshot = await readAgentRunV1(input.scope, snapshot.run.id)
      if (!terminal.has(snapshot.run.status) && snapshot.run.status !== 'paused' && snapshot.run.status !== 'awaiting_confirmation') {
        const sent = snapshot.events.some(event => event.type === 'model.requested')
        const status = transportResult?.requestLifecycle?.responseStatus
        const denied = status != null && status >= 400 && status < 500 && status !== 408
        const knownUnsent = transportResult?.requestLifecycle?.phase === 'pre-dispatch'
        await append(input.scope, snapshot, sent && !denied && !knownUnsent ? 'run.paused' : 'run.failed', sent && !denied && !knownUnsent
          ? { reason: '设计请求结果待核对；保留原请求和回答，不能自动重发', recoverable: true }
          : { code: denied ? `ttrpg-design-http-${status}-no-retry` : 'ttrpg-design-pre-dispatch-failed', retryable: false })
      }
    } catch { /* Keep the original failure and durable events. */ }
    throw error
  }
}

/** Materialization uses the original raw bytes as the original logical call;
 * runCreativeExecution performs parsing/artifact construction, with no transport. */
export async function recoverTtrpgOpenAuthoringDesignCandidateV1(input: { scope: WorkspaceScope; runId: number }): Promise<TtrpgOpenAuthoringDesignCandidateV1> {
  return withTtrpgOpenDesignOwnerV1(input.scope, () => materialize(input))
}
async function materialize(input: { scope: WorkspaceScope; runId: number }): Promise<TtrpgOpenAuthoringDesignCandidateV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const retained = await frozen(input.scope, snapshot), evidence = retained.value
  const metadata = await snapshotsWithSchema<ResponseMetadata>(input.scope, snapshot, RESPONSE)
  const local = await snapshotsWithSchema<LocalRequestEvidence>(input.scope, snapshot, TRANSPORT)
  if (local) {
    await verifyLocalRequest(input.scope, snapshot, retained, local.value)
    if (!metadata || metadata.value.localRequestHash !== local.value.request.requestHash || metadata.value.transportStatus !== 'completed')
      fail('原本机请求尚无完整成功回执；请明确读取原服务记录，结果未知或部分回答不能成为候选')
  }
  const rawEvents = snapshot.events.filter(event => event.type === 'evidence.artifact.recorded'
    && event.payload.artifactKind === 'raw-response' && event.payload.stepId === STEP && event.payload.attempt === 1)
  if (rawEvents.length !== 1 || rawEvents[0].type !== 'evidence.artifact.recorded') fail('没有唯一已保存回答；恢复不会发起模型请求')
  const rawHash = rawEvents[0].payload.contentHash
  const output = await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'raw-response', contentHash: rawHash })
  if (!snapshot.events.some(event => event.type === 'model.requested' && event.payload.bindingHash === evidence.requestBindingHash)) fail('原回答缺少实际请求事件')
  const existing = await snapshotsWithSchema<TtrpgOpenAuthoringDesignCandidateV1>(input.scope, snapshot, CANDIDATE)
  if (existing && snapshot.events.some(event => event.type === 'candidate.persisted')) {
    const { candidateHash, ...body } = existing.value
    if (candidateHash !== await hashCanonicalValue(body) || body.runId !== input.runId || body.rawResponseHash !== rawHash
      || body.requestArtifactHash !== retained.hash || body.sourceBasisHash !== evidence.source.basisHash
      || snapshot.projection.steps[STEP]?.candidateHash !== candidateHash || snapshot.projection.steps[STEP]?.status === 'stale') fail('设计候选与原请求/回答不一致或已过期')
    const manifest = await readContextGatewayManifestV3ForAttemptV1({ ...input, stepId: STEP, attempt: 1 })
    if (manifest.manifest.candidate.candidateHash !== candidateHash) fail('设计候选缺少相同来源回执')
    const persistedIndex = snapshot.events.findIndex(event => event.type === 'candidate.persisted')
    if (!snapshot.events.slice(persistedIndex + 1).some(event => event.type === 'checkpoint.created')) {
      await createAgentRunCheckpointV1({ ...input, resumePayload: { schema: 'storyforge.ttrpg-open-design-checkpoint', version: 1, portable: false,
        requestArtifactHash: retained.hash, candidateHash }, expectedLastSequence: snapshot.projection.lastSequence })
    }
    return { ...body, artifact: parseCreativeArtifactV1(body.artifact), candidateHash }
  }
  if (snapshot.run.status === 'paused' || snapshot.run.status === 'recovering') {
    const recovery = await beginAgentRunRecoveryV1({ ...input, expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = await completeAgentRunRecoveryV1({ ...input, checkpointHash: recovery.checkpointHash,
      expectedLastSequence: recovery.snapshot.projection.lastSequence })
  }
  if (snapshot.run.status !== 'running') fail('原请求当前不可解析；保留原记录，不能重发')
  if (!snapshot.events.some(event => event.type === 'model.responded')) snapshot = await append(input.scope, snapshot, 'model.responded', { stepId: STEP, attempt: 1, outputHash: rawHash })
  if (metadata && metadata.value.rawResponseHash !== rawHash) fail('回答用量记录不属于原回答')
  const usage = metadata?.value.usage
  const invalidUsage = !!usage && (![usage.inputTokens, usage.outputTokens, usage.totalTokens].every(value => Number.isSafeInteger(value) && value >= 0)
    || usage.inputTokens + usage.outputTokens !== usage.totalTokens)
  const inputTokens = usage && !invalidUsage ? usage.inputTokens : evidence.messages.reduce((sum, item) => sum + estimateTokens(item.content), 0)
  const outputTokens = usage && !invalidUsage ? usage.outputTokens : estimateTokens(output)
  const overBudget = inputTokens > snapshot.contract.budget.maxInputTokens || outputTokens > snapshot.contract.budget.maxOutputTokens
  const context = { request: evidence.request, base: evidence.source.settings.openAuthoring, readWorldResourceKeys: evidence.readResourceKeys,
    ruleRefs: frozenRuleRefs(snapshot, evidence) }
  const creative = await runCreativeExecutionV1<TtrpgOpenAuthoringDesignProposalsV1 | null>({ initialMessages: evidence.messages,
    runRaw: async () => ({ output, ...(usage && !invalidUsage ? { usage } : {}), durationMs: metadata?.value.durationMs ?? 0 }),
    parse: raw => {
      try {
        if (invalidUsage || overBudget) fail(invalidUsage ? '原回答的 provider 用量不合法，请核对原记录' : '原回答超过本次冻结输入或输出预算，不能继续采纳')
        const proposals = parseTtrpgOpenAuthoringDesignProposalsV1(raw, context)
        return { status: 'ready', output: proposals, editableText: JSON.stringify(proposals), validFragments: [], rejectedFragments: [], issues: [], assumptions: [] }
      } catch (error) { return { status: 'blocked', output: null, editableText: '', validFragments: [], rejectedFragments: [], assumptions: [],
        issues: [createCreativeIssueV1({ code: invalidUsage || overBudget ? 'ttrpg-design-budget' : 'ttrpg-design-protocol', path: '$', message: error instanceof Error ? error.message : String(error), disposition: 'blocking', action: 'edit' })] } }
    }, buildRepairMessages: () => fail('本次请求不授权自动修复'), budget: new AgentTeamBudgetTracker('expanded'), callLabel: '原设计回答解析',
    maxOutputTokens: snapshot.contract.budget.maxOutputTokens, qualityMode: 'economy', modelIdentity: evidence.modelIdentity, canonEvidenceRefs: [`source-plan:${evidence.source.sourcePlan.planHash}`] })
  if (!metadata || metadata.value.durationMs == null) creative.artifact.callEvidence[0].latencyMs = null
  const body: Omit<TtrpgOpenAuthoringDesignCandidateV1, 'candidateHash'> = { schema: CANDIDATE, version: 1, portable: false, runId: input.runId, requestArtifactHash: retained.hash,
    rawResponseHash: rawHash, sourceBasisHash: evidence.source.basisHash, proposals: creative.output, artifact: creative.artifact }
  const candidate: TtrpgOpenAuthoringDesignCandidateV1 = { ...body, candidateHash: await hashCanonicalValue(body) }
  if (existing && existing.value.candidateHash !== candidate.candidateHash) fail('原候选与恢复解析冲突')
  if (!existing) snapshot = (await recordAgentRunArtifactV1({ scope: input.scope, runId: input.runId, stepId: STEP, attempt: 1,
    artifactKind: 'source-snapshot', content: JSON.stringify(candidate), expectedLastSequence: snapshot.projection.lastSequence })).snapshot
  if (!snapshot.events.some(event => event.type === 'context.assembled')) snapshot = (await finalizeContextGatewayAttemptEvidenceV1({ ...input,
    stepId: STEP, attempt: 1, baseManifest: evidence.manifest, preflight: evidence.preflight, selector: evidence.selector,
    sufficiency: evidence.sufficiency, retrievalTrace: evidence.retrievalTrace, gatewayVersionHash: evidence.gatewayVersionHash,
    policyHash: evidence.policyHash, rawResponse: output, candidateHash: candidate.candidateHash, expectedLastSequence: snapshot.projection.lastSequence })).snapshot
  else if ((await readContextGatewayManifestV3ForAttemptV1({ ...input, stepId: STEP, attempt: 1 })).manifest.candidate.candidateHash !== candidate.candidateHash) {
    fail('恢复候选与原来源回执不一致')
  }
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', { stepId: STEP, attempt: 1, candidateHash: candidate.candidateHash, requiresConfirmation: true })
  await createAgentRunCheckpointV1({ ...input, resumePayload: { schema: 'storyforge.ttrpg-open-design-checkpoint', version: 1, portable: false,
    requestArtifactHash: retained.hash, candidateHash: candidate.candidateHash }, expectedLastSequence: snapshot.projection.lastSequence })
  return candidate
}

/** Read the original comparison basis; a later author save never silently
 * substitutes a new base under an earlier set of proposals. */
export async function readTtrpgOpenAuthoringDesignReviewV1(input: { scope: WorkspaceScope; runId: number }) {
  // Two concurrent confirmations may read the same already-persisted candidate.
  // The adoption transaction owns their CAS; a read must not seize an execution
  // owner or reject the second identical confirmation as an active generation.
  const candidate = await materialize(input)
  const snapshot = await readAgentRunV1(input.scope, input.runId), evidence = (await frozen(input.scope, snapshot)).value
  const local = await snapshotsWithSchema<LocalRequestEvidence>(input.scope, snapshot, TRANSPORT)
  const handoffPending = !!local && !await snapshotsWithSchema(input.scope, snapshot, HANDOFF)
  let current = true, staleReason = ''
  try { await assertTtrpgOpenAuthoringDesignSourceCurrentV1(evidence.source) }
  catch (error) { current = false; staleReason = error instanceof Error ? error.message : String(error) }
  return { candidate, source: evidence.source, request: evidence.request, readWorldResourceKeys: evidence.readResourceKeys,
    runStatus: snapshot.run.status, current, staleReason, handoffPending, maxOutputTokens: snapshot.contract.budget.maxOutputTokens, ruleRefs: frozenRuleRefs(snapshot, evidence),
    adoptionAllowed: snapshot.contract.executionBindings?.some(binding => binding.stepId === STEP && binding.version === 2
      && binding.writeTargets.some(target => target.table === 'ttrpgAuthoringDrafts' && target.mode === 'author-confirmed' && target.fields.includes('settingsJson'))
      && binding.formalEntry && JSON.parse(binding.formalEntry.bindingJson).adoptAllowed === true) === true }
}
