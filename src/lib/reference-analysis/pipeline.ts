/**
 * 参考作品·作品分析流水线（FB-5b — 13 维统一分析）
 *
 * 维度见 ANALYSIS_DIMENSIONS（reference.ts）：13 个小说维度 + 题材自适应历史维度。
 * 两档：
 *   · 浅层（quick）—— 复用导入解析已出的写作技法，写一条「全书」row，便宜。
 *   · 深层（deep） —— 逐块精读，每维含原文引用 + 全书总结，写 per-chunk rows + 断点续跑。
 *
 * 数据走向：
 *   · 每轮写入独立 ReferenceAnalysisRun + scoped referenceChunkAnalysis。
 *   · 只有作者激活的 run 同步 Reference 当前投影并进入创作上下文。
 */
import { referenceChunkMessages, type ReferenceChunkInput } from './chunk-prompt'
import { db } from '../db/schema'
import { resolveRequestConfig, type ChatResult } from '../ai/client'
import { isConfirmedProviderThrottleV1 } from '../ai/provider-rejection'
import { assembleContext } from '../registry/assemble-context'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { executeFrozenFormalAIEntryV1, freezeFormalAIEntryBindingV1 } from '../agent/formal-ai-entry'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { createContextManifestFromAssemblyV1 } from '../agent/run/context-manifest'
import { appendAgentRunEventV1, createAgentRunV1, readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { recordCreationModelRequestV1, recordCreationModelResponseV1, recordUnavailableCreationResponseV1 } from '../agent/run/creation-response-evidence'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { resolveWorkspaceScope } from '../workspace/ownership'
import { ANALYSIS_DIMENSIONS } from '../types/reference'
import type { AgentRunEventTypeV1 } from '../types/agent-run'
import type { WorkspaceScope } from '../types/world-ownership'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../ai/config-readiness'
import { useAIConfigStore } from '../../stores/ai-config'
import { chunkDocument, quickHash, type ChunkPlan } from '../import/chunker'
import type { ReferenceChunkAnalysis, ReferenceAnalysisDepth } from '../types'
import { adopt } from '../registry/adopt'
import {
  completeReferenceAnalysisRun,
  createReferenceAnalysisRun,
  getReferenceAnalysisRunChunks,
  listReferenceAnalysisRuns,
  patchReferenceAnalysisRun,
  readReferenceAnalysisChunks,
  readReferenceChunkAuthorityV1,
  writeReferenceChunkRunLinkV1,
  type ReferenceChunkRunLinkV1,
} from './lifecycle'

/** 两档:浅层(大块·轻析) / 深层(小块·深析) */
const DEPTH_PRESET: Record<ReferenceAnalysisDepth, {
  targetChars: number
  maxTokens: number
}> = {
  quick: { targetChars: 40000, maxTokens: 4096 },  // 浅层
  deep:  { targetChars: 15000, maxTokens: 8192 },  // 深层
}

const MAX_ATTEMPTS = 2
const RETRY_DELAY_MS = 1500

// ── 运行状态（单例） ────────────────────────────────────────
let activeController: AbortController | null = null
let activePaused = { value: false }
let activeRefId: number | null = null
let activeRunId: number | null = null

export interface RefAnalysisPipelineListener {
  onProgress?: (progress: number, message?: string) => void
  onActivity?: (level: 'info' | 'success' | 'warn' | 'error', message: string) => void
  onDone?: (refId: number, success: boolean, runId?: number) => void
}

let listener: RefAnalysisPipelineListener = {}

export function setRefAnalysisPipelineListener(l: RefAnalysisPipelineListener) {
  listener = l || {}
}

export function isRefAnalysisPipelineRunning(): boolean {
  return activeController !== null && !activePaused.value
}

export function getActiveRefAnalysisId(): number | null {
  return activeRefId
}

export function getActiveRefAnalysisRunId(): number | null {
  return activeRunId
}

export function cancelRefAnalysisPipeline() {
  activePaused.value = true
  activeController?.abort()
  listener.onActivity?.('warn', '✕ 用户取消分析')
}

// ── 内存分块文本缓存 ─────────────────────────────────────────
const IN_MEM_CHUNKS: Record<number, ChunkPlan[]> = {}

export function registerRefChunks(runId: number, chunks: ChunkPlan[]) {
  IN_MEM_CHUNKS[runId] = chunks
}

export function clearRefChunks(runId: number) {
  delete IN_MEM_CHUNKS[runId]
}

export function hasRefChunks(runId: number): boolean {
  return !!IN_MEM_CHUNKS[runId]?.length
}

// ── 浅层:直接用导入解析已出的 13 维写作技法,零额外 AI ──────────

/**
 * 浅层分析:把导入解析顺手产出的 13 维 writingTechniques 落成一条「全书」分析行。
 * 不额外调 AI(随导入解析免费得到),写完即 done。
 */
export async function writeShallowAnalysisFromTechniques(
  refId: number,
  wt: import('../types').WritingTechniques | undefined,
  source?: { filename?: string; fileHash?: string; totalChars?: number },
  firstStart?: import('./lifecycle').ReferenceAnalysisFirstStartGuardV1,
): Promise<void> {
  const ref = await db.references.get(refId)
  if (!ref) throw new Error(`参考 #${refId} 不存在`)
  const run = await createReferenceAnalysisRun({
    referenceId: refId,
    depth: 'quick',
    sourceFilename: source?.filename ?? ref.importedData?.sourceFilename ?? ref.title,
    fileHash: source?.fileHash ?? ref.fileHash ?? `reference-${refId}-${Date.now()}`,
    totalChars: Math.max(1, source?.totalChars ?? ref.totalChars ?? 1),
    expectedChunks: 1,
    sourceKind: 'unknown',
    usageScope: 'analysis-only',
    rightsNote: '由项目导入解析生成；尚未在版本面板补充来源声明',
    rightsConfirmed: false,
  }, firstStart)
  const w = wt || {}
  const hasAny = Object.values(w).some(v => typeof v === 'string' && v.trim())
  if (hasAny) {
    const row: ReferenceChunkAnalysis = {
      referenceId: refId,
      analysisRunId: run.id!,
      chunkIndex: 0,
      label: '全书',
      narrativeStyle: trim(w.narrativeStyle),
      openingTechnique: trim(w.openingTechnique),
      plotStructure: trim(w.plotStructure),
      pacingControl: trim(w.pacingControl),
      climaxDesign: trim(w.climaxDesign),
      conflictEscalation: trim(w.conflictEscalation),
      characterCraft: trim(w.characterCraft),
      dialogueTechnique: trim(w.dialogueTechnique),
      proseStyle: trim(w.proseStyle),
      emotionalBeats: trim(w.emotionalBeats),
      foreshadowing: trim(w.foreshadowing),
      worldBuilding: trim(w.worldBuilding),
      otherTechniques: trim(w.otherTechniques),
      createdAt: Date.now(),
    }
    await writeAnalysisRow(ref.projectId, row)
  }
  await completeReferenceAnalysisRun(
    run.id!,
    hasAny ? 1 : 0,
    hasAny ? undefined : '解析未产出写作技法,无法生成浅层分析',
  )
}

// ── 深层主入口 ─────────────────────────────────────────────────

/**
 * 跑一次参考作品深层分析(逐块深析)。
 * 前置：必须已创建 run；原文优先从 registerRefChunks() 读取，刷新后从本地 source 恢复。
 */
export async function runRefAnalysis(refId: number, requestedRunId?: number): Promise<void> {
  if (activeController) {
    listener.onActivity?.('warn', '已有参考分析正在运行，请等待或先取消')
    listener.onDone?.(refId, false, requestedRunId)
    return
  }
  let runs
  try {
    runs = await listReferenceAnalysisRuns(refId)
  } catch {
    listener.onActivity?.('error', `参考 #${refId} 不存在`)
    listener.onDone?.(refId, false, requestedRunId)
    return
  }
  const ref = await db.references.get(refId)
  if (!ref) return
  const run = requestedRunId
    ? runs.find(candidate => candidate.id === requestedRunId)
    : runs.filter(candidate => candidate.status === 'analyzing')
      .sort((a, b) => b.version - a.version)[0]
  if (!run?.id || run.referenceId !== refId) {
    listener.onActivity?.('error', '找不到待分析版本')
    listener.onDone?.(refId, false, requestedRunId)
    return
  }
  if (!['analyzing', 'failed', 'cancelled'].includes(run.status)) {
    listener.onDone?.(refId, false, run.id)
    return
  }
  const chunks = await readReferenceAnalysisChunks(run.id)
  if (!chunks || chunks.length === 0) {
    await patchReferenceAnalysisRun(run.id, {
      status: 'failed',
      error: '找不到断点原文，请重新上传文件创建新版本',
    })
    listener.onActivity?.('error', '找不到分块原文，需要重新上传')
    listener.onDone?.(refId, false, run.id)
    return
  }

  if (activeController) {
    listener.onDone?.(refId, false, run.id)
    return
  }
  const depth = run.depth
  activeController = new AbortController()
  activePaused = { value: false }
  activeRefId = refId
  activeRunId = run.id

  try {
    await patchReferenceAnalysisRun(run.id, {
      status: 'analyzing',
      progress: 0,
      error: null,
    })
    listener.onActivity?.('info', `▶ 开始分析「${ref.title}」v${run.version}，共 ${chunks.length} 块（${depth}）`)

    // 已有分析 → 断点续跑
    const existing = await getReferenceAnalysisRunChunks(refId, run.id)
    const doneSet = new Set(existing.map(r => r.chunkIndex))

    const preset = DEPTH_PRESET[depth]
    let completed = doneSet.size
    const total = chunks.length
    for (const chunk of chunks) {
      if (activePaused.value) {
        listener.onActivity?.('warn', '⏸ 分析已中止')
        await patchReferenceAnalysisRun(run.id, { status: 'cancelled', error: '用户取消' })
        listener.onDone?.(refId, false, run.id)
        return
      }
      if (doneSet.has(chunk.index)) continue

      const analysis = await analyzeChunkDurably({
        runId: run.id, ref, depth, chunk, totalChunks: total,
        maxTokens: preset.maxTokens, signal: activeController.signal,
      })
      const row: ReferenceChunkAnalysis = {
        referenceId: refId,
        analysisRunId: run.id,
        chunkIndex: chunk.index,
        label: chunk.label,
        startOffset: chunk.startChar,
        endOffset: chunk.endChar,
        // 13 小说维度
        narrativeStyle:     trim(analysis.narrativeStyle),
        openingTechnique:   trim(analysis.openingTechnique),
        plotStructure:      trim(analysis.plotStructure),
        pacingControl:      trim(analysis.pacingControl),
        climaxDesign:       trim(analysis.climaxDesign),
        conflictEscalation: trim(analysis.conflictEscalation),
        characterCraft:     trim(analysis.characterCraft),
        dialogueTechnique:  trim(analysis.dialogueTechnique),
        proseStyle:         trim(analysis.proseStyle),
        emotionalBeats:     trim(analysis.emotionalBeats),
        foreshadowing:      trim(analysis.foreshadowing),
        worldBuilding:      trim(analysis.worldBuilding),
        otherTechniques:    trim(analysis.otherTechniques),
        // 5 历史维度（仅历史题材）
        historicalContext:  trim(analysis.historicalContext),
        socialInstitutions: trim(analysis.socialInstitutions),
        dailyLife:          trim(analysis.dailyLife),
        materialCulture:    trim(analysis.materialCulture),
        languageCustoms:    trim(analysis.languageCustoms),
        rawExcerpt:         verifiedRawExcerpt(analysis.rawExcerpt, chunk.text),
        createdAt: Date.now(),
      }
      await writeAnalysisRow(ref.projectId, row)
      completed++
      const progress = Math.min(100, Math.round((completed / total) * 100))
      await patchReferenceAnalysisRun(run.id, { completedChunks: completed, progress })
      listener.onProgress?.(progress, `块 ${chunk.index + 1} 完成`)
      listener.onActivity?.('success', `✓ 块 ${chunk.index + 1} 完成`)
    }

    // 收尾
    const finalAnalyses = await getReferenceAnalysisRunChunks(refId, run.id)
    const successRatio = total > 0 ? finalAnalyses.length / total : 0
    const errMsg = successRatio < 1
      ? `共 ${total} 块，成功 ${finalAnalyses.length}，失败 ${total - finalAnalyses.length}`
      : undefined
    const finalStatus = await completeReferenceAnalysisRun(run.id, finalAnalyses.length, errMsg)
    listener.onActivity?.(finalStatus !== 'failed' ? 'success' : 'warn',
      `分析结束：${finalAnalyses.length} / ${total} 块已入库`)
    listener.onDone?.(refId, finalStatus !== 'failed', run.id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if ((err as Error).name === 'AbortError') {
      listener.onActivity?.('warn', '已中止')
      await patchReferenceAnalysisRun(run.id, { status: 'cancelled', error: '用户取消' })
    } else {
      await patchReferenceAnalysisRun(run.id, { status: 'failed', error: msg })
      listener.onActivity?.('error', `分析异常：${msg}`)
    }
    listener.onDone?.(refId, false, run.id)
  } finally {
    activeController = null
    activeRefId = null
    activeRunId = null
  }
}

// ── 十三维分析 prompt ─────────────────────────────────────────

interface RawAnalysis {
  // 13 小说维度
  narrativeStyle?: string
  openingTechnique?: string
  plotStructure?: string
  pacingControl?: string
  climaxDesign?: string
  conflictEscalation?: string
  characterCraft?: string
  dialogueTechnique?: string
  proseStyle?: string
  emotionalBeats?: string
  foreshadowing?: string
  worldBuilding?: string
  otherTechniques?: string
  // 5 历史维度
  historicalContext?: string
  socialInstitutions?: string
  dailyLife?: string
  materialCulture?: string
  languageCustoms?: string
  rawExcerpt?: string
}


const PRIVATE_ENTRY = 'reference.analysis.private-chunk'
const PRIVATE_SKILL = 'inspiration.reference-analysis-private-chunk'
const STEP = 'reference-analysis.chunk'
const SOURCE = 'referenceAnalysisPrivateChunk'
const VERIFIER = 'reference-analysis-private-chunk-v1'
const INPUT_BUDGET = 48_000

type BoundSource = Awaited<ReturnType<typeof readReferenceChunkAuthorityV1>>
type PreparedRequest = Awaited<ReturnType<typeof recordCreationModelRequestV1>>['request']
const unsavedResponses = new Map<number, { request: PreparedRequest; raw: string; result: ChatResult }>()

function appendReferenceEvent<T extends AgentRunEventTypeV1>(
  scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: T,
  payload: Parameters<typeof appendAgentRunEventV1<T>>[0]['payload'],
) {
  return appendAgentRunEventV1({ scope, runId: snapshot.run.id, type, payload,
    expectedLastSequence: snapshot.projection.lastSequence })
}

function exactEventHash(snapshot: AgentRunSnapshotV1, kind: 'raw-response' | 'tool-result' | 'rendered-request') {
  for (const event of [...snapshot.events].reverse()) {
    if (event.type === 'evidence.artifact.recorded' && event.payload.stepId === STEP
      && event.payload.attempt === 1 && event.payload.artifactKind === kind) return event.payload.contentHash
  }
  return null
}

function manifestHash(snapshot: AgentRunSnapshotV1) {
  for (const event of snapshot.events) if (event.type === 'context.assembled' && event.payload.stepId === STEP)
    return event.payload.manifestHash
  throw new Error('缺少本机参考分析上下文回执。')
}

async function privateBinding(source: BoundSource, link: ReferenceChunkRunLinkV1) {
  return hashCanonicalValue({ scope: source.scope, runId: source.run.id, referenceId: source.ref.id,
    fileHash: source.run.fileHash, sourceHash: await sha256Text(source.chunk.text),
    chunkIndex: source.chunk.index, claimKey: link.claimKey, ordinal: link.ordinal })
}

async function referenceEvidence(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, kind: 'raw-response' | 'tool-result') {
  const contentHash = exactEventHash(snapshot, kind)
  if (!contentHash) return null
  const evidence: { version?: unknown; raw?: unknown; requestArtifactHash?: unknown; contextManifestHash?: unknown;
    observation?: { finishReason?: unknown; requestLifecycle?: ChatResult['requestLifecycle'] } } = JSON.parse(
    await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: kind, contentHash }))
  if (evidence.version !== (kind === 'raw-response' ? 'creation-model-response-v1' : 'creation-model-observation-v1') ||
    !exactEventHash(snapshot, 'rendered-request') || evidence.requestArtifactHash !== exactEventHash(snapshot, 'rendered-request') ||
    evidence.contextManifestHash !== manifestHash(snapshot)) throw new Error('参考分析原答与请求证据不匹配。')
  return { ...evidence, contentHash }
}

