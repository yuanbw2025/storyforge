import { chat } from '../../ai/client'
import { estimateTokens } from '../../ai/context-budget'
import {
  buildCodexExtractPromptFromRegisteredContextV1,
  buildCodexEnrichPromptFromRegisteredContextV1,
  parseCodexEntriesStrictV1,
  readCodexExtractPromptTemplateSnapshotV1,
  readCodexEnrichPromptTemplateSnapshotV1,
  type ExtractedCodexEntry,
} from '../../ai/adapters/structured-extract-adapter'
import { splitExtractionText } from '../../ai/structured-extraction'
import type { AIConfig, ChatMessage, WorkspaceScope } from '../../types'
import { parseFieldSchema } from '../../types/codex'
import { db } from '../../db/schema'
import { assembleContext } from '../../registry/assemble-context'
import { adopt } from '../../registry/adopt'
import type { AssembleContextResult, ContextPacketV1 } from '../../registry/types'
import { readOwnedRows, scopeTransactionTables } from '../../workspace/scope'
import {
  formatCodexExtractionBaselineV1,
  readCodexExtractionBaselineV1,
  type CodexExtractionBaselineV1,
  type CodexExtractionEntryV1,
} from '../../codex/extraction'
import { getAgentSkillV1 } from '../skill-registry'
import { assembleContextGatewayPacketV1 } from '../context-gateway-input'
import { createAgentSkillExecutionBindingV1 } from '../execution-binding'
import { executeContextGatewayV1 } from '../../context-gateway/execution'
import { isPortableResourceUidV1 } from '../../context-gateway/resource-uid'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  staleAgentRunVerificationV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from './checkpoint'
import { createVerificationReceiptV1 } from './verification-receipt'
import { canonicalStringify, hashCanonicalValue } from './hash'

export const CODEX_EXTRACTION_STEP_ID_V1 = 'world-origin:codex-extract' as const
export const CODEX_EXTRACTION_VERIFIER_SET_V1 = 'codex-extraction-terminal-v1' as const
const MAX_MODEL_CALLS = 64
const MAX_CANDIDATES = 200

type RunAI = (messages: ChatMessage[], callIndex: number) => Promise<string>

export interface CodexExtractionRequestV1 {
  categoryId: number
  worldGroupId: number | null
  sourceText: string
  supplementTags: boolean
  operation?: 'extract' | 'enrich'
  authorRequest?: string
}

interface NormalizedCodexCandidateRequestV1 extends CodexExtractionRequestV1 {
  operation: 'extract' | 'enrich'
  authorRequest: string
}

interface CodexExtractionChunkV1 {
  callIndex: number
  chunkIndex: number
  chunkCount: number
  chunkHash: string
}

interface CodexExtractionPlanV1 {
  version: 1
  kind: 'codex-extraction-plan'
  portable: false
  runId: number
  projectId: number
  worldId: number
  workId: number
  request: NormalizedCodexCandidateRequestV1
  promptTemplateHash: string
  baselineContextManifestHash: string
  baselineContextHash: string
  sourceContextManifestHash: string
  sourceContextHash: string
  sourceTextHash: string
  gatewaySelectorHash: string
  gatewayTraceHash: string
  gatewayPacket: ContextPacketV1
  baseline: CodexExtractionBaselineV1
  baselineHash: string
  chunks: CodexExtractionChunkV1[]
  planHash: string
}

interface CodexExtractionCallEvidenceV1 {
  callIndex: number
  promptInputHash: string
  outputHash: string
  discoveredHash: string
}

interface CodexExtractionProgressV1 {
  version: 1
  kind: 'codex-extraction-progress'
  portable: false
  plan: CodexExtractionPlanV1
  nextCallIndex: number
  found: ExtractedCodexEntry[]
  calls: CodexExtractionCallEvidenceV1[]
  progressHash: string
}

export interface CodexExtractionCandidateV1 {
  version: 1
  kind: 'codex-extraction-candidate'
  portable: false
  plan: CodexExtractionPlanV1
  calls: CodexExtractionCallEvidenceV1[]
  entries: ExtractedCodexEntry[]
  candidateHash: string
}

interface CodexExtractionFormalItemV1 extends Record<string, unknown> {
  categoryId: number
  name: string
  icon: string
  summary: string
  description: string
  fields: string
  refs: string
  tags: string
  importance: number
  order: number
  worldGroupId: number | null
  origin: 'verbatim-extraction' | 'ai-created-suggestion'
  sourceEvidenceQuotes: string
  sourceContentHash: string
  producerRunId: number
  producerCandidateHash: string
}

interface CodexExtractionAdoptionIntentV1 {
  version: 1
  kind: 'codex-extraction-adoption-intent'
  portable: false
  candidate: CodexExtractionCandidateV1
  selectedIndexes: number[]
  formalItems: CodexExtractionFormalItemV1[]
  intentHash: string
}

export type CodexExtractionBoundaryV1 =
  | 'plan.checkpoint'
  | 'chunk.checkpoint'
  | 'candidate.persisted'
  | 'candidate.checkpoint'

export type CodexExtractionAdoptionBoundaryV1 =
  | 'intent.checkpoint'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'formal.written'
  | 'adoption.committed'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

