import { hashDocumentImportChunkBindingV1 } from './document-parse-binding'
/** Candidate-only foundation. The current import UI does not dispatch through
 * this entry until it can show and explicitly adopt its recovered candidate. */
import {
  bindImportChunkParseRunV1, hashImportChunkTextV1, readImportSessionAuthorityInTransactionV1,
  readImportSessionAuthorityV1, reserveImportChunkParseV1,
} from '../../stores/import-session'
import Dexie from 'dexie'
import { db } from '../db/schema'
import { useAIConfigStore } from '../../stores/ai-config'
import { useCodexStore } from '../../stores/codex'
import { usePromptStore } from '../../stores/prompt'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../ai/config-readiness'
import { resolveRequestConfig, type ChatResult } from '../ai/client'
import { modelDispatchWasCancelledV1 } from '../ai/codex-transport'
import { renderPrompt } from '../ai/prompt-engine'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { executeFrozenFormalAIEntryV1, freezeFormalAIEntryBindingV1 } from '../agent/formal-ai-entry'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { createAgentRunCheckpointInTransactionV1, readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { createContextManifestFromAssemblyV1 } from '../agent/run/context-manifest'
import {
  recordCreationModelRequestV1, recordCreationModelResponseV1, recordUnavailableCreationResponseV1,
} from '../agent/run/creation-response-evidence'
import {
  agentRunScopeTransactionTablesV1, appendAgentRunEventV1, appendPrivilegedAgentRunEventInTransactionV1,
  createAgentRunV1, readAgentRunV1, readVerifiedAgentRunInTransactionV1, withAgentRunMutationLockV1,
  type AgentRunSnapshotV1,
} from '../agent/run/event-store'
import { parseAgentRunEventV1 } from '../agent/run/event-schema'
import { hashCanonicalValue } from '../agent/run/hash'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { assembleContext } from '../registry/assemble-context'
import type { UnifiedParseResult, WorkspaceScope } from '../types'
import type { ExactRunArtifactKindV1 } from '../types/memory-engineering'
import { formatCodexImportCatalog, type CodexImportCategoryOption } from './codex-classification'
import { getChunkText } from './chunk-text-registry'
import { normalizeUnified } from './unified-merge'

const STEP = 'document-import.parse'
const SKILL = 'inspiration.document-import-parse'
const MAX_INPUT_TOKENS = 100_000
const ATTEMPT = 1
const CATEGORIES = 'documentImportCodexCategories'
const SHA = /^[a-f0-9]{64}$/

interface ChunkInput { projectId: number; sessionId: number; chunkIndex: number }
type Session = Awaited<ReturnType<typeof readImportSessionAuthorityV1>> & { id: number }

export interface DocumentImportChunkCandidateV1 {
  version: 1
  kind: 'document-import-chunk-candidate'
  portable: false
  sessionId: number
  chunkIndex: number
  sourceTextHash: string
  runId: number
  rawArtifactHash: string
  result: UnifiedParseResult
  candidateHash: string
}

function fail(message: string): never { throw new Error('[document-import-parse] ' + message) }

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseCandidateOutput(raw: string, finishReason: ChatResult['finishReason'],
  text: string, chunkIndex: number, categories: readonly Pick<CodexImportCategoryOption, 'ref' | 'fields'>[]): UnifiedParseResult {
  if (finishReason === 'length' || finishReason === 'content_filter') fail('原回复未完整结束；已保存原证据，不能生成候选。')
  const trimmed = raw.trim()
  // The active prompt permits a complete JSON fence. Do not repair an
  // unclosed/partial object or parse a JSON excerpt out of narrative text.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  const value: unknown = JSON.parse(fence?.[1] ?? trimmed)
  const objectFields = ['worldview', 'geography', 'history', 'writingTechniques']
  const arrayFields = ['characters', 'outline', 'codexCandidates']
  if (!plainObject(value) || !Object.keys(value).length || Object.keys(value).some(key => {
    if (objectFields.includes(key)) return !plainObject(value[key])
    if (arrayFields.includes(key)) return !Array.isArray(value[key]) || value[key].some(item => !plainObject(item))
    return true
  })) fail('原回复不是预期的完整导入对象。')
  return normalizeUnified(value, { sourceText: text, chunkIndex, options: categories })
}

function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: unknown) {
  return appendAgentRunEventV1({ scope, runId: snapshot.run.id, type, payload,
    expectedLastSequence: snapshot.projection.lastSequence } as Parameters<typeof appendAgentRunEventV1>[0])
}