async function saveRawReferenceResponse(snapshot: AgentRunSnapshotV1, value: NonNullable<ReturnType<typeof unsavedResponses.get>>) {
  unsavedResponses.set(snapshot.run.id, value)
  snapshot = await recordCreationModelResponseV1({ snapshot, ...value })
  unsavedResponses.delete(snapshot.run.id)
  return snapshot
}

async function failReferenceAttempt(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, code: string,
  category: 'protocol' | 'deterministic') {
  snapshot = await appendReferenceEvent(scope, snapshot, 'step.failed', { stepId: STEP, attempt: 1, code,
    retryable: false, category, action: 'fail' })
  return appendReferenceEvent(scope, snapshot, 'run.failed', { code, retryable: false })
}

async function readReferenceReport(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, source: BoundSource): Promise<RawAnalysis | null> {
  const pending = unsavedResponses.get(snapshot.run.id)
  if (pending) snapshot = await saveRawReferenceResponse(snapshot, pending)
  const raw = await referenceEvidence(scope, snapshot, 'raw-response')
  if (!raw) return null
  if (typeof raw.raw !== 'string') throw new Error('原参考分析回答格式损坏。')
  if (!snapshot.events.some(event => event.type === 'model.responded') && snapshot.projection.state === 'running')
    snapshot = await appendReferenceEvent(scope, snapshot, 'model.responded',
      { stepId: STEP, attempt: 1, outputHash: raw.contentHash })
  let analysis: RawAnalysis
  try {
    if (raw.observation?.finishReason === 'length' || raw.observation?.finishReason === 'content_filter')
      throw new Error('原回答未完整结束')
    const trimmed = raw.raw.trim()
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
    const obj: unknown = JSON.parse(fenced?.[1] ?? trimmed)
    const allowedFields = new Set<string>([...ANALYSIS_DIMENSIONS, 'rawExcerpt'])
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) ||
      !Object.keys(obj).some(key => key !== 'rawExcerpt' && allowedFields.has(key)) ||
      !Object.entries(obj).every(([key, value]) => allowedFields.has(key) && typeof value === 'string'))
      throw new Error('没有合法分析对象')
    analysis = obj as RawAnalysis
  } catch {
    if (snapshot.projection.state === 'running') await failReferenceAttempt(scope, snapshot, 'reference-protocol-invalid', 'protocol')
    throw new Error('原回答和用量已保留，但不是完整分析结果；继续只会本地重解析。')
  }
  const current = await readReferenceChunkAuthorityV1(scope, source.run.id!, source.chunk.index)
  if (current.chunk.text !== source.chunk.text || current.latest?.agentRunId !== snapshot.run.id)
    throw new Error('参考分析来源已变化，原回答保留但未写入。')
  if (snapshot.projection.steps[STEP]?.status === 'running') {
    snapshot = await appendReferenceEvent(scope, snapshot, 'step.succeeded', { stepId: STEP, attempt: 1,
      outputHash: await hashCanonicalValue(analysis) })
  }
  if (snapshot.projection.state === 'running')
    snapshot = await appendReferenceEvent(scope, snapshot, 'verification.started', { verifierSetVersion: VERIFIER })
  if (snapshot.projection.state === 'verifying') {
    const receipt = await createVerificationReceiptV1({
      version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation,
      contractHash: snapshot.projection.contractHash, contextManifestHashes: [manifestHash(snapshot)],
      candidateHashes: [], adoptionEventIds: [], postStateHash: await hashCanonicalValue(analysis),
      verifierSetVersion: VERIFIER, criteria: [{ id: 'reference.output', status: 'passed', evidenceRefs: [`raw:${raw.contentHash}`] }],
      acceptedAt: Date.now(),
    })
    await appendReferenceEvent(scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  }
  return analysis
}