interface PreparedSourcesV1 {
  promptTemplateHash: string
  baselineContext: Awaited<ReturnType<typeof assembleContext>>
  baselineContextHash: string
  sourceContext: Awaited<ReturnType<typeof assembleContext>>
  sourceContextHash: string
  baseline: CodexExtractionBaselineV1
  baselineHash: string
  chunks: string[]
  gatewaySelectorHash: string
  gatewayTraceHash: string
  gatewayPacket: ContextPacketV1
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function assertExactKeys(row: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) {
    throw new Error(`${label}字段不在允许闭集。`)
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameFormalItem(left: unknown, right: CodexExtractionFormalItemV1): boolean {
  if (!left || typeof left !== 'object' || Array.isArray(left)) return false
  const row = left as Record<string, unknown>
  return Object.keys(row).length === 16
    && Object.keys(row).every(key => [
      'categoryId', 'name', 'icon', 'summary', 'description', 'fields',
      'refs', 'tags', 'importance', 'order', 'worldGroupId', 'origin',
      'sourceEvidenceQuotes', 'sourceContentHash', 'producerRunId', 'producerCandidateHash',
    ].includes(key))
    && row.categoryId === right.categoryId
    && row.name === right.name
    && row.icon === right.icon
    && row.summary === right.summary
    && row.description === right.description
    && row.fields === right.fields
    && row.refs === right.refs
    && row.tags === right.tags
    && row.importance === right.importance
    && row.order === right.order
    && row.worldGroupId === right.worldGroupId
    && row.origin === right.origin
    && row.sourceEvidenceQuotes === right.sourceEvidenceQuotes
    && row.sourceContentHash === right.sourceContentHash
    && row.producerRunId === right.producerRunId
    && row.producerCandidateHash === right.producerCandidateHash
}

async function append(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  type: Parameters<typeof appendAgentRunEventV1>[0]['type'],
  payload: any,
): Promise<AgentRunSnapshotV1> {
  return appendAgentRunEventV1({
    scope, runId: snapshot.run.id, type, payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as any)
}

async function hashAssembly(assembled: Awaited<ReturnType<typeof assembleContext>>): Promise<string> {
  return hashCanonicalValue({
    included: assembled.included,
    omitted: assembled.omitted,
    trimmed: assembled.trimmed,
    segments: assembled.segments.map(segment => ({ label: segment.label, content: segment.content })),
  })
}

async function exactAssembly(text: string, label: string, inputBudget: number): Promise<AssembleContextResult> {
  const tokens = estimateTokens(text)
  return {
    text,
    segments: [{ label, layer: 'L0', content: text, tokens, trimmable: false }],
    included: ['ragSelection'], omitted: [], trimmed: [],
    sourceEvidence: [{
      key: 'ragSelection', status: 'included', delivery: 'full',
      sourceHash: await hashCanonicalValue({ text }),
      originalCharacters: text.length, inputCharacters: text.length,
      originalTokens: tokens, inputTokens: tokens,
    }],
    totalInputTokens: tokens, inputBudget,
    overBudgetBeforeTrim: tokens > inputBudget,
    overBudgetAfterTrim: tokens > inputBudget,
  }
}

function normalizeRequest(request: CodexExtractionRequestV1): NormalizedCodexCandidateRequestV1 {
  const operation = request.operation ?? 'extract'
  if (!['extract', 'enrich'].includes(operation)) throw new Error('Codex 候选操作无效。')
  const sourceText = request.sourceText.trim()
  if (!Number.isInteger(request.categoryId) || request.categoryId <= 0) throw new Error('Codex 目标分类无效。')
  if (request.worldGroupId !== null && (!Number.isInteger(request.worldGroupId) || request.worldGroupId <= 0)) {
    throw new Error('Codex 目标世界组无效。')
  }
  const authorRequest = (request.authorRequest ?? '').trim()
  if (operation === 'extract' && !sourceText) throw new Error('没有可拆分的设定内容。')
  if (operation === 'enrich' && !authorRequest) throw new Error('请说明希望 AI 补全的方向。')
  return { ...request, operation, sourceText, authorRequest, supplementTags: request.supplementTags === true }
}

async function prepareSources(scope: WorkspaceScope, rawRequest: CodexExtractionRequestV1): Promise<PreparedSourcesV1> {
  const request = normalizeRequest(rawRequest)
  const baseline = await readCodexExtractionBaselineV1({
    scope, categoryId: request.categoryId, worldGroupId: request.worldGroupId,
  })
  if (!isPortableResourceUidV1(baseline.category.ragDocumentId, 'codex-category')
    || baseline.entries.some(entry => !isPortableResourceUidV1(entry.ragDocumentId, 'codex-entry'))) {
    throw new Error('Codex 资源身份尚未迁移，请刷新工作区后重试。')
  }
  const mandatoryResourceKeys = [
    `codex-entry:${baseline.category.ragDocumentId}`,
    ...baseline.entries.map(entry => `codex-entry:${entry.ragDocumentId}`),
  ]
  const skill = getAgentSkillV1(
    request.operation === 'extract' ? 'world-origin.codex-extract' : 'world-origin.codex-enrich',
    'world-origin',
  )
  const gatewayExecution = await executeContextGatewayV1({
    skill, scope, worldGroupId: request.worldGroupId,
    query: request.operation === 'extract'
      ? `从作者原文抽取 ${baseline.category.name}，只使用目标分类 schema 与同类既有词条做登记约束。`
      : `${request.authorRequest}\n为 ${baseline.category.name} 补全新的 Codex 候选；检索相关世界、故事、角色与故事线。`,
    budgetTokens: skill.contextGateway!.maxRetrievedTokens,
    mandatoryResourceKeys,
    mandatoryFullResourceKeys: mandatoryResourceKeys,
    targetResourceKeys: mandatoryResourceKeys,
    additionalReadsEnabled: false,
  })
  const baselineContext = await exactAssembly(
    formatCodexExtractionBaselineV1(baseline),
    'Context Gateway 冻结的 Codex 分类与既有词条基线',
    8_000,
  )
  const sourceContext = request.operation === 'extract'
    ? await assembleContext({
        projectId: scope.projectId, scope,
        sourceKeys: ['manualText'], manualSourceText: request.sourceText,
        inputBudgetMaxTokens: 100_000,
      })
    : assembleContextGatewayPacketV1(gatewayExecution, skill.contextGateway!.maxRetrievedTokens)
  if (request.operation === 'extract' && !sourceContext.included.includes('manualText')) {
    throw new Error('Codex 手工来源未进入 Context Gateway。')
  }
  if (request.operation === 'enrich' && !sourceContext.text.trim()) {
    throw new Error('Codex 创意补全需要至少一项已登记世界 Canon。')
  }
  const chunks = request.operation === 'extract' ? splitExtractionText(sourceContext.text) : [sourceContext.text]
  if (!chunks.length) throw new Error('没有可拆分的设定内容。')
  if (chunks.length > MAX_MODEL_CALLS) {
    throw new Error(`当前来源需要 ${chunks.length} 个词条提取分块，超过单次上限 ${MAX_MODEL_CALLS}。`)
  }
  const promptTemplateHash = await hashCanonicalValue({
    protocolVersion: 'codex-candidate-evidence-v2',
    template: request.operation === 'extract'
      ? readCodexExtractPromptTemplateSnapshotV1()
      : readCodexEnrichPromptTemplateSnapshotV1(),
  })
  return {
    promptTemplateHash,
    baselineContext,
    baselineContextHash: await hashAssembly(baselineContext),
    sourceContext,
    sourceContextHash: await hashAssembly(sourceContext),
    baseline,
    baselineHash: await hashCanonicalValue(baseline),
    chunks,
    gatewaySelectorHash: gatewayExecution.selector.selectorHash,
    gatewayTraceHash: gatewayExecution.retrievalTrace.traceHash,
    gatewayPacket: gatewayExecution.contextPacket,
  }
}

async function createPlan(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  request: NormalizedCodexCandidateRequestV1
  prepared: PreparedSourcesV1
}): Promise<{ snapshot: AgentRunSnapshotV1; plan: CodexExtractionPlanV1 }> {
  let snapshot = input.snapshot
  const baselineManifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id, stepId: CODEX_EXTRACTION_STEP_ID_V1, attempt: 1,
    projectId: input.scope.projectId, worldGroupId: input.request.worldGroupId,
    declaredSourceKeys: ['ragSelection'], assembled: input.prepared.baselineContext,
    readerVersion: 'codex-extraction-gateway-baseline-v1',
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: CODEX_EXTRACTION_STEP_ID_V1, attempt: 1, manifestHash: baselineManifest.manifestHash,
  })
  const sourceManifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id, stepId: CODEX_EXTRACTION_STEP_ID_V1, attempt: 1,
    projectId: input.scope.projectId, worldGroupId: input.request.worldGroupId,
    declaredSourceKeys: input.request.operation === 'extract'
      ? ['manualText']
      : ['ragSelection'],
    assembled: input.prepared.sourceContext,
    readerVersion: input.request.operation === 'extract'
      ? 'codex-extraction-manual-v1'
      : 'codex-enrichment-world-canon-v1',
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: CODEX_EXTRACTION_STEP_ID_V1, attempt: 1, manifestHash: sourceManifest.manifestHash,
  })
  const chunks = await Promise.all(input.prepared.chunks.map(async (chunk, callIndex) => ({
    callIndex, chunkIndex: callIndex, chunkCount: input.prepared.chunks.length,
    chunkHash: await hashCanonicalValue(chunk),
  })))
  const body = {
    version: 1 as const, kind: 'codex-extraction-plan' as const, portable: false as const,
    runId: snapshot.run.id,
    projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId,
    request: normalizeRequest(input.request),
    promptTemplateHash: input.prepared.promptTemplateHash,
    baselineContextManifestHash: baselineManifest.manifestHash,
    baselineContextHash: input.prepared.baselineContextHash,
    sourceContextManifestHash: sourceManifest.manifestHash,
    sourceContextHash: input.prepared.sourceContextHash,
    sourceTextHash: await hashCanonicalValue({ sourceText: input.request.sourceText }),
    gatewaySelectorHash: input.prepared.gatewaySelectorHash,
    gatewayTraceHash: input.prepared.gatewayTraceHash,
    gatewayPacket: input.prepared.gatewayPacket,
    baseline: input.prepared.baseline,
    baselineHash: input.prepared.baselineHash,
    chunks,
  }
  return { snapshot, plan: { ...body, planHash: await hashCanonicalValue(body) } }
}