function artifactHash(snapshot: AgentRunSnapshotV1, kind: ExactRunArtifactKindV1) {
  return [...snapshot.events].reverse().find(event => event.type === 'evidence.artifact.recorded' &&
    event.payload.artifactKind === kind && event.payload.stepId === STEP && event.payload.attempt === ATTEMPT)
}

function evidenceHash(snapshot: AgentRunSnapshotV1, kind: ExactRunArtifactKindV1): string | null {
  const event = artifactHash(snapshot, kind)
  return event?.type === 'evidence.artifact.recorded' ? event.payload.contentHash : null
}

async function sessionFor(input: ChunkInput): Promise<Session> {
  if (!Number.isSafeInteger(input.chunkIndex) || input.chunkIndex < 0) fail('分块编号无效。')
  const row = await readImportSessionAuthorityV1(input.sessionId, input.projectId)
  if (row.id !== input.sessionId || row.chunks[input.chunkIndex]?.index !== input.chunkIndex)
    fail('未找到原分块。')
  return { ...row, id: input.sessionId }
}

function bindingHash(session: Session, index: number, claimKey: string) {
  return hashDocumentImportChunkBindingV1(session, index, claimKey)
}

function expectedParseEntryId(session: { importTarget: string }) {
  if (session.importTarget === 'reference') return 'import.reference-chunk.parse.private' as const
  if (session.importTarget === 'project') return 'import.document-chunk.parse' as const
  fail('原导入目标无效，不能猜测解析权限。')
}

async function markFailed(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, code: string,
  category: 'deterministic' | 'protocol') {
  snapshot = await append(scope, snapshot, 'step.failed', { stepId: STEP, attempt: ATTEMPT, code,
    retryable: false, category, action: 'fail' })
  return append(scope, snapshot, 'run.failed', { code, retryable: false })
}