async function analyzeChunkDurably(input: ReferenceChunkInput): Promise<RawAnalysis> {
  const scope = await resolveWorkspaceScope(input.ref.projectId)
  let source = await readReferenceChunkAuthorityV1(scope, input.runId, input.chunk.index)
  for (;;) {
    input.signal?.throwIfAborted()
    if (source.run.status !== 'analyzing' || source.chunk.text !== input.chunk.text)
      throw new Error('参考分析原文或授权已变化。')
    const previous = source.latest
    if (previous) {
      if (previous.agentRunId == null) throw new Error('原分析请求未结，未自动重发。')
      const original = await readAgentRunV1(scope, previous.agentRunId)
      if (original.contract.runtimeBindingHash !== await privateBinding(source, previous) ||
        original.contract.executionBindings?.find(item => item.stepId === STEP)?.formalEntry?.entryId !== PRIVATE_ENTRY)
        throw new Error('原参考分析运行不属于当前原文块。')
      const parsed = await readReferenceReport(scope, original, source)
      if (parsed) return parsed
      const observation = await referenceEvidence(scope, original, 'tool-result')
      const throttled = observation?.observation?.requestLifecycle?.phase === 'response-observed'
        && observation.observation.requestLifecycle.responseStatus === 429
        && original.events.some(event => event.type === 'run.failed' && event.payload.code === 'reference-rate-limit-confirmed')
      if (!throttled) {
        const lifecycle = observation?.observation?.requestLifecycle
        const status = lifecycle?.responseStatus
        if (lifecycle?.phase === 'pre-dispatch') throw new Error('原请求未发出；请核对配置或来源后新建分析版本。')
        if (lifecycle?.phase === 'response-observed' && status != null && status >= 400 && status < 500 && status !== 408)
          throw new Error(`服务拒绝请求（${status}），未自动重发。`)
        throw new Error('原请求结果未知，未自动重发。')
      }
      if (previous.ordinal >= MAX_ATTEMPTS) throw new Error('服务限流，已用尽明确重试额度。')
      listener.onActivity?.('warn', '服务已明确限流；等待一次有界重试。')
      await sleep(RETRY_DELAY_MS)
    }
    input.signal?.throwIfAborted()
    await dispatchReferenceAttempt(input, source)
    source = await readReferenceChunkAuthorityV1(scope, input.runId, input.chunk.index)
  }
}