function contractObjective(categoryId: number, operation: 'extract' | 'enrich' = 'extract'): string {
  return operation === 'extract'
    ? `从作者指定内容拆分分类 #${categoryId} 下可确认的 Codex 词条`
    : `根据已登记世界 Canon 为分类 #${categoryId} 生成可确认的 AI 新建词条建议`
}

function contract(
  scope: WorkspaceScope,
  worldGroupId: number | null,
  categoryId: number,
  maxModelCalls: number,
  operation: 'extract' | 'enrich',
) {
  const skill = getAgentSkillV1(
    operation === 'extract' ? 'world-origin.codex-extract' : 'world-origin.codex-enrich',
    'world-origin',
  )
  return {
    version: 1 as const,
    objective: contractObjective(categoryId, operation),
    workflowKind: 'long-running-resumable' as const,
    scope: { projectId: scope.projectId, worldGroupId },
    permissions: {
      contextSourceKeys: [...skill.contextSourceKeys],
      writeTargets: skill.writeTargets.map(target => ({
        table: target.table, fields: [...target.fields], mode: 'author-confirmed' as const,
      })),
    },
    executionBindings: [{ stepId: CODEX_EXTRACTION_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: {
      maxModelCalls, maxToolCalls: 0,
      maxInputTokens: maxModelCalls * 8_000,
      maxOutputTokens: maxModelCalls * 4_000,
      maxAttemptsPerStep: 1, maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'codex.candidate', kind: 'output-present' as const, required: true },
      { id: 'codex.author', kind: 'author-confirmed' as const, required: true },
      { id: 'codex.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'codex.terminal', kind: 'terminal' as const,
      verifier: CODEX_EXTRACTION_VERIFIER_SET_V1,
      criterionIds: ['codex.candidate', 'codex.author', 'codex.post-state'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

async function parsePlan(value: unknown): Promise<CodexExtractionPlanV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Codex 提取计划检查点无效。')
  const row = value as Record<string, any>
  assertExactKeys(row, [
    'version', 'kind', 'portable', 'runId', 'projectId', 'worldId', 'workId', 'request',
    'promptTemplateHash', 'baselineContextManifestHash', 'baselineContextHash',
    'sourceContextManifestHash', 'sourceContextHash', 'sourceTextHash',
    'gatewaySelectorHash', 'gatewayTraceHash', 'gatewayPacket', 'baseline', 'baselineHash',
    'chunks', 'planHash',
  ], 'Codex 提取计划 ')
  if (
    row.version !== 1 || row.kind !== 'codex-extraction-plan' || row.portable !== false
    || !Number.isInteger(row.runId) || row.runId <= 0
    || !Number.isInteger(row.projectId) || row.projectId <= 0
    || !Number.isInteger(row.worldId) || row.worldId <= 0
    || !Number.isInteger(row.workId) || row.workId <= 0
    || !isHash(row.promptTemplateHash) || !isHash(row.baselineContextManifestHash)
    || !isHash(row.baselineContextHash) || !isHash(row.sourceContextManifestHash)
    || !isHash(row.sourceContextHash) || !isHash(row.sourceTextHash)
    || !isHash(row.gatewaySelectorHash) || !isHash(row.gatewayTraceHash)
    || !isHash(row.baselineHash) || !isHash(row.planHash)
    || !row.request || typeof row.request !== 'object' || Array.isArray(row.request)
    || !row.gatewayPacket || typeof row.gatewayPacket !== 'object' || Array.isArray(row.gatewayPacket)
    || !row.baseline || typeof row.baseline !== 'object' || Array.isArray(row.baseline)
    || !Array.isArray(row.chunks) || row.chunks.length < 1 || row.chunks.length > MAX_MODEL_CALLS
  ) throw new Error('Codex 提取计划检查点不完整。')
  if (
    row.gatewayPacket.version !== 'context-packet-v1'
    || !isHash(row.gatewayPacket.packetHash)
    || !isHash(row.gatewayPacket.contentHash)
    || !isHash(row.gatewayPacket.policyHash)
  ) throw new Error('Codex Gateway Packet 检查点无效。')
  const { packetHash: gatewayPacketHash, ...gatewayPacketBody } = row.gatewayPacket
  if (await hashCanonicalValue(gatewayPacketBody) !== gatewayPacketHash) {
    throw new Error('Codex Gateway Packet hash 不匹配。')
  }
  assertExactKeys(row.request, [
    'categoryId', 'worldGroupId', 'sourceText', 'supplementTags', 'operation', 'authorRequest',
  ], 'Codex 候选请求 ')
  const request = normalizeRequest(row.request as CodexExtractionRequestV1)
  if (!sameValue(request, row.request)) throw new Error('Codex 提取请求未规范化。')
  if (await hashCanonicalValue({ sourceText: request.sourceText }) !== row.sourceTextHash) {
    throw new Error('Codex 原文来源 hash 不匹配。')
  }
  const baseline = row.baseline as Record<string, unknown>
  assertExactKeys(baseline, ['category', 'entries'], 'Codex 提取基线 ')
  if (!baseline.category || typeof baseline.category !== 'object' || Array.isArray(baseline.category) || !Array.isArray(baseline.entries)) {
    throw new Error('Codex 提取基线不完整。')
  }
  const category = baseline.category as Record<string, unknown>
  assertExactKeys(category, ['id', 'ragDocumentId', 'name', 'icon', 'domain', 'builtInKey', 'fieldSchema', 'fields', 'updatedAt'], 'Codex 分类基线 ')
  if (
    category.id !== request.categoryId || !isPortableResourceUidV1(category.ragDocumentId, 'codex-category')
    || typeof category.name !== 'string' || !category.name.trim()
    || typeof category.icon !== 'string' || !['natural', 'humanity', 'origin'].includes(String(category.domain))
    || (category.builtInKey !== null && typeof category.builtInKey !== 'string')
    || typeof category.fieldSchema !== 'string' || !Array.isArray(category.fields)
    || !Number.isFinite(category.updatedAt)
  ) throw new Error('Codex 分类基线无效。')
  const parsedFields = parseFieldSchema(category.fieldSchema as string)
  if (canonicalStringify(parsedFields) !== canonicalStringify(category.fields)) {
    throw new Error('Codex 分类字段 schema 快照不匹配。')
  }
  const entries = (baseline.entries as unknown[]).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Codex 原始词条 ${index + 1} 无效。`)
    const entry = item as Record<string, unknown>
    assertExactKeys(entry, [
      'id', 'ragDocumentId', 'categoryId', 'name', 'icon', 'summary', 'description', 'fields', 'refs', 'tags',
      'importance', 'cultivationSystemId', 'cultivationStageId', 'importantLocationId', 'order',
      'origin', 'sourceEvidenceQuotes', 'sourceContentHash', 'producerRunId', 'producerCandidateHash',
      'worldGroupId', 'worldId', 'createdAt', 'updatedAt',
    ], 'Codex 原始词条 ')
    if (
      !Number.isInteger(entry.id) || (entry.id as number) <= 0
      || !isPortableResourceUidV1(entry.ragDocumentId, 'codex-entry')
      || entry.categoryId !== request.categoryId
      || typeof entry.name !== 'string' || !entry.name.trim() || typeof entry.icon !== 'string'
      || typeof entry.summary !== 'string' || typeof entry.description !== 'string'
      || typeof entry.fields !== 'string' || typeof entry.refs !== 'string' || typeof entry.tags !== 'string'
      || !['manual', 'verbatim-extraction', 'ai-created-suggestion', 'import'].includes(String(entry.origin))
      || typeof entry.sourceEvidenceQuotes !== 'string' || typeof entry.sourceContentHash !== 'string'
      || (entry.producerRunId !== null && (!Number.isInteger(entry.producerRunId) || (entry.producerRunId as number) <= 0))
      || (entry.producerCandidateHash !== null && !isHash(entry.producerCandidateHash))
      || !Number.isFinite(entry.importance) || !Number.isInteger(entry.order)
      || (entry.worldGroupId ?? null) !== request.worldGroupId || entry.worldId !== row.worldId
      || !Number.isFinite(entry.createdAt) || !Number.isFinite(entry.updatedAt)
    ) throw new Error(`Codex 原始词条 ${index + 1} 不完整。`)
    return entry as unknown as CodexExtractionEntryV1
  })
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Codex 原始词条 ID 重复。')
  const typedBaseline = { category: category as unknown as CodexExtractionBaselineV1['category'], entries }
  if (await hashCanonicalValue(typedBaseline) !== row.baselineHash) throw new Error('Codex 提取基线 hash 不匹配。')
  const chunks = row.chunks.map((value: unknown, index: number) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Codex 提取分块 ${index + 1} 无效。`)
    const chunk = value as Record<string, unknown>
    assertExactKeys(chunk, ['callIndex', 'chunkIndex', 'chunkCount', 'chunkHash'], 'Codex 提取分块 ')
    if (chunk.callIndex !== index || chunk.chunkIndex !== index || chunk.chunkCount !== row.chunks.length || !isHash(chunk.chunkHash)) {
      throw new Error(`Codex 提取分块 ${index + 1} 不完整。`)
    }
    return chunk as unknown as CodexExtractionChunkV1
  })
  const { planHash, ...body } = row
  if (await hashCanonicalValue(body) !== planHash) throw new Error('Codex 提取计划 hash 不匹配。')
  return { ...row, request, baseline: typedBaseline, chunks } as CodexExtractionPlanV1
}

function parseCallEvidence(value: unknown, index: number): CodexExtractionCallEvidenceV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Codex 提取调用证据无效。')
  const row = value as Record<string, unknown>
  assertExactKeys(row, ['callIndex', 'promptInputHash', 'outputHash', 'discoveredHash'], 'Codex 提取调用证据 ')
  if (row.callIndex !== index || !isHash(row.promptInputHash) || !isHash(row.outputHash) || !isHash(row.discoveredHash)) {
    throw new Error('Codex 提取调用证据不完整。')
  }
  return row as unknown as CodexExtractionCallEvidenceV1
}

async function parseProgress(value: unknown): Promise<CodexExtractionProgressV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Codex 提取进度检查点无效。')
  const row = value as Record<string, any>
  assertExactKeys(row, ['version', 'kind', 'portable', 'plan', 'nextCallIndex', 'found', 'calls', 'progressHash'], 'Codex 提取进度 ')
  const plan = await parsePlan(row.plan)
  if (
    row.version !== 1 || row.kind !== 'codex-extraction-progress' || row.portable !== false
    || !Number.isInteger(row.nextCallIndex) || row.nextCallIndex < 0 || row.nextCallIndex > plan.chunks.length
    || !Array.isArray(row.found) || !Array.isArray(row.calls) || !isHash(row.progressHash)
    || row.calls.length !== row.nextCallIndex
  ) throw new Error('Codex 提取进度检查点不完整。')
  const found = parseCodexEntriesStrictV1(
    JSON.stringify(row.found), plan.baseline.category.fields,
    { operation: plan.request.operation, sourceText: plan.request.sourceText },
  )
  if (
    new Set(found.map(entry => entry.name.toLocaleLowerCase())).size !== found.length
    || found.some(entry => plan.baseline.entries.some(original => (
      original.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase()
    )))
  ) throw new Error('Codex 提取进度候选名称无效。')
  const calls = row.calls.map(parseCallEvidence)
  const { progressHash, ...body } = row
  if (await hashCanonicalValue(body) !== progressHash) throw new Error('Codex 提取进度 hash 不匹配。')
  return { ...row, plan, found, calls } as CodexExtractionProgressV1
}

