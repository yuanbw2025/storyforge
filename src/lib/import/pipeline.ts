/** File admission and explicit progress for the author-confirmed import. */
import {
  cancelImportSessionInScopeV1, claimImportedReferenceAnalysisInTransactionV1, importedReferenceAnalysisStartTablesV1, hashImportChunkTextV1, ImportSessionAuthorityError, ImportSessionUnavailableError,
  readImportSessionAuthorityV1, verifyImportProjectTargetGroupV1, useImportSessionStore,
} from '../../stores/import-session'
import { useImportStatusStore } from '../../stores/import-status'
import type { ImportSession } from '../types'
import {
  registerChunkTexts as _registerChunkTexts,
  hasChunkTexts as _hasChunkTexts,
  clearChunkTexts as _clearChunkTexts,
  getChunkText,
} from './chunk-text-registry'
import { applyChunkResult, type ApplyChunkCounts } from './chunk-writer'
import { createDocumentImportChunkCandidateV1, readDocumentImportChunkEvidenceV1 } from './document-parse-durable'
import { importedReferenceDataV1, useReferenceStore } from '../../stores/reference'
import {
  writeShallowAnalysisFromTechniques,
  registerRefChunks,
  runRefAnalysis,
} from '../reference-analysis/pipeline'
import { createReferenceAnalysisRun, listReferenceAnalysisRuns, type ReferenceAnalysisFirstStartGuardV1 } from '../reference-analysis/lifecycle'
import { runCharacterMerge } from './character-merge'

// 保留原有 API：UI / 其他模块一直从 pipeline 引入这三个函数。
export const registerChunkTexts = _registerChunkTexts
export const hasChunkTexts = _hasChunkTexts
export const clearChunkTexts = _clearChunkTexts

/** 控制器：用户暂停 / 取消时切给 pipeline */
let activeController: AbortController | null = null
let activePauseFlag = { paused: false, cancelled: false }

export function pausePipeline() {
  activePauseFlag.paused = true
  activeController?.abort()
  useImportStatusStore.getState().setPhase('paused')
  useImportStatusStore.getState().pushActivity('warn', '⏸ 用户暂停')
}

export function cancelPipeline() {
  activePauseFlag.paused = true
  activePauseFlag.cancelled = true
  activeController?.abort()
  useImportStatusStore.getState().setPhase('idle')
  useImportStatusStore.getState().pushActivity('warn', '✕ 用户取消任务')
}

export function isPipelineRunning() {
  return activeController !== null && !activePauseFlag.paused
}

/** Capture all strings synchronously so later registry replacement cannot change the admitted input. */
async function captureImportSource(session: ImportSession): Promise<ReadonlyMap<number, string>> {
  const captured = new Map<number, string>()
  for (const chunk of session.chunks) {
    const text = getChunkText(session.id!, chunk.index)
    if (captured.has(chunk.index) || !text)
      throw new ImportSessionAuthorityError('分块原文不完整；请重新上传原文件后继续。')
    captured.set(chunk.index, text)
  }
  for (const chunk of session.chunks) {
    if (await hashImportChunkTextV1(captured.get(chunk.index)!) !== chunk.sourceTextHash)
      throw new ImportSessionAuthorityError('分块原文与已确认文件不一致；请上传原文件重新核对。')
  }
  return captured
}

export async function readPendingDocumentImportV1(input: { sessionId: number; projectId: number }) {
  const session = await readImportSessionAuthorityV1(input.sessionId, input.projectId)
  const first = session.chunks.find(chunk => chunk.status !== 'done')
  if (!first?.durableParse || session.status === 'cancelled') return null
  return readDocumentImportChunkEvidenceV1({ ...input, chunkIndex: first.index })
}

/** An explicit start/continue can submit at most one previously unsent chunk.
 * Pending/unknown/returned attempts are read-only and never replayed. */