async function dispatchReferenceAttempt(input: ReferenceChunkInput, source: BoundSource) {
  const scope = source.scope
  const config = { ...useAIConfigStore.getState().config, maxTokens: input.maxTokens }
  const metadata = { category: 'reference.analysis', projectId: scope.projectId, contextOverflowPolicy: 'reject' as const,
    configOverrides: { maxTokens: input.maxTokens } }
  const resolved = resolveRequestConfig(config, metadata)
  if (!isAIConfigReady(resolved.config)) throw new Error(getAIConfigRequiredMessage(resolved.config))
  const skill = getAgentSkillV1(PRIVATE_SKILL, 'inspiration')
  const formalEntry = await freezeFormalAIEntryBindingV1(PRIVATE_ENTRY)
  const assembled = await assembleContext({ scope, projectId: scope.projectId, sourceKeys: [SOURCE],
    referenceAnalysisRunId: input.runId, referenceAnalysisChunkIndex: source.chunk.index, inputBudgetMaxTokens: INPUT_BUDGET,
    modelConfig: resolved.config, provider: resolved.config.provider, model: resolved.config.model })
  if (assembled.segments[assembled.included.indexOf(SOURCE)]?.content !== source.chunk.text)
    throw new Error('正式来源必须是完整的已确认参考原文。')
  const messages = referenceChunkMessages({ ...input, ref: source.ref, chunk: source.chunk })
  const link = { chunkIndex: source.chunk.index, ordinal: (source.latest?.ordinal ?? 0) + 1,
    claimKey: crypto.randomUUID(), agentRunId: null }
  input.signal?.throwIfAborted()
  await writeReferenceChunkRunLinkV1(scope, input.runId, source.chunk, source.latest, link)
  const runtimeBindingHash = await privateBinding(source, link)
  let snapshot = await createAgentRunV1({ scope, contract: {
    version: 1, objective: '已确认本机原文的参考分析', workflowKind: 'read-only-audit',
    scope: { projectId: scope.projectId, worldGroupId: null }, runtimeBindingHash,
    permissions: { contextSourceKeys: [SOURCE], writeTargets: [] },
    executionBindings: [{ stepId: STEP, ...createAgentSkillExecutionBindingV1(skill), formalEntry }],
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: INPUT_BUDGET, maxOutputTokens: input.maxTokens, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'reference.output', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'reference.terminal', kind: 'terminal', verifier: VERIFIER, criterionIds: ['reference.output'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
  } })
  await writeReferenceChunkRunLinkV1(scope, input.runId, source.chunk, link, { ...link, agentRunId: snapshot.run.id })
  snapshot = await appendReferenceEvent(scope, snapshot, 'step.scheduled', { stepId: STEP })
  snapshot = await appendReferenceEvent(scope, snapshot, 'step.started', { stepId: STEP, attempt: 1 })
  const manifest = await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId: STEP, attempt: 1,
    projectId: scope.projectId, worldGroupId: null, declaredSourceKeys: [SOURCE], assembled, readerVersion: VERIFIER })
  snapshot = await appendReferenceEvent(scope, snapshot, 'context.assembled', { stepId: STEP, attempt: 1, manifestHash: manifest.manifestHash })
  const prepared = await recordCreationModelRequestV1({ scope, snapshot, stepId: STEP, attempt: 1,
    contextManifestHash: manifest.manifestHash, messages })
  snapshot = await appendReferenceEvent(scope, prepared.snapshot, 'model.requested', { stepId: STEP, attempt: 1,
    bindingHash: await hashCanonicalValue({ runtimeBindingHash, formalEntry, manifestHash: manifest.manifestHash,
      provider: resolved.config.provider, model: resolved.config.model }) })
  const result: ChatResult = { beforeModelDispatch: async () => {
    input.signal?.throwIfAborted()
    const live = await readReferenceChunkAuthorityV1(scope, input.runId, source.chunk.index)
    if (live.run.status !== 'analyzing' || live.latest?.agentRunId !== snapshot.run.id ||
      await privateBinding(live, live.latest) !== runtimeBindingHash) throw new Error('原文、作品或请求已变化，未发送。')
  } }
  let raw: string
  try {
    raw = await executeFrozenFormalAIEntryV1('reference.analysis.private-chunk', formalEntry, skill, 'src/lib/reference-analysis/pipeline.ts',
      messages, config, { ...metadata, category: 'reference.analysis' }, input.signal, result, undefined, resolved)
  } catch (error) {
    const saved = await recordUnavailableCreationResponseV1({ snapshot, request: prepared.request, result, error })
    const lifecycle = result.requestLifecycle
    const status = lifecycle?.responseStatus ?? null
    if (lifecycle?.phase === 'pre-dispatch' || (lifecycle?.phase === 'response-observed' && status != null &&
      status >= 400 && status < 500 && status !== 408)) {
      const throttled = lifecycle.phase === 'response-observed' && status != null && isConfirmedProviderThrottleV1({
        status, message: error instanceof Error ? error.message : '',
      })
      await failReferenceAttempt(scope, saved.snapshot, throttled ? 'reference-rate-limit-confirmed' :
        lifecycle.phase === 'pre-dispatch' ? 'reference-not-dispatched' : 'reference-provider-rejected', 'deterministic')
    } else {
      await appendReferenceEvent(scope, saved.snapshot, 'run.paused', { reason: 'reference-model-outcome-unknown', recoverable: false })
    }
    return
  }
  await saveRawReferenceResponse(snapshot, { request: prepared.request, raw, result })
}