async function parseCandidate(value: unknown): Promise<CodexExtractionCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Codex 提取候选检查点无效。')
  const row = value as Record<string, any>
  assertExactKeys(row, ['version', 'kind', 'portable', 'plan', 'calls', 'entries', 'candidateHash'], 'Codex 提取候选 ')
  const plan = await parsePlan(row.plan)
  if (
    row.version !== 1 || row.kind !== 'codex-extraction-candidate' || row.portable !== false
    || !Array.isArray(row.calls) || row.calls.length !== plan.chunks.length
    || !Array.isArray(row.entries) || !isHash(row.candidateHash)
  ) throw new Error('Codex 提取候选检查点不完整。')
  const calls = row.calls.map(parseCallEvidence)
  const entries = parseCodexEntriesStrictV1(
    JSON.stringify(row.entries), plan.baseline.category.fields,
    { operation: plan.request.operation, sourceText: plan.request.sourceText },
  )
  if (
    new Set(entries.map(entry => entry.name.toLocaleLowerCase())).size !== entries.length
    || entries.some(entry => plan.baseline.entries.some(original => (
      original.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase()
    )))
  ) {
    throw new Error('Codex 提取候选名称重复。')
  }
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('Codex 提取候选 hash 不匹配。')
  return { ...row, plan, calls, entries } as CodexExtractionCandidateV1
}

async function candidateFromProgress(
  progress: CodexExtractionProgressV1,
): Promise<CodexExtractionCandidateV1> {
  if (
    progress.nextCallIndex !== progress.plan.chunks.length
    || progress.calls.length !== progress.plan.chunks.length
  ) throw new Error('Codex 提取进度尚未完成，不能重建候选。')
  const body = {
    version: 1 as const, kind: 'codex-extraction-candidate' as const, portable: false as const,
    plan: progress.plan, calls: progress.calls, entries: progress.found,
  }
  return { ...body, candidateHash: await hashCanonicalValue(body) }
}