export async function runSession(args: { sessionId: number; projectId: number }): Promise<void> {
  args = { ...args }
  const { sessionId, projectId } = args
  const sessionStore = useImportSessionStore.getState()
  const status = useImportStatusStore.getState()
  if (activeController) throw new ImportSessionAuthorityError('已有导入任务在处理，请稍后继续。')
  const session = await readImportSessionAuthorityV1(sessionId, projectId)
  if (activeController) throw new ImportSessionAuthorityError('已有导入任务在处理，请稍后继续。')
  if (session.status === 'cancelled' || session.status === 'done')
    throw new ImportSessionAuthorityError('已结束的导入不能再次发送模型请求。')
  const first = session.chunks.find(chunk => chunk.status !== 'done')
  const attach = (phase: 'running' | 'paused' | 'failed' | 'done') => status.attachSession({
    sessionId, filename: session.filename, totalChunks: session.totalChunks, phase,
    finishedChunks: session.chunks.filter(chunk => chunk.status === 'done').length,
    failedChunks: session.chunks.filter(chunk => chunk.status === 'failed').length,
  })
  const controller = new AbortController()
  const control = { paused: false, cancelled: false }
  activeController = controller
  activePauseFlag = control
  try {
    if (!first) {
      if (session.importTarget === 'reference') attach('paused')
      return
    }
    if (first.durableParse) {
      const evidence = await readPendingDocumentImportV1(args)
      attach(evidence?.candidate ? 'paused' : 'failed')
      if (!evidence?.candidate) status.setFatalError('已有尝试记录。可查看原证据，继续操作不会再次发送本块。')
      return
    }
    if (session.importTarget === 'reference' && session.chunks.some(chunk => chunk.status === 'done' && !chunk.durableParse?.confirmation))
      throw new ImportSessionAuthorityError('旧参考结果没有作者确认；原记录仍可查看，请明确新建导入。')
    if (first.attempts !== 0 || first.status === 'running' || first.status === 'failed')
      throw new ImportSessionAuthorityError('旧会话的本块已有发送记录，无法证明结果。可查看历史，请明确新建导入以重新解析。')
    const source = await captureImportSource(session)
    controller.signal.throwIfAborted()
    await readImportSessionAuthorityV1(sessionId, projectId, session)
    attach('running')
    status.setActiveChunk(first.index, 1)
    await createDocumentImportChunkCandidateV1({ ...args, chunkIndex: first.index,
      signal: controller.signal, sourceText: source.get(first.index)! })
    status.setActiveChunk(null)
    status.setPhase('paused')
    status.pushActivity('success', `第 ${first.index + 1} 块解析完成，等待你审查并确认。`, first.index)
    await sessionStore.load(sessionId)
  } catch (error) {
    if (controller.signal.aborted) {
      if (control.cancelled) await cancelImportSessionInScopeV1(args)
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    attach('failed')
    status.setFatalError(message)
    status.pushActivity('error', message)
  } finally {
    if (activeController === controller) activeController = null
  }
}

export const cancelPausedDocumentImportV1 = cancelImportSessionInScopeV1

/**
 * 从一份(已解析完成的) session 落地到「项目参考」+ 跑 13 维统一分析。
 * 解析与落地解耦:导入流程完成解析后调它;"解析一次多次落地"复用路径也调它(零重复解析)。
 * - 浅层:用 merged.writingTechniques 免费落成全书分析行(不调 AI)。
 * - 深层:用 session 的块文本逐块深析(registerRefChunks + runRefAnalysis)。
 */
export async function applyReferenceFromSession(
  projectId: number,
  session: ImportSession,
  sessionId: number,
  statusStore?: { pushActivity: (level: 'info' | 'success' | 'warn' | 'error', msg: string) => void },
  depthOverride?: import('../types').ReferenceAnalysisDepth,
): Promise<number> {
  const original = await readImportSessionAuthorityV1(sessionId, projectId, session)
  requireConfirmedImport(original)
  const depth = depthOverride ?? original.analysisDepth ?? 'quick'
  if (original.importTarget === 'reference') {
    if (original.publishedReferenceId == null || depth !== (original.analysisDepth ?? 'quick'))
      throw new ImportSessionAuthorityError('请从原参考打开对应的分析版本。')
    await runPublishedReferenceAnalysisV1({ projectId, sessionId }, statusStore)
    return original.publishedReferenceId
  }
  const chunks = depth === 'deep' ? await captureImportSource(original) : null
  await readImportSessionAuthorityV1(sessionId, projectId, original)
  const refId = await useReferenceStore.getState().addReference(importedReferenceDataV1({ ...original, id: sessionId }, depth), original.targetScope)
  await analyzeConfirmedReference(refId, { ...original, id: sessionId }, depth, chunks, statusStore)
  return refId
}

function requireConfirmedImport(session: ImportSession) {
  if (session.status !== 'done' || !session.chunks.every(chunk => chunk.status === 'done' && chunk.durableParse?.confirmation))
    throw new ImportSessionAuthorityError('原导入没有完整作者确认，历史结果仅可查看。')
}

const analyzingReferences = new Set<number>()

export async function runPublishedReferenceAnalysisV1(
  input: { projectId: number; sessionId: number },
  statusStore?: { pushActivity: (level: 'info' | 'success' | 'warn' | 'error', msg: string) => void },
): Promise<void> {
  const original = await readImportSessionAuthorityV1(input.sessionId, input.projectId)
  requireConfirmedImport(original)
  const refId = original.publishedReferenceId
  if (original.importTarget !== 'reference' || refId == null) throw new ImportSessionAuthorityError('未找到原确认发布的项目参考。')
  const depth = original.analysisDepth ?? 'quick'
  if (analyzingReferences.has(refId)) return
  analyzingReferences.add(refId)
  try {
    // Existing durable reference analysis owns resume/retry after its first start.
    if ((await listReferenceAnalysisRuns(refId)).length > 0) return
    const chunks = depth === 'deep' ? await captureImportSource(original) : null
    const session = { ...original, id: input.sessionId }
    await analyzeConfirmedReference(refId, session, depth, chunks, statusStore, {
      transactionTables: importedReferenceAnalysisStartTablesV1(),
      claimInTransaction: () => claimImportedReferenceAnalysisInTransactionV1(session),
    })
  } finally {
    analyzingReferences.delete(refId)
  }
}

async function analyzeConfirmedReference(
  refId: number, session: ImportSession & { id: number }, depth: 'quick' | 'deep',
  captured: ReadonlyMap<number, string> | null,
  statusStore?: { pushActivity: (level: 'info' | 'success' | 'warn' | 'error', msg: string) => void },
  firstStart?: ReferenceAnalysisFirstStartGuardV1,
): Promise<void> {
  const verify = () => readImportSessionAuthorityV1(session.id, session.projectId, session)
  await verify()
  if (depth === 'deep') {
    if (!captured) throw new ImportSessionAuthorityError('深层分析需要完整原文件。')
    const sourceChunks = session.chunks.map(({ index, startChar, endChar, charCount, label }) =>
      ({ index, startChar, endChar, charCount, label, text: captured.get(index)! }))
    const run = await createReferenceAnalysisRun({
      referenceId: refId, depth, sourceFilename: session.filename, fileHash: session.fileHash,
      totalChars: session.totalChars, expectedChunks: sourceChunks.length,
      sourceKind: 'unknown', usageScope: 'analysis-only',
      rightsNote: '由项目导入流程建立；尚未在版本面板补充来源声明', rightsConfirmed: false,
      sourceText: sourceChunks.map(chunk => chunk.text).join('\n\n'), sourceChunks,
    }, firstStart)
    registerRefChunks(run.id!, sourceChunks)
    statusStore?.pushActivity('info', `开始深层分析（${sourceChunks.length} 块）`)
    await verify()
    await runRefAnalysis(refId, run.id)
  } else {
    await writeShallowAnalysisFromTechniques(refId, session.merged.writingTechniques,
      { filename: session.filename, fileHash: session.fileHash, totalChars: session.totalChars }, firstStart)
    statusStore?.pushActivity('success', '浅层作品分析已完成')
  }
}

/**
 * 从一份(已解析完成的) session 落地到当前内容库（世界基础/地理/历史/角色/大纲），零重复解析。
 * "解析一次·多次落地"的另一半:用户已解析过对标文(或导入过参考),想把设定搬进设定库时,
 * 直接复用 session.merged 写库,**不再调用解析 AI**(省钱),也不必一个个手填。
 */
export async function applyProjectFromSession(
  projectId: number,
  session: ImportSession,
  worldGroupId: number | null = null,
  statusStore?: { pushActivity: (level: 'info' | 'success' | 'warn' | 'error', msg: string) => void },
  explicitReferenceReuse = false,
): Promise<ApplyChunkCounts> {
  if (session.id == null) throw new ImportSessionUnavailableError()
  const original = await readImportSessionAuthorityV1(session.id, projectId, session)
  requireConfirmedImport(original)
  if (original.importTarget === 'reference' && !explicitReferenceReuse)
    throw new ImportSessionAuthorityError('仅参考的结果需要作者明确选择写入设定库。')
  if (original.importTarget === 'project' && worldGroupId != null && worldGroupId !== original.targetWorldGroupId)
    throw new ImportSessionAuthorityError('不能将导入结果静默改写到其他世界组。')
  const group = original.importTarget === 'project' ? original.targetWorldGroupId ?? null : worldGroupId
  await verifyImportProjectTargetGroupV1(original.targetScope, group)
  const counts = await applyChunkResult(original.targetScope, original.merged, group, async () => {
    await readImportSessionAuthorityV1(session.id!, projectId, original)
    await verifyImportProjectTargetGroupV1(original.targetScope, group)
  })
  await runCharacterMerge({ projectId, sessionId: original.id!, isFinal: true })
  statusStore?.pushActivity('success', `📥 已灌入设定库：世界观 +${counts.worldviewFields} 字段 · 角色 +${counts.characters} · 大纲 +${counts.outlineNodes}`)
  return counts
}

/** 单独重试某个失败的块（用户在 ReportModal 里点的"重试失败块"） */
export async function retryFailedChunks(args: {
  sessionId: number
  projectId: number
}): Promise<void> {
  await runSession(args)
}