async function writeAnalysisRow(projectId: number, row: ReferenceChunkAnalysis): Promise<void> {
  // createdAt is an adoption-owned stamp.  The current candidate contract must
  // not carry persistence metadata merely because the stored row type does.
  const { createdAt: _createdAt, id: _id, ...candidate } = row
  const result = await adopt({
    projectId,
    target: 'referenceChunkAnalysis',
    mode: 'add',
    data: candidate as unknown as Record<string, unknown>,
  })
  if (result.written.length === 0) {
    throw new Error(`参考分析写回被拒绝: ${result.skipped[0]?.reason
      ?? result.typeErrors[0]?.field
      ?? result.unknown[0]
      ?? result.fkErrors[0]?.field
      ?? 'unknown'}`)
  }
}

function trim(s: string | undefined): string | undefined {
  if (typeof s !== 'string') return undefined
  const t = s.trim()
  return t || undefined
}

/** 只保留能在本块原文中找到的逐字引用（允许空白差异），拒绝 AI 幻觉引文。 */
export function verifiedRawExcerpt(excerpt: string | undefined, sourceText: string): string | undefined {
  const candidate = trim(excerpt)?.replace(/^[“"'‘]+|[”"'’]+$/g, '').trim()
  if (!candidate) return undefined
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()
  return normalize(sourceText).includes(normalize(candidate)) ? candidate.slice(0, 500) : undefined
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// ── 给 UI 用的便利函数 ─────────────────────────────────────

export interface PlanChunksResult {
  chunks: ChunkPlan[]
  totalChars: number
  fileHash: string
  depth: ReferenceAnalysisDepth
}

/** 把文本按深度分块，用于 UI 预览块数 */
export function planRefChunks(text: string, depth: ReferenceAnalysisDepth): PlanChunksResult {
  const preset = DEPTH_PRESET[depth]
  const chunks = chunkDocument(text, { targetChars: preset.targetChars })
  return {
    chunks,
    totalChars: text.length,
    fileHash: quickHash(text),
    depth,
  }
}