async function latestState(scope: WorkspaceScope, runId: number): Promise<{
  progress: CodexExtractionProgressV1 | null
  candidate: CodexExtractionCandidateV1 | null
  intent: CodexExtractionAdoptionIntentV1 | null
}> {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('Codex 提取运行缺少可验证检查点。')
  const value = checkpoint.resumePayload
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Codex 提取检查点无效。')
  const kind = (value as Record<string, unknown>).kind
  if (kind === 'codex-extraction-progress') {
    const progress = await parseProgress(value)
    const snapshot = await readAgentRunV1(scope, runId)
    const candidateHash = snapshot.projection.steps[CODEX_EXTRACTION_STEP_ID_V1]?.candidateHash
    if (
      snapshot.projection.state === 'awaiting_confirmation'
      && progress.nextCallIndex === progress.plan.chunks.length
      && candidateHash
    ) {
      const candidate = await candidateFromProgress(progress)
      if (candidate.candidateHash !== candidateHash) throw new Error('Codex 候选事件与完整进度不匹配。')
      return { progress: null, candidate, intent: null }
    }
    return { progress, candidate: null, intent: null }
  }
  if (kind === 'codex-extraction-candidate') return { progress: null, candidate: await parseCandidate(value), intent: null }
  if (kind !== 'codex-extraction-adoption-intent') throw new Error('Codex 提取检查点类型无效。')
  const row = value as Record<string, any>
  assertExactKeys(row, ['version', 'kind', 'portable', 'candidate', 'selectedIndexes', 'formalItems', 'intentHash'], 'Codex 采纳意图 ')
  if (
    row.version !== 1 || row.portable !== false || !Array.isArray(row.selectedIndexes)
    || !Array.isArray(row.formalItems) || !isHash(row.intentHash)
  ) throw new Error('Codex 采纳意图不完整。')
  const candidate = await parseCandidate(row.candidate)
  const emptySelectionIsValid = candidate.entries.length === 0 && row.selectedIndexes.length === 0
  if (
    (!emptySelectionIsValid && row.selectedIndexes.length < 1)
    || new Set(row.selectedIndexes).size !== row.selectedIndexes.length
    || row.selectedIndexes.some((index: unknown, position: number) => (
      !Number.isInteger(index) || (index as number) < 0 || (index as number) >= candidate.entries.length
      || (position > 0 && row.selectedIndexes[position - 1] >= (index as number))
    ))
    || row.formalItems.length !== row.selectedIndexes.length
  ) throw new Error('Codex 采纳意图选择无效。')
  const expectedFormalItems = row.selectedIndexes.map((index: number, order: number) => formalItem(
    candidate.entries[index], candidate.plan.baseline.entries.length + order, candidate.plan,
    candidate.candidateHash,
  ))
  if (!row.formalItems.every((item: unknown, index: number) => sameFormalItem(item, expectedFormalItems[index]))) {
    throw new Error('Codex 采纳意图正式项不匹配。')
  }
  const { intentHash, ...body } = row
  if (await hashCanonicalValue(body) !== intentHash) throw new Error('Codex 采纳意图 hash 不匹配。')
  return { progress: null, candidate, intent: { ...row, candidate, formalItems: expectedFormalItems } as CodexExtractionAdoptionIntentV1 }
}

async function verifyCurrentPlan(scope: WorkspaceScope, plan: CodexExtractionPlanV1): Promise<PreparedSourcesV1> {
  if (plan.projectId !== scope.projectId || plan.worldId !== scope.worldId || plan.workId !== scope.workId) {
    throw new Error('Codex 提取计划与当前 World/Work 不匹配。')
  }
  let current: PreparedSourcesV1
  try {
    current = await prepareSources(scope, plan.request)
  } catch {
    throw new Error('Codex 来源、分类、schema、既有词条或提示词模板已变化，请重新提取。')
  }
  if (
    current.promptTemplateHash !== plan.promptTemplateHash
    || current.baselineContextHash !== plan.baselineContextHash
    || current.sourceContextHash !== plan.sourceContextHash
    || current.gatewaySelectorHash !== plan.gatewaySelectorHash
    || current.gatewayTraceHash !== plan.gatewayTraceHash
    || current.gatewayPacket.packetHash !== plan.gatewayPacket.packetHash
    || current.baselineHash !== plan.baselineHash
    || current.chunks.length !== plan.chunks.length
  ) throw new Error('Codex 来源、分类、schema、既有词条或提示词模板已变化，请重新提取。')
  return current
}

async function pauseUnsafeRun(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, reason: string): Promise<AgentRunSnapshotV1> {
  if (snapshot.projection.state === 'running' || snapshot.projection.state === 'awaiting_confirmation') {
    return append(scope, snapshot, 'run.paused', { reason, recoverable: false })
  }
  return snapshot
}

async function continueExtraction(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  progress: CodexExtractionProgressV1
  prepared: PreparedSourcesV1
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: CodexExtractionBoundaryV1, snapshot: AgentRunSnapshotV1, callIndex: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: CodexExtractionCandidateV1 }> {
  let snapshot = input.snapshot
  let progress = input.progress
  const chunkTexts = input.prepared.chunks
  const existingNames = new Set(progress.plan.baseline.entries.map(entry => entry.name.toLocaleLowerCase()))
  for (let callIndex = progress.nextCallIndex; callIndex < progress.plan.chunks.length; callIndex++) {
    const chunk = progress.plan.chunks[callIndex]
    const chunkText = chunkTexts[callIndex]
    if (!chunkText || await hashCanonicalValue(chunkText) !== chunk.chunkHash) {
      snapshot = await pauseUnsafeRun(input.scope, snapshot, 'codex-extraction-chunk-rebind-mismatch')
      throw new Error('Codex 提取分块无法重绑，Run 已暂停。')
    }
    const discoveredNames = progress.found.map(entry => entry.name)
    const messages = progress.plan.request.operation === 'extract'
      ? buildCodexExtractPromptFromRegisteredContextV1({
          sourceText: chunkText,
          baselineContext: input.prepared.baselineContext.text,
          discoveredNames,
          supplementTags: progress.plan.request.supplementTags,
        })
      : buildCodexEnrichPromptFromRegisteredContextV1({
          baselineContext: input.prepared.baselineContext.text,
          worldContext: chunkText,
          authorRequest: progress.plan.request.authorRequest,
          supplementTags: progress.plan.request.supplementTags,
        })
    const promptInputHash = await hashCanonicalValue({
      promptTemplateHash: progress.plan.promptTemplateHash,
      baselineContextHash: progress.plan.baselineContextHash,
      chunkHash: chunk.chunkHash,
      discoveredNames,
      supplementTags: progress.plan.request.supplementTags,
      operation: progress.plan.request.operation,
      authorRequest: progress.plan.request.authorRequest,
    })
    snapshot = await append(input.scope, snapshot, 'model.requested', {
      stepId: CODEX_EXTRACTION_STEP_ID_V1, attempt: 1,
      bindingHash: await hashCanonicalValue({
        executionBinding: snapshot.contract.executionBindings?.[0], callIndex, promptInputHash,
      }),
    })
    let raw: string
    try {
      raw = await (input.runAI
        ? input.runAI(messages, callIndex)
        : chat(messages, input.aiConfig!, {
            category: progress.plan.request.operation === 'extract' ? 'codex.extract' : 'codex.enrich',
            projectId: input.scope.projectId,
          }))
    } catch (error) {
      snapshot = await pauseUnsafeRun(input.scope, snapshot, 'codex-extraction-model-outcome-unknown')
      throw error
    }
    const outputHash = await hashCanonicalValue({ raw })
    snapshot = await append(input.scope, snapshot, 'model.responded', {
      stepId: CODEX_EXTRACTION_STEP_ID_V1, attempt: 1, outputHash,
    })
    let parsed: ExtractedCodexEntry[]
    try {
      parsed = parseCodexEntriesStrictV1(raw, progress.plan.baseline.category.fields, {
        operation: progress.plan.request.operation,
        sourceText: progress.plan.request.sourceText,
      })
      if (parsed.some(entry => (
        progress.plan.request.supplementTags ? entry.tags.length < 2 : entry.tags.length !== 0
      ))) throw new Error('Codex 词条标签数量与冻结补充标签选项不一致。')
      const knownNames = new Set([
        ...existingNames,
        ...progress.found.map(entry => entry.name.toLocaleLowerCase()),
      ])
      if (parsed.some(entry => knownNames.has(entry.name.toLocaleLowerCase()))) {
        throw new Error('Codex 模型重复输出已有词条或前置分块候选。')
      }
    } catch (error) {
      snapshot = await append(input.scope, snapshot, 'step.failed', {
        stepId: CODEX_EXTRACTION_STEP_ID_V1, attempt: 1,
        code: 'codex-extraction-protocol-failed', retryable: false,
        category: 'protocol', action: 'fail',
      })
      await append(input.scope, snapshot, 'run.failed', { code: 'codex-extraction-protocol-failed', retryable: false })
      throw error
    }
    const found = [...progress.found, ...parsed]
    if (found.length > MAX_CANDIDATES) {
      snapshot = await append(input.scope, snapshot, 'step.failed', {
        stepId: CODEX_EXTRACTION_STEP_ID_V1, attempt: 1,
        code: 'codex-extraction-candidate-limit', retryable: false,
        category: 'protocol', action: 'fail',
      })
      await append(input.scope, snapshot, 'run.failed', { code: 'codex-extraction-candidate-limit', retryable: false })
      throw new Error(`Codex 候选超过上限 ${MAX_CANDIDATES}。`)
    }
    const callEvidence: CodexExtractionCallEvidenceV1 = {
      callIndex, promptInputHash, outputHash, discoveredHash: await hashCanonicalValue(parsed),
    }
    const body = {
      version: 1 as const, kind: 'codex-extraction-progress' as const, portable: false as const,
      plan: progress.plan, nextCallIndex: callIndex + 1, found, calls: [...progress.calls, callEvidence],
    }
    progress = { ...body, progressHash: await hashCanonicalValue(body) }
    const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: progress })
    snapshot = saved.snapshot
    await input.onDurableBoundary?.('chunk.checkpoint', snapshot, callIndex)
  }
  try {
    await verifyCurrentPlan(input.scope, progress.plan)
  } catch (error) {
    snapshot = await pauseUnsafeRun(input.scope, snapshot, 'codex-extraction-source-stale-before-candidate')
    throw error
  }
  const candidate = await candidateFromProgress(progress)
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: CODEX_EXTRACTION_STEP_ID_V1, attempt: 1,
    candidateHash: candidate.candidateHash, requiresConfirmation: true,
  })
  await input.onDurableBoundary?.('candidate.persisted', snapshot, progress.plan.chunks.length)
  const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: candidate })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('candidate.checkpoint', snapshot, progress.plan.chunks.length)
  return { snapshot, candidate }
}

