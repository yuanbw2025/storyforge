import { storeReferenceProgressV1, restoreReferenceProgressV1, type StoredReferenceProgressV1 } from './progress-evidence'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1, type VerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { buildReferenceCrossRangeMessagesV1, readReferenceDerivedPromptTemplateSnapshotV1 } from './derived-agent-plan'
import { runAdaptiveReferenceRequestsV1, referenceSelectionContextV1, reviewReferenceAcrossBatchesV1, type ReferenceGlobalProgressV1 } from './adaptive-requests'
import { referenceServiceInputLimit } from './request-capacity'
import { prepareModelCapacityV1 } from '../ai/model-capacity'
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
import { resolveRequestConfig, describeResolvedAIRequestSettingsV1, type ChatResult } from '../ai/client'
import { isConfirmedProviderThrottleV1 } from '../ai/provider-rejection'
import { assembleContext } from '../registry/assemble-context'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { executeFrozenFormalAIEntryV1, freezeFormalAIEntryBindingV1 } from '../agent/formal-ai-entry'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { createContextManifestFromAssemblyV1 } from '../agent/run/context-manifest'
import { appendAgentRunEventV1, createAgentRunV1, readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { recordCreationModelRequestV1, recordCreationModelResponseV1, recordUnavailableCreationResponseV1, recordCreationNativeRequestV1, handoffCreationNativeReceiptV1 } from '../agent/run/creation-response-evidence'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { resolveWorkspaceScope } from '../workspace/ownership'
import { ANALYSIS_DIMENSIONS } from '../types/reference'
import type { AgentRunEventTypeV1 } from '../types/agent-run'
import type { WorkspaceScope } from '../types/world-ownership'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../ai/config-readiness'
import { useAIConfigStore } from '../../stores/ai-config'
import { quickHash, type ChunkPlan } from '../import/chunker'
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
        maxTokens: 0, signal: activeController.signal,
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
  const compositionHash = exactEventHash(snapshot, 'tool-result')
  const composition = compositionHash ? JSON.parse(await readAgentRunArtifactExactV1({
    projectId: scope.projectId, artifactKind: 'tool-result', contentHash: compositionHash,
  })) : null
  const raw = composition?.version === 'reference-composed-report-v1'
    ? { raw: composition.resultJson, contentHash: compositionHash!, observation: { finishReason: 'stop' } }
    : await referenceEvidence(scope, snapshot, 'raw-response')
  if (composition?.version === 'reference-composed-report-v1') {
    if (composition.sourceHash !== await hashCanonicalValue(source.chunk.text) || composition.manifestHash !== manifestHash(snapshot))
      throw new Error('分批报告来源不匹配。')
    let offset = 0
    for (const part of composition.parts) {
      if (part.start !== offset || part.end <= offset || !snapshot.events.some(event => event.type === 'evidence.artifact.recorded'
        && event.payload.artifactKind === 'raw-response' && event.payload.contentHash === part.responseHash)) throw new Error('分批报告有未处理范围或缺少原回答。')
      offset = part.end
    }
    if (offset !== source.chunk.text.length) throw new Error('分批报告未覆盖完整原文。')
  }
  if (!raw) return null
  if ('requestArtifactHash' in raw && typeof raw.requestArtifactHash === 'string') {
    const request = JSON.parse(await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: 'rendered-request', contentHash: raw.requestArtifactHash }))
    const selection = request.referenceSelection
    if (selection && (selection.phase !== 'source' || selection.start !== 0 || selection.end !== source.chunk.text.length
      || selection.sourceLength !== source.chunk.text.length || selection.rootSourceHash !== await hashCanonicalValue(source.chunk.text))) {
      throw new PartialReferenceReportError('分批请求尚未形成覆盖全部原文的派生报告；原文和每次回答仍保留，不把局部结果当作完成。')
    }
  }
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
      const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, original.run.id)
      const progress = checkpoint?.resumePayload as PrivateReferenceProgressV1 | null
      const safeProgress = progress?.kind === 'reference-private-progress-v2' && original.projection.state === 'running'
        && !original.events.some(event => event.sequence > checkpoint!.checkpoint.throughSequence + 1 && event.type === 'model.requested')
      let parsed: RawAnalysis | null = null
      try { parsed = await readReferenceReport(scope, original, source) }
      catch (error) { if (!safeProgress || !(error instanceof PartialReferenceReportError)) throw error }
      if (parsed) return parsed
      if (safeProgress) {
        await dispatchReferenceAttempt(input, source, checkpoint!)
        source = await readReferenceChunkAuthorityV1(scope, input.runId, input.chunk.index)
        continue
      }
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