export async function createDocumentImportChunkCandidateV1(input: ChunkInput & { signal?: AbortSignal; sourceText?: string }): Promise<DocumentImportChunkCandidateV1> {
  input = { ...input }
  input.signal?.throwIfAborted()
  const session = await sessionFor(input), scope = session.targetScope
  const chunk = session.chunks[input.chunkIndex]
  if (chunk.durableParse) fail('原分块已有候选或尝试记录；请读取原证据，不能再次发送。')
  const text = input.sourceText ?? getChunkText(session.id, input.chunkIndex)
  if (!text || !chunk.sourceTextHash || await hashImportChunkTextV1(text) !== chunk.sourceTextHash)
    fail('当前分块不是已确认原文件。')
  const config = structuredClone(useAIConfigStore.getState().config)
  const skill = getAgentSkillV1(SKILL, 'inspiration')
  const metadata = { category: 'import.parse-chunk', projectId: input.projectId, contextOverflowPolicy: 'reject' as const,
    configOverrides: { maxTokens: skill.maxOutputTokens } }
  const resolved = resolveRequestConfig(config, metadata)
  if (!isAIConfigReady(resolved.config)) fail(getAIConfigRequiredMessage(resolved.config))
  // A fresh World may reach document import before opening Codex. Initialize its
  // built-in definitions through the store before the registered read-only source.
  if (session.importTarget === 'project') await useCodexStore.getState().ensureBuiltIns(scope)
  const worldGroupId = session.targetWorldGroupId ?? null
  const sourceKeys = session.importTarget === 'project' ? ['manualText', CATEGORIES] : ['manualText']
  const assembled = await assembleContext({ scope, projectId: input.projectId, worldGroupId, sourceKeys,
    documentImportSessionId: session.id, manualSourceText: text, inputBudgetMaxTokens: MAX_INPUT_TOKENS,
    provider: resolved.config.provider, model: resolved.config.model })
  const originalSegment = assembled.segments[assembled.included.indexOf('manualText')]
  if (originalSegment?.content !== text)
    fail('正式来源必须完整交付本块原文，不能以截断材料发送。')
  const categoryText = assembled.segments[assembled.included.indexOf(CATEGORIES)]?.content
  if (session.importTarget === 'project' && !categoryText) fail('本次导入未能核对已登记词条类别。')
  const categories: Pick<CodexImportCategoryOption, 'ref' | 'fields' | 'label'>[] = categoryText ? JSON.parse(categoryText) : []
  const { messages } = renderPrompt(usePromptStore.getState().getActive('import.parse-chunk'), {
    chunkIndex: input.chunkIndex + 1, totalChunks: session.totalChunks, knownContext: '无：仅阅读本块已确认原文。',
    codexCategoryCatalog: formatCodexImportCatalog(categories) || '不提供目录；请返回空的 codexCandidates。', rawDocument: text,
  })
  if (!messages.some(message => message.content.includes(text))) fail('原分块没有逐字进入请求。')
  const entryId = expectedParseEntryId(session)
  const formalEntry = entryId === 'import.reference-chunk.parse.private'
    ? await freezeFormalAIEntryBindingV1('import.reference-chunk.parse.private')
    : await freezeFormalAIEntryBindingV1('import.document-chunk.parse')
  input.signal?.throwIfAborted()
  const claimKey = await reserveImportChunkParseV1(session, input.chunkIndex)
  const runtimeBindingHash = await bindingHash(session, input.chunkIndex, claimKey)
  let snapshot = await createAgentRunV1({
    scope, worldGroupId,
    contract: {
      version: 1, objective: '从已确认的原文分块提取候选', workflowKind: 'direct-generation',
      scope: { projectId: input.projectId, worldGroupId },
      permissions: { contextSourceKeys: sourceKeys, writeTargets: [] },
      runtimeBindingHash,
      executionBindings: [{ stepId: STEP, ...createAgentSkillExecutionBindingV1(skill), formalEntry }],
      budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: MAX_INPUT_TOKENS,
        maxOutputTokens: skill.maxOutputTokens, maxAttemptsPerStep: 1 },
      acceptance: [{ id: 'document-import.candidate', kind: 'output-present', required: true },
        { id: 'document-import.author', kind: 'author-confirmed', required: true }],
      verificationPlan: [{ id: 'document-import.terminal', kind: 'terminal', verifier: 'document-import-terminal-v1',
        criterionIds: ['document-import.candidate', 'document-import.author'] }],
      failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
    },
  })
  await bindImportChunkParseRunV1(session, input.chunkIndex, claimKey, snapshot.run.id)
  snapshot = await append(scope, snapshot, 'step.scheduled', { stepId: STEP })
  snapshot = await append(scope, snapshot, 'step.started', { stepId: STEP, attempt: ATTEMPT })
  const manifest = await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId: STEP, attempt: ATTEMPT,
    projectId: input.projectId, worldGroupId, declaredSourceKeys: sourceKeys, assembled, readerVersion: 'document-import-parse-v2' })
  snapshot = await append(scope, snapshot, 'context.assembled', { stepId: STEP, attempt: ATTEMPT, manifestHash: manifest.manifestHash })
  const prepared = await recordCreationModelRequestV1({ scope, snapshot, stepId: STEP, attempt: ATTEMPT,
    contextManifestHash: manifest.manifestHash, messages })
  const wireBindingHash = await hashCanonicalValue({ runtimeBindingHash, formalEntry, manifestHash: manifest.manifestHash,
    provider: resolved.config.provider, model: resolved.config.model })
  snapshot = await append(scope, prepared.snapshot, 'model.requested', { stepId: STEP, attempt: ATTEMPT, bindingHash: wireBindingHash })
  const guard = async (readAuthority: typeof readImportSessionAuthorityInTransactionV1 = readImportSessionAuthorityV1) => {
    input.signal?.throwIfAborted()
    const current = await readAuthority(session.id, input.projectId, session)
    const link = current.chunks[input.chunkIndex]?.durableParse
    if (current.status === 'cancelled' || current.status === 'done' || link?.claimKey !== claimKey || link.runId !== snapshot.run.id ||
      getChunkText(session.id, input.chunkIndex) !== text) fail('原分块或落点已变化。')
    input.signal?.throwIfAborted()
  }
  // The frozen entry validates its digest asynchronously. The shared transport
  // repeats this per-call guard after that preparation, at the actual POST.
  const result: ChatResult = { beforeModelDispatch: () => guard() }
  try { await guard() } catch (error) {
    result.requestLifecycle = { phase: 'pre-dispatch', responseStatus: null }
    const retained = await recordUnavailableCreationResponseV1({ snapshot, request: prepared.request, result, error })
    await markFailed(scope, retained.snapshot, 'import-owner-changed-before-dispatch', 'deterministic')
    throw retained.report
  }
  let raw: string
  try {
    raw = entryId === 'import.reference-chunk.parse.private'
      ? await executeFrozenFormalAIEntryV1('import.reference-chunk.parse.private', formalEntry, skill,
      'src/lib/import/document-parse-durable.ts', messages, config, { ...metadata, category: 'import.parse-chunk' },
      input.signal, result, resolved.config.provider === 'deepseek' ? { responseFormat: 'json_object', thinkingMode: 'disabled' } : undefined, resolved)
      : await executeFrozenFormalAIEntryV1('import.document-chunk.parse', formalEntry, skill,
      'src/lib/import/document-parse-durable.ts', messages, config, { ...metadata, category: 'import.parse-chunk' },
      input.signal, result, resolved.config.provider === 'deepseek' ? { responseFormat: 'json_object', thinkingMode: 'disabled' } : undefined, resolved)
  } catch (error) {
    const retained = await recordUnavailableCreationResponseV1({ snapshot, request: prepared.request, result, error })
    if (modelDispatchWasCancelledV1(result) || result.requestLifecycle?.phase === 'pre-dispatch') {
      await markFailed(scope, retained.snapshot, 'import-model-stopped-before-dispatch', 'deterministic')
    } else if (result.requestLifecycle?.phase === 'response-observed' && (result.requestLifecycle.responseStatus ?? 0) >= 400) {
      await markFailed(scope, retained.snapshot, 'import-provider-rejected', 'deterministic')
    } else {
      await append(scope, retained.snapshot, 'run.paused', { reason: 'document-import-model-outcome-unknown', recoverable: false })
    }
    throw retained.report
  }
  snapshot = await recordCreationModelResponseV1({ snapshot, request: prepared.request, raw, result })
  const rawArtifactHash = evidenceHash(snapshot, 'raw-response')
  if (!rawArtifactHash) fail('原响应证据缺失，不能生成候选。')
  snapshot = await append(scope, snapshot, 'model.responded', { stepId: STEP, attempt: ATTEMPT, outputHash: rawArtifactHash })
  try { await guard() } catch (error) {
    await append(scope, snapshot, 'run.paused', { reason: 'document-import-source-changed-after-response', recoverable: false })
    throw error
  }
  let parsed: UnifiedParseResult
  try { parsed = parseCandidateOutput(raw, result.finishReason, text, input.chunkIndex, categories) } catch {
    await markFailed(scope, snapshot, 'document-import-protocol-rejected', 'protocol')
    fail('文档模型未返回可采纳的完整 JSON；原答和实际用量已保留，不会自动重发。')
  }
  const body = { version: 1 as const, kind: 'document-import-chunk-candidate' as const, portable: false as const,
    sessionId: session.id, chunkIndex: input.chunkIndex, sourceTextHash: chunk.sourceTextHash,
    runId: snapshot.run.id, rawArtifactHash, result: parsed }
  const candidate = { ...body, candidateHash: await hashCanonicalValue(body) }
  const runId = snapshot.run.id
  await withAgentRunMutationLockV1(runId, () => db.transaction('rw',
    agentRunScopeTransactionTablesV1(runId, db.importSessions, db.worldGroups,
      db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints), async () => {
      // Keep the source/owner check, checkpoint, and public candidate event in
      // one transaction. A stopped write leaves only the paid evidence above.
      await Dexie.waitFor(guard(readImportSessionAuthorityInTransactionV1))
      const live = await Dexie.Promise.resolve(readVerifiedAgentRunInTransactionV1(scope, runId))
      if (live.projection.lastSequence !== snapshot.projection.lastSequence) fail('候选运行已变化。')
      const saved = await Dexie.Promise.resolve(createAgentRunCheckpointInTransactionV1({ snapshot: live, resumePayload: candidate }))
      await Dexie.Promise.resolve(appendPrivilegedAgentRunEventInTransactionV1(saved.snapshot, parseAgentRunEventV1({
        version: 1, type: 'candidate.persisted', runId, sequence: saved.snapshot.projection.lastSequence + 1,
        generation: live.run.generation, contractHash: live.run.contractHash, projectId: scope.projectId,
        worldGroupId, createdAt: Date.now(), payload: { stepId: STEP, attempt: ATTEMPT,
          candidateHash: candidate.candidateHash, requiresConfirmation: true },
      })))
    }))
  return candidate
}