export async function generateCodexExtractionCandidateV1(input: {
  scope: WorkspaceScope
  request: CodexExtractionRequestV1
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: CodexExtractionBoundaryV1, snapshot: AgentRunSnapshotV1, callIndex: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: CodexExtractionCandidateV1 }> {
  const request = normalizeRequest(input.request)
  const prepared = await prepareSources(input.scope, request)
  let snapshot = await createAgentRunV1({
    scope: input.scope, worldGroupId: request.worldGroupId,
    contract: contract(
      input.scope, request.worldGroupId, request.categoryId, prepared.chunks.length, request.operation,
    ),
  })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: CODEX_EXTRACTION_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: CODEX_EXTRACTION_STEP_ID_V1, attempt: 1 })
  const created = await createPlan({ scope: input.scope, snapshot, request, prepared })
  snapshot = created.snapshot
  const progressBody = {
    version: 1 as const, kind: 'codex-extraction-progress' as const, portable: false as const,
    plan: created.plan, nextCallIndex: 0, found: [] as ExtractedCodexEntry[], calls: [] as CodexExtractionCallEvidenceV1[],
  }
  const progress = { ...progressBody, progressHash: await hashCanonicalValue(progressBody) }
  const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: progress })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('plan.checkpoint', snapshot, -1)
  return continueExtraction({ ...input, snapshot, progress, prepared })
}

export interface CodexEnrichmentRequestV1 {
  categoryId: number
  worldGroupId: number | null
  authorRequest: string
  supplementTags: boolean
}

export async function generateCodexEnrichmentCandidateV1(input: {
  scope: WorkspaceScope
  request: CodexEnrichmentRequestV1
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: CodexExtractionBoundaryV1, snapshot: AgentRunSnapshotV1, callIndex: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: CodexExtractionCandidateV1 }> {
  return generateCodexExtractionCandidateV1({
    ...input,
    request: {
      categoryId: input.request.categoryId,
      worldGroupId: input.request.worldGroupId,
      sourceText: '',
      supplementTags: input.request.supplementTags,
      operation: 'enrich',
      authorRequest: input.request.authorRequest,
    },
  })
}

export async function readRecoverableCodexExtractionV1(input: {
  scope: WorkspaceScope
  categoryId?: number
  worldGroupId?: number | null
  operation?: 'extract' | 'enrich'
}): Promise<{
  snapshot: AgentRunSnapshotV1
  nextCallIndex: number
  totalCalls: number
  safeToResume: boolean
  request?: CodexExtractionRequestV1
} | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => (
      (row.status === 'running' || row.status === 'paused')
      && (
        row.contractJson?.includes('world-origin.codex-extract')
        || row.contractJson?.includes('world-origin.codex-enrich')
      )
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    const snapshot = await readAgentRunV1(input.scope, row.id)
    try {
      const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, row.id)
      if (!checkpoint) throw new Error('缺少 Codex 提取检查点。')
      const progress = await parseProgress(checkpoint.resumePayload)
      if (input.categoryId != null && progress.plan.request.categoryId !== input.categoryId) continue
      if (input.operation && progress.plan.request.operation !== input.operation) continue
      if (Object.prototype.hasOwnProperty.call(input, 'worldGroupId')
        && progress.plan.request.worldGroupId !== (input.worldGroupId ?? null)) continue
      const safeTail = checkpoint.snapshot.projection.lastSequence === checkpoint.checkpoint.throughSequence + 1
      return {
        snapshot: checkpoint.snapshot,
        nextCallIndex: progress.nextCallIndex,
        totalCalls: progress.plan.chunks.length,
        safeToResume: checkpoint.snapshot.projection.state === 'running' && safeTail,
        request: progress.plan.request,
      }
    } catch {
      // A crash before the first plan checkpoint is not resumable. The frozen
      // category id in the objective still lets the correct panel expose an
      // explicit abandon action without guessing from the active UI state.
      if (input.categoryId != null && snapshot.contract.objective !== contractObjective(
        input.categoryId, input.operation ?? (snapshot.contract.objective.includes('AI 新建') ? 'enrich' : 'extract'),
      )) continue
      if (Object.prototype.hasOwnProperty.call(input, 'worldGroupId')
        && snapshot.contract.scope.worldGroupId !== (input.worldGroupId ?? null)) continue
      return {
        snapshot,
        nextCallIndex: 0,
        totalCalls: snapshot.contract.budget.maxModelCalls,
        safeToResume: false,
      }
    }
  }
  return null
}

export async function resumeCodexExtractionCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: CodexExtractionBoundaryV1, snapshot: AgentRunSnapshotV1, callIndex: number) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: CodexExtractionCandidateV1 }> {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, input.runId)
  if (!checkpoint) throw new Error('Codex 提取运行缺少可恢复检查点。')
  const progress = await parseProgress(checkpoint.resumePayload)
  if (
    checkpoint.snapshot.projection.state !== 'running'
    || checkpoint.snapshot.projection.lastSequence !== checkpoint.checkpoint.throughSequence + 1
  ) throw new Error('Codex 提取停在模型结果不可判定窗口，不会自动重试。')
  let prepared: PreparedSourcesV1
  try {
    prepared = await verifyCurrentPlan(input.scope, progress.plan)
  } catch (error) {
    await pauseUnsafeRun(input.scope, checkpoint.snapshot, 'codex-extraction-source-stale-before-resume')
    throw error
  }
  return continueExtraction({ ...input, snapshot: checkpoint.snapshot, progress, prepared })
}