class PartialReferenceReportError extends Error {}

interface PrivateReferenceProgressV1 {
  kind: 'reference-private-progress-v2'
  rootSourceHash: string
  promptPlanHash: string
  state: StoredReferenceProgressV1
}

async function dispatchReferenceAttempt(input: ReferenceChunkInput, source: BoundSource, resume?: VerifiedAgentRunCheckpointV1) {
  const scope = source.scope
  const config = { ...useAIConfigStore.getState().config, maxTokens: 0 }
  const metadata = { category: 'reference.analysis', projectId: scope.projectId, contextOverflowPolicy: 'reject' as const,
    configOverrides: { maxTokens: 0 } }
  const routing = resolveRequestConfig(config, metadata)
  const resolved = { ...routing, config: await prepareModelCapacityV1(routing.config) }
  if (!isAIConfigReady(resolved.config)) throw new Error(getAIConfigRequiredMessage(resolved.config))
  const skill = getAgentSkillV1(PRIVATE_SKILL, 'inspiration')
  const formalEntry = await freezeFormalAIEntryBindingV1(PRIVATE_ENTRY)
  const assembled = await assembleContext({ scope, projectId: scope.projectId, sourceKeys: [SOURCE],
    referenceAnalysisRunId: input.runId, referenceAnalysisChunkIndex: source.chunk.index,
    modelConfig: resolved.config, provider: resolved.config.provider, model: resolved.config.model })
  if (assembled.segments[assembled.included.indexOf(SOURCE)]?.content !== source.chunk.text)
    throw new Error('正式来源必须是完整的已确认参考原文。')
  const rootSourceHash = await hashCanonicalValue(source.chunk.text)
  const promptPlanHash = await hashCanonicalValue({ messages: referenceChunkMessages({ ...input, ref: source.ref, chunk: source.chunk }),
    global: readReferenceDerivedPromptTemplateSnapshotV1('summary') })
  const progress = resume?.resumePayload as PrivateReferenceProgressV1 | undefined
  if (resume && (progress?.kind !== 'reference-private-progress-v2' || progress.rootSourceHash !== rootSourceHash
    || progress.promptPlanHash !== promptPlanHash || progress.state?.version !== 1)) {
    throw new Error('拆书原文或内置指令已变化；旧进度完整保留，未发送后续请求。')
  }
  const link = resume ? source.latest! : { chunkIndex: source.chunk.index, ordinal: (source.latest?.ordinal ?? 0) + 1,
    claimKey: crypto.randomUUID(), agentRunId: null }
  input.signal?.throwIfAborted()
  if (!resume) await writeReferenceChunkRunLinkV1(scope, input.runId, source.chunk, source.latest, link)
  const runtimeBindingHash = await privateBinding(source, link)
  let snapshot = resume?.snapshot ?? await createAgentRunV1({ scope, contract: {
    version: 1, objective: '已确认本机原文的参考分析', workflowKind: 'read-only-audit',
    scope: { projectId: scope.projectId, worldGroupId: null }, runtimeBindingHash,
    permissions: { contextSourceKeys: [SOURCE], writeTargets: [] },
    executionBindings: [{ stepId: STEP, ...createAgentSkillExecutionBindingV1(skill), formalEntry }],
    budget: { capacityPolicy: 'service', maxModelCalls: null, maxToolCalls: 0, maxInputTokens: null, maxOutputTokens: null, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'reference.output', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'reference.terminal', kind: 'terminal', verifier: VERIFIER, criterionIds: ['reference.output'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
  } })
  if (!resume) {
    await writeReferenceChunkRunLinkV1(scope, input.runId, source.chunk, link, { ...link, agentRunId: snapshot.run.id })
    snapshot = await appendReferenceEvent(scope, snapshot, 'step.scheduled', { stepId: STEP })
    snapshot = await appendReferenceEvent(scope, snapshot, 'step.started', { stepId: STEP, attempt: 1 })
  }
  const manifest = resume ? { manifestHash: manifestHash(snapshot) } : await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId: STEP, attempt: 1,
    projectId: scope.projectId, worldGroupId: null, declaredSourceKeys: [SOURCE], assembled, readerVersion: VERIFIER })
  if (!resume) snapshot = await appendReferenceEvent(scope, snapshot, 'context.assembled', { stepId: STEP, attempt: 1, manifestHash: manifest.manifestHash })
  let result: ChatResult = { beforeModelDispatch: async () => {
    input.signal?.throwIfAborted()
    const live = await readReferenceChunkAuthorityV1(scope, input.runId, source.chunk.index)
    if (live.run.status !== 'analyzing' || live.latest?.agentRunId !== snapshot.run.id ||
      await privateBinding(live, live.latest) !== runtimeBindingHash) throw new Error('原文、作品或请求已变化，未发送。')
  } }
  let raw: string
  let currentRequest: PreparedRequest | null = null
  const restored = progress ? await restoreReferenceProgressV1({ scope, snapshot, state: progress.state, source: source.chunk.text, rootSourceHash }) : { completed: [] }
  const responseHashes = new Map<string, string>(restored.completed.map(answer => [`${answer.selection.start}:${answer.selection.end}`, answer.artifactHash!]))
  let completed = restored.completed
  const saveProgress = async (globalProgress?: ReferenceGlobalProgressV1) => {
    const stored = await storeReferenceProgressV1({ scope, snapshot, stepId: STEP, completed, globalProgress })
    snapshot = stored.snapshot
    const saved = await createAgentRunCheckpointV1({ scope, runId: snapshot.run.id,
      resumePayload: { kind: 'reference-private-progress-v2', rootSourceHash, promptPlanHash, state: stored.state } satisfies PrivateReferenceProgressV1 })
    snapshot = saved.snapshot
    listener.onActivity?.('success', `已保存 ${completed.length} 个原文分批进度${globalProgress ? '及跨范围综合进度' : ''}`)
  }
  if (!resume) await saveProgress()
  try {
    let reviewing = false
    const invoke = async (selectedMessages: import('../types').ChatMessage[], selection: import('./adaptive-requests').ReferenceRequestSelectionV1) => {
        input.signal?.throwIfAborted()
        const request = await recordCreationModelRequestV1({ scope, snapshot, stepId: STEP, attempt: 1,
          contextManifestHash: manifest.manifestHash, messages: selectedMessages,
          referenceSelection: { rootSourceHash: await hashCanonicalValue(source.chunk.text), start: selection.start, end: selection.end,
            sourceLength: selection.sourceLength, phase: reviewing ? 'review' : 'source' },
          requestSettings: describeResolvedAIRequestSettingsV1(resolved, false, { capacityPolicy: 'reference-service', responseFormat: 'json_object' }, selectedMessages),
        })
        snapshot = request.snapshot
        currentRequest = request.request
        snapshot = await appendReferenceEvent(scope, snapshot, 'model.requested', { stepId: STEP, attempt: 1,
          bindingHash: await hashCanonicalValue(selectedMessages) })
        listener.onActivity?.('info', reviewing ? '正在关联跨范围分析；原分批结果完整保留' : `正在细读原文字符 ${selection.start}—${selection.end}/${selection.sourceLength}`)
        result = { beforeModelDispatch: result.beforeModelDispatch, onCodexRequestPrepared: async binding => {
          snapshot = await recordCreationNativeRequestV1({ snapshot, request: request.request, binding })
        } }
        const answer = await executeFrozenFormalAIEntryV1('reference.analysis.private-chunk', formalEntry, skill, 'src/lib/reference-analysis/pipeline.ts',
          selectedMessages, config, { ...metadata, category: 'reference.analysis', transportRetryPolicy: 'none' }, input.signal, result,
          { capacityPolicy: 'reference-service', responseFormat: 'json_object' }, resolved)
        snapshot = await saveRawReferenceResponse(snapshot, { request: request.request, raw: answer, result })
        snapshot = await handoffCreationNativeReceiptV1({ snapshot, request: request.request, raw: answer, result })
        if (!reviewing) responseHashes.set(`${selection.start}:${selection.end}`, exactEventHash(snapshot, 'raw-response')!)
        snapshot = await appendReferenceEvent(scope, snapshot, 'model.responded', { stepId: STEP, attempt: 1,
          outputHash: exactEventHash(snapshot, 'raw-response')! })
        return { raw: answer, finishReason: result.finishReason, artifactHash: exactEventHash(snapshot, 'raw-response')! }
      }
    const answers = await runAdaptiveReferenceRequestsV1({
      source: source.chunk.text,
      completed,
      onCheckpoint: async answers => { completed = answers; await saveProgress() },
      inputLimit: referenceServiceInputLimit(resolved.config),
      messages: selection => referenceChunkMessages({ ...input, ref: source.ref,
        chunk: { ...source.chunk, text: referenceSelectionContextV1(selection) } }),
      invoke,
    })
    if (answers.length === 1) raw = answers[0].raw
    else {
      const combined: Record<string, string> = {}
      for (const answer of answers) {
        const report = JSON.parse(answer.raw) as Record<string, string>
        for (const [key, value] of Object.entries(report)) {
          if (key === 'rawExcerpt') continue
          if (typeof value !== 'string') throw new Error('分批结果字段必须为字符串。')
          combined[key] = (combined[key] ?? '') + `【原文范围 ${answer.selection.start}—${answer.selection.end}】\n${value}\n`
        }
      }
      reviewing = true
      const keys = Object.keys(combined)
      const excerpts = answers.flatMap(answer => {
        const report = JSON.parse(answer.raw) as Record<string, string>
        const quote = verifiedRawExcerpt(report.rawExcerpt, answer.selection.part)
        return quote ? [quote] : []
      })
      const globalRaw = await reviewReferenceAcrossBatchesV1({ answers, invoke,
        resume: restored.globalProgress,
        checkpoint: saveProgress,
        inputLimit: referenceServiceInputLimit(resolved.config),
        messages: selection => buildReferenceCrossRangeMessagesV1(selection, keys),
      })
      input.signal?.throwIfAborted()
      const global = JSON.parse(globalRaw) as Record<string, unknown>
      if (Object.keys(global).sort().join('|') !== [...keys].sort().join('|') || !Object.values(global).every(value => typeof value === 'string' && value.trim()))
        throw new Error('分批分析的跨范围综合协议无效；所有原回答已保留。')
      for (const key of keys) combined[key] = `【跨范围综合，基于二手分析】\n${global[key]}\n【完整分批分析】\n${combined[key]}`
      if (excerpts.length) combined.rawExcerpt = `【多处逐字引用；各段分别核实，非连续原文】\n\n${excerpts.join('\n\n')}`
      raw = JSON.stringify(combined)
      delete result.finishReason
      const parts = answers.map(answer => ({ start: answer.selection.start, end: answer.selection.end,
        responseHash: responseHashes.get(`${answer.selection.start}:${answer.selection.end}`) }))
      // Raw provider answers stay unchanged; this is explicitly a derived composition.
      const saved = await recordAgentRunArtifactV1({ scope, runId: snapshot.run.id, stepId: STEP, attempt: 1,
        artifactKind: 'tool-result', expectedLastSequence: snapshot.projection.lastSequence,
        content: JSON.stringify({ version: 'reference-composed-report-v1', resultJson: raw,
          sourceHash: await hashCanonicalValue(source.chunk.text), manifestHash: manifest.manifestHash, parts }),
      })
      snapshot = saved.snapshot
    }

  } catch (error) {
    const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, snapshot.run.id)
    const safeCheckpoint = checkpoint?.resumePayload as PrivateReferenceProgressV1 | null
    if (input.signal?.aborted && safeCheckpoint?.kind === 'reference-private-progress-v2'
      && !snapshot.events.some(event => event.sequence > checkpoint!.checkpoint.throughSequence + 1 && event.type === 'model.requested')) return
    if (!currentRequest) {
      await failReferenceAttempt(scope, snapshot, 'reference-not-dispatched', 'deterministic')
      return
    }
    const saved = await recordUnavailableCreationResponseV1({ snapshot, request: currentRequest, result, error })
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
  if (candidate.startsWith('【多处逐字引用；各段分别核实，非连续原文】\n\n')) {
    const quotes = candidate.slice('【多处逐字引用；各段分别核实，非连续原文】\n\n'.length).split(/\n\s*\n/)
    return quotes.length && quotes.every(quote => normalize(sourceText).includes(normalize(quote))) ? candidate : undefined
  }
  return normalize(sourceText).includes(normalize(candidate)) ? candidate : undefined
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
  const chunks: ChunkPlan[] = text ? [{ index: 0, startChar: 0, endChar: text.length, charCount: text.length, text }] : []
  return {
    chunks,
    totalChars: text.length,
    fileHash: quickHash(text),
    depth,
  }
}