/** Read only. A pending/unknown Run never creates a replacement attempt. */
export async function readDocumentImportChunkEvidenceV1(input: ChunkInput) {
  input = { ...input }
  const session = await sessionFor(input)
  const chunk = session.chunks[input.chunkIndex]
  const link = chunk.durableParse
  if (!link) return null
  if (link.runId === null) return { state: 'preparing' as const, candidate: null, raw: null, observation: null }
  const scope = session.targetScope
  const snapshot = await readAgentRunV1(scope, link.runId)
  const entryId = snapshot.contract.executionBindings?.find(item => item.stepId === STEP)?.formalEntry?.entryId
  const expectedEntry = expectedParseEntryId(session)
  // Historical shared reference entries require the exact original binding.
  // Every new reference send instead freezes its dedicated private entry.
  const legacyReference = expectedEntry === 'import.reference-chunk.parse.private' && entryId === 'import.document-chunk.parse'
  if (snapshot.contract.runtimeBindingHash !== await bindingHash(session, input.chunkIndex, link.claimKey) ||
    (entryId !== expectedEntry && !legacyReference))
    fail('原候选运行不属于这份分块或原导入目标。')
  const renderedHash = evidenceHash(snapshot, 'rendered-request')
  const assembled = snapshot.events.find(event => event.type === 'context.assembled' &&
    event.payload.stepId === STEP && event.payload.attempt === ATTEMPT)
  const manifestHash = assembled?.type === 'context.assembled' ? assembled.payload.manifestHash : null
  async function readExact(kind: 'raw-response' | 'tool-result') {
    const contentHash = evidenceHash(snapshot, kind)
    if (!contentHash) return null
    const payload: unknown = JSON.parse(await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: kind, contentHash }))
    const version = kind === 'raw-response' ? 'creation-model-response-v1' : 'creation-model-observation-v1'
    if (!plainObject(payload) || payload.version !== version || !renderedHash || !manifestHash ||
      payload.requestArtifactHash !== renderedHash || payload.contextManifestHash !== manifestHash)
      fail('原尝试证据与已记录请求或上下文不匹配。')
    return payload
  }
  const rawEvidence = await readExact('raw-response')
  const metering = await readExact('tool-result')
  const projectedHash = snapshot.projection.steps[STEP]?.candidateHash
  const checkpoint = projectedHash && await readLatestVerifiedAgentRunCheckpointV1(scope, link.runId)
  if (projectedHash && !checkpoint) fail('原运行声明的候选没有可验证的恢复点。')
  let candidate: DocumentImportChunkCandidateV1 | null = null
  if (checkpoint) {
    const payload: unknown = checkpoint.resumePayload
    if (!plainObject(payload) || payload.version !== 1 || payload.kind !== 'document-import-chunk-candidate' ||
      payload.portable !== false || payload.sessionId !== session.id || payload.chunkIndex !== input.chunkIndex ||
      payload.sourceTextHash !== chunk.sourceTextHash || payload.runId !== link.runId ||
      typeof payload.rawArtifactHash !== 'string' || payload.rawArtifactHash !== evidenceHash(snapshot, 'raw-response') ||
      typeof payload.candidateHash !== 'string' || !SHA.test(payload.candidateHash) || !plainObject(payload.result))
      fail('原候选与当前分块或逐字证据不匹配。')
    const { candidateHash, ...body } = payload
    if (await hashCanonicalValue(body) !== candidateHash || projectedHash !== candidateHash)
      fail('原候选证据 hash 不匹配。')
    candidate = payload as unknown as DocumentImportChunkCandidateV1
  }
  return { state: snapshot.projection.state, candidate,
    raw: typeof rawEvidence?.raw === 'string' ? rawEvidence.raw : null,
    observation: rawEvidence?.observation ?? metering?.observation ?? null }
}