export async function readPendingCodexExtractionCandidateV1(input: {
  scope: WorkspaceScope
  categoryId?: number
  worldGroupId?: number | null
  operation?: 'extract' | 'enrich'
}): Promise<{
  snapshot: AgentRunSnapshotV1
  candidate: CodexExtractionCandidateV1
  selectedIndexes: number[] | null
} | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => (
      ['awaiting_confirmation', 'running', 'verifying'].includes(row.status)
      && (
        row.contractJson?.includes('world-origin.codex-extract')
        || row.contractJson?.includes('world-origin.codex-enrich')
      )
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      const snapshot = await readAgentRunV1(input.scope, row.id)
      const state = await latestState(input.scope, row.id)
      const candidate = state.candidate ?? state.intent?.candidate
      if (!candidate) continue
      if (input.categoryId != null && candidate.plan.request.categoryId !== input.categoryId) continue
      if (input.operation && candidate.plan.request.operation !== input.operation) continue
      if (Object.prototype.hasOwnProperty.call(input, 'worldGroupId')
        && candidate.plan.request.worldGroupId !== (input.worldGroupId ?? null)) continue
      if (state.intent) return {
        snapshot, candidate: state.intent.candidate, selectedIndexes: [...state.intent.selectedIndexes],
      }
      if (state.candidate) return { snapshot, candidate: state.candidate, selectedIndexes: null }
    } catch {
      // Damaged historical candidates remain auditable but are not recoverable.
    }
  }
  return null
}

function formalItem(
  entry: ExtractedCodexEntry,
  order: number,
  plan: CodexExtractionPlanV1,
  candidateHash: string,
): CodexExtractionFormalItemV1 {
  return {
    categoryId: plan.request.categoryId,
    name: entry.name,
    icon: entry.icon || plan.baseline.category.icon,
    summary: entry.summary,
    description: entry.description,
    fields: JSON.stringify(entry.fields),
    refs: '{}',
    tags: JSON.stringify(entry.tags),
    importance: entry.importance,
    order,
    worldGroupId: plan.request.worldGroupId,
    origin: plan.request.operation === 'extract' ? 'verbatim-extraction' : 'ai-created-suggestion',
    sourceEvidenceQuotes: JSON.stringify(entry.evidenceQuotes),
    sourceContentHash: plan.request.operation === 'extract'
      ? plan.sourceTextHash
      : plan.gatewayPacket.contentHash,
    producerRunId: plan.runId,
    producerCandidateHash: candidateHash,
  }
}

function formalMatches(item: CodexExtractionFormalItemV1, row: Record<string, any> | undefined): boolean {
  return !!row?.id
    && row.categoryId === item.categoryId
    && row.name === item.name
    && (row.icon ?? '') === item.icon
    && (row.summary ?? '') === item.summary
    && row.description === item.description
    && row.fields === item.fields
    && (row.refs ?? '{}') === item.refs
    && (row.tags ?? '[]') === item.tags
    && Number(row.importance ?? 0) === item.importance
    && row.order === item.order
    && (row.worldGroupId ?? null) === item.worldGroupId
    && (row.origin ?? 'manual') === item.origin
    && (row.sourceEvidenceQuotes ?? '[]') === item.sourceEvidenceQuotes
    && (row.sourceContentHash ?? '') === item.sourceContentHash
    && (row.producerRunId ?? null) === item.producerRunId
    && (row.producerCandidateHash ?? null) === item.producerCandidateHash
}

function entryMatches(left: CodexExtractionEntryV1, right: CodexExtractionEntryV1 | undefined): boolean {
  return !!right && canonicalStringify(left) === canonicalStringify(right)
}

async function adoptionFreshness(input: {
  scope: WorkspaceScope
  candidate: CodexExtractionCandidateV1
  intent?: CodexExtractionAdoptionIntentV1 | null
  requireFormalItems?: boolean
}): Promise<{
  fresh: boolean
  baseline: CodexExtractionBaselineV1 | null
  selectedRows: Array<CodexExtractionEntryV1 | undefined>
}> {
  let current: PreparedSourcesV1 | null = null
  try {
    current = await prepareSources(input.scope, input.candidate.plan.request)
  } catch { /* stale */ }
  if (!current) return { fresh: false, baseline: null, selectedRows: [] }
  const candidateUpstreamRefs = input.candidate.plan.gatewayPacket.sourceRefs.filter(ref => (
    ref.table !== 'codexEntries' && ref.table !== 'codexCategories'
  ))
  const currentUpstreamRefs = current.gatewayPacket.sourceRefs.filter(ref => (
    ref.table !== 'codexEntries' && ref.table !== 'codexCategories'
  ))
  const sourceFresh = input.candidate.plan.request.operation === 'extract'
    ? current.sourceContextHash === input.candidate.plan.sourceContextHash
    : await hashCanonicalValue(currentUpstreamRefs) === await hashCanonicalValue(candidateUpstreamRefs)
  const upstreamFresh = current.promptTemplateHash === input.candidate.plan.promptTemplateHash
    && sourceFresh
  const originalById = new Map(input.candidate.plan.baseline.entries.map(entry => [entry.id, entry]))
  const formalByName = new Map((input.intent?.formalItems ?? []).map(item => [item.name.toLocaleLowerCase(), item]))
  const originalsFresh = canonicalStringify(input.candidate.plan.baseline.category)
    === canonicalStringify(current.baseline.category)
    && input.candidate.plan.baseline.entries.every(original => entryMatches(
      original, current!.baseline.entries.find(entry => entry.id === original.id),
    ))
  const extras = current.baseline.entries.filter(entry => !originalById.has(entry.id))
  const extrasAllowed = extras.every(row => {
    const item = formalByName.get(row.name.toLocaleLowerCase())
    return !!item && formalMatches(item, row)
  })
  const selectedRows = (input.intent?.formalItems ?? []).map(item => current!.baseline.entries.find(row => (
    row.name.toLocaleLowerCase() === item.name.toLocaleLowerCase()
  )))
  const formalFresh = !input.requireFormalItems
    || selectedRows.every((row, index) => formalMatches(input.intent!.formalItems[index], row))
  return { fresh: upstreamFresh && originalsFresh && extrasAllowed && formalFresh, baseline: current.baseline, selectedRows }
}

async function assertAdoptionFresh(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  candidate: CodexExtractionCandidateV1
  intent?: CodexExtractionAdoptionIntentV1 | null
}): Promise<AgentRunSnapshotV1> {
  if ((await adoptionFreshness(input)).fresh) return input.snapshot
  if (input.snapshot.projection.state === 'awaiting_confirmation' || input.snapshot.projection.state === 'running') {
    const snapshot = await append(input.scope, input.snapshot, 'candidate.staled', {
      stepId: CODEX_EXTRACTION_STEP_ID_V1,
      candidateHash: input.candidate.candidateHash,
      reason: 'codex-extraction-source-or-baseline-changed',
    })
    throw Object.assign(new Error('Codex 来源、分类、schema、既有词条或正式状态已变化，请重新提取。'), { snapshot })
  }
  throw new Error('Codex 提取采纳基线已变化。')
}

async function writeFormalItemsAtomic(
  scope: WorkspaceScope,
  candidate: CodexExtractionCandidateV1,
  intent: CodexExtractionAdoptionIntentV1,
): Promise<void> {
  await db.transaction('rw', scopeTransactionTables(db.codexEntries, db.codexCategories, db.agentRuns), async () => {
    const current = await readCodexExtractionBaselineV1({
      scope,
      categoryId: candidate.plan.request.categoryId,
      worldGroupId: candidate.plan.request.worldGroupId,
    })
    if (canonicalStringify(current) !== canonicalStringify(candidate.plan.baseline)) {
      throw new Error('Codex 提取 CAS 失败：分类、schema 或既有词条 baseline 已变化。')
    }
    const result = await adopt({
      projectId: scope.projectId,
      scope,
      worldGroupId: candidate.plan.request.worldGroupId,
      target: 'codexEntries',
      mode: 'add-many',
      data: intent.formalItems,
    })
    if (
      result.written.length !== intent.formalItems.length
      || result.unknown.length || result.typeErrors.length || result.fkErrors.length || result.skipped.length
    ) throw new Error(`Codex 冻结候选未完整通过注册表校验，事务已回滚：${canonicalStringify({
      written: result.written.length,
      unknown: result.unknown,
      typeErrors: result.typeErrors,
      fkErrors: result.fkErrors,
      skipped: result.skipped,
    })}`)
  })
}

export async function adoptCodexExtractionCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  selectedIndexes: number[]
  onDurableBoundary?: (boundary: CodexExtractionAdoptionBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string; written: number }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const state = await latestState(input.scope, input.runId)
  const candidate = state.candidate ?? state.intent?.candidate
  if (!candidate) throw new Error('Codex 候选不在可采纳状态。')
  let intent = state.intent
  const indexes = [...new Set(input.selectedIndexes)].sort((left, right) => left - right)
  const emptySelectionIsValid = candidate.entries.length === 0 && indexes.length === 0
  if ((!emptySelectionIsValid && !indexes.length)
    || indexes.some(index => !Number.isInteger(index) || index < 0 || index >= candidate.entries.length)) {
    throw new Error('请选择有效的 Codex 候选。')
  }
  if (intent && !sameValue(intent.selectedIndexes, indexes)) throw new Error('Codex 采纳选择与冻结意图不一致。')
  const step = snapshot.projection.steps[CODEX_EXTRACTION_STEP_ID_V1]
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash && intent) {
    const freshness = await adoptionFreshness({
      scope: input.scope, candidate, intent, requireFormalItems: true,
    })
    const adoptionHash = await hashCanonicalValue({
      intentHash: intent.intentHash,
      formal: freshness.selectedRows.map(row => row ?? null),
    })
    if (!freshness.fresh || adoptionHash !== step?.adoptionHash) {
      snapshot = await staleAgentRunVerificationV1({
        scope: input.scope, runId: snapshot.run.id, reason: 'codex-extraction-terminal-evidence-stale',
      })
      await append(input.scope, snapshot, 'candidate.staled', {
        stepId: CODEX_EXTRACTION_STEP_ID_V1, candidateHash: candidate.candidateHash,
        reason: 'codex-extraction-terminal-evidence-stale',
      })
      throw new Error('Codex 提取完成回执已过期。')
    }
    return { snapshot, receiptHash: snapshot.projection.terminalReceiptHash, written: intent.formalItems.length }
  }
  if (snapshot.projection.state === 'awaiting_confirmation') {
    snapshot = await assertAdoptionFresh({ scope: input.scope, snapshot, candidate })
    if (!intent) {
      const formalItems = indexes.map((index, order) => formalItem(
        candidate.entries[index], candidate.plan.baseline.entries.length + order, candidate.plan,
        candidate.candidateHash,
      ))
      const body = {
        version: 1 as const, kind: 'codex-extraction-adoption-intent' as const, portable: false as const,
        candidate, selectedIndexes: indexes, formalItems,
      }
      intent = { ...body, intentHash: await hashCanonicalValue(body) }
      const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: intent })
      snapshot = saved.snapshot
      await input.onDurableBoundary?.('intent.checkpoint', snapshot)
    }
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: CODEX_EXTRACTION_STEP_ID_V1, candidateHash: candidate.candidateHash, decision: 'adopt',
    })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: CODEX_EXTRACTION_STEP_ID_V1, candidateHash: candidate.candidateHash, intentHash: intent.intentHash,
    })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  } else if (step?.confirmation !== 'adopt' || !intent) {
    throw new Error('Codex 候选不在可恢复采纳状态。')
  }

  let adoptionHash = snapshot.projection.steps[CODEX_EXTRACTION_STEP_ID_V1]?.adoptionHash
  if (!adoptionHash) {
    snapshot = await assertAdoptionFresh({ scope: input.scope, snapshot, candidate, intent })
    let current = await readCodexExtractionBaselineV1({
      scope: input.scope, categoryId: candidate.plan.request.categoryId,
      worldGroupId: candidate.plan.request.worldGroupId,
    })
    if (!intent.formalItems.every(item => formalMatches(item, current.entries.find(row => row.name === item.name)))) {
      await writeFormalItemsAtomic(input.scope, candidate, intent)
      current = await readCodexExtractionBaselineV1({
        scope: input.scope, categoryId: candidate.plan.request.categoryId,
        worldGroupId: candidate.plan.request.worldGroupId,
      })
    }
    const selectedRows = intent.formalItems.map(item => current.entries.find(row => row.name === item.name))
    if (selectedRows.some((row, index) => !formalMatches(intent!.formalItems[index], row))) {
      throw new Error('Codex 采纳后正式状态与冻结意图不一致。')
    }
    await input.onDurableBoundary?.('formal.written', snapshot)
    adoptionHash = await hashCanonicalValue({
      intentHash: intent.intentHash,
      formal: selectedRows,
    })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: CODEX_EXTRACTION_STEP_ID_V1, candidateHash: candidate.candidateHash, adoptionHash,
    })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }
  const terminalFreshness = await adoptionFreshness({
    scope: input.scope, candidate, intent, requireFormalItems: true,
  })
  const selectedRows = terminalFreshness.selectedRows
  if (!terminalFreshness.fresh) {
    snapshot = await append(input.scope, snapshot, 'candidate.staled', {
      stepId: CODEX_EXTRACTION_STEP_ID_V1, candidateHash: candidate.candidateHash,
      reason: 'codex-extraction-source-or-formal-state-changed-before-terminal',
    })
    throw new Error('Codex 提取上游或正式状态在采纳后、终验前发生变化。')
  }
  if (snapshot.projection.steps[CODEX_EXTRACTION_STEP_ID_V1]?.status === 'running') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: CODEX_EXTRACTION_STEP_ID_V1, attempt: 1, outputHash: adoptionHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state === 'running') {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: CODEX_EXTRACTION_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  const postStateHash = await hashCanonicalValue(selectedRows)
  const contextManifestHashes = [
    candidate.plan.baselineContextManifestHash,
    candidate.plan.sourceContextManifestHash,
  ]
  const receipt = await createVerificationReceiptV1({
    version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes, candidateHashes: [candidate.candidateHash], adoptionEventIds: [],
    postStateHash, verifierSetVersion: CODEX_EXTRACTION_VERIFIER_SET_V1,
    criteria: [
      { id: 'codex.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'codex.author', status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: 'codex.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ], acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, receiptHash: receipt.receiptHash, written: intent.formalItems.length }
}

export async function abandonCodexExtractionV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  if (snapshot.projection.state === 'completed' || snapshot.projection.state === 'cancelled' || snapshot.projection.state === 'failed') {
    return snapshot
  }
  const state = await latestState(input.scope, input.runId).catch(() => null)
  if (state?.intent || snapshot.projection.steps[CODEX_EXTRACTION_STEP_ID_V1]?.confirmation === 'adopt') {
    throw new Error('Codex 采纳选择已冻结，不能取消；请沿同一选择继续写入与终验。')
  }
  if (snapshot.projection.state === 'awaiting_confirmation') {
    if (!state?.candidate) throw new Error('Codex 候选检查点无效。')
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: CODEX_EXTRACTION_STEP_ID_V1,
      candidateHash: state.candidate.candidateHash,
      decision: 'reject',
    })
  }
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-abandoned-codex-extraction' })
}
