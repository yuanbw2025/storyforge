import { useEffect, useMemo, useRef, useState } from 'react'
import { chunkDocument, quickHash } from '../../lib/import/chunker'
import {
  runSession, pausePipeline, cancelPipeline, isPipelineRunning, cancelPausedDocumentImportV1,
  readPendingDocumentImportV1, runPublishedReferenceAnalysisV1,
  registerChunkTexts, hasChunkTexts, clearChunkTexts,
  applyReferenceFromSession, applyProjectFromSession,
} from '../../lib/import/pipeline'
import { confirmDocumentImportChunkV1 } from '../../lib/import/document-parse-adoption'
import type { UnifiedParseResult, ReferenceAnalysisDepth } from '../../lib/types'
import { hashImportChunkTextV1, hasFrozenImportIdentityV1, ImportSessionAuthorityError, ImportSessionUnavailableError,
  readImportSessionAuthorityV1, useImportSessionStore, verifyImportProjectTargetGroupV1 } from '../../stores/import-session'
import { useImportStatusStore } from '../../stores/import-status'
import { useWorldGroupStore } from '../../stores/world-group'
import ImportConfirmModal from './import/ImportConfirmModal'
import ImportReportModal from './import/ImportReportModal'
import CodexImportReviewModal from './import/CodexImportReviewModal'
import { ImportDocIntro, ImportReusableSessionBanner } from './import/ImportDocOverview'
import ImportRuntimeView, { ImportPipelineControls } from './import/ImportRuntimeView'
import ImportUnfinishedBanner from './import/ImportUnfinishedBanner'
import ImportUploadZone from './import/ImportUploadZone'
import useImportDocumentPreparation from './import/useImportDocumentPreparation'
import useImportSessionRecovery from './import/useImportSessionRecovery'
import type { Project, WorkspaceScope } from '../../lib/types'
import { resolveScope } from '../../lib/workspace/scope'
import type { ImportSession, ChunkState, ImportTarget } from '../../lib/types/import-session'
import type { SidebarModule } from '../layout/sidebar-tree'
import { useDialog } from '../shared/Dialog'
import { useToast } from '../shared/Toast'
import {
  applyCodexImportCandidates,
  loadCodexImportCategoryOptions,
  type CodexImportCategoryOption,
} from '../../lib/import/codex-classification'

interface Props {
  project: Project
  /** 解析完成后「前往查看」用:跳到导入落点(当前项目=设定库 / 项目参考页)。 */
  onNavigate?: (module: SidebarModule) => void
}

/**
 * v3 §6 Phase 18 — 大文档分块解析导入（重写版 + 方案 A 持久化）
 *
 * 上传原文件、选择目标、分块解析，作者审查确认后保存结果。
 *
 * 2026-05-12 增强：
 *   · 上传时把原文 Blob 存到 IndexedDB（importFiles 表）
 *   · 打开面板发现未完成任务时，自动从 Blob 恢复原文 → 直接续跑，不再需要重传文件
 *   · 调 navigator.storage.persist() 防止浏览器 GC 掉 Blob
 */
export default function ImportDocPanel({ project, onNavigate }: Props) {
  const dialog = useDialog()
  const toast = useToast()
  const source = useImportDocumentPreparation()
  const [targetWorldGroupId, setTargetWorldGroupId] = useState<number | null>(null)

  // 报告 modal + 未完成会话
  const [reportSession, setReportSession] = useState<ImportSession | null>(null)
  const [reportEvidence, setReportEvidence] = useState<Awaited<ReturnType<typeof readPendingDocumentImportV1>>>(null)
  const [codexReview, setCodexReview] = useState<{
    session: ImportSession
    categories: CodexImportCategoryOption[]
  } | null>(null)
  const [applyingReuse, setApplyingReuse] = useState(false)
  const recovery = useImportSessionRecovery(project.id!, project.activeWorldId, project.activeWorkId)
  const previewTargetScope = useRef<WorkspaceScope | null>(null)
  const {
    filename, rawText, fileError, loadingFile, extractInfo, plans, chunkSize,
    showConfirm, volumeDetect, previewPlans, handleFile, handleRawTextChange,
    prepareConfirmation, handleChunkSizeChange, closeConfirm, sourceBlob,
  } = source
  const {
    unfinished, reusable, blobRestored, restoringBlob,
    clearUnfinished, clearReusable, markBlobRestored,
  } = recovery

  const status = useImportStatusStore()
  const {
    groups: allWorldGroups,
    activeGroupId,
    loadAll: loadWorldGroups,
  } = useWorldGroupStore()
  const phase = status.phase
  const worldGroups = useMemo(
    () => allWorldGroups.filter(group => group.projectId === project.id && group.worldId === project.activeWorldId),
    [allWorldGroups, project.activeWorldId, project.id],
  )

  useEffect(() => {
    if (!project.enableMultiWorld) {
      setTargetWorldGroupId(null)
      return
    }
    if (project.activeWorldId != null && project.activeWorkId != null)
      loadWorldGroups({ projectId: project.id!, worldId: project.activeWorldId, workId: project.activeWorkId })
  }, [project.activeWorldId, project.activeWorkId, project.enableMultiWorld, project.id, loadWorldGroups])

  useEffect(() => {
    if (!project.enableMultiWorld) return
    if (targetWorldGroupId != null && worldGroups.some(group => group.id === targetWorldGroupId)) return
    const activeBelongsToProject = worldGroups.some(group => group.id === activeGroupId)
    setTargetWorldGroupId(activeBelongsToProject ? activeGroupId : worldGroups[0]?.id ?? null)
  }, [activeGroupId, project.enableMultiWorld, targetWorldGroupId, worldGroups])

  // ── phase 变成 done/failed 时自动弹 ReportModal ─────────────
  const autoReportShown = useRef<number | null>(null)
  useEffect(() => {
    const showReport = async () => {
      if ((phase === 'done' || phase === 'failed') && status.sessionId
          && autoReportShown.current !== status.sessionId) {
        autoReportShown.current = status.sessionId
        const s = await useImportSessionStore.getState().load(status.sessionId)
        if (s && s.projectId === project.id && (!s.targetScope ||
          (s.targetScope.worldId === project.activeWorldId && s.targetScope.workId === project.activeWorkId))) setReportSession(s)
      }
    }
    showReport()
  }, [phase, project.activeWorkId, project.activeWorldId, project.id, status.sessionId])

  const reportImportFailure = (action: string, error: unknown, sessionId?: number) => {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof ImportSessionUnavailableError && sessionId != null) clearChunkTexts(sessionId)
    const current = useImportStatusStore.getState()
    if (sessionId == null || current.sessionId == null || current.sessionId === sessionId) {
      current.setPhase('failed')
      current.setFatalError(message)
      current.pushActivity('error', `${action}：${message}`)
    }
    toast.error(`${action}：${message}`)
  }

  const prepareScopedConfirmation = async () => {
    try {
      previewTargetScope.current = await resolveScope({ projectId: project.id! })
      prepareConfirmation()
    } catch (error) {
      reportImportFailure('无法确认导入目标', error)
    }
  }

  // ── 在 Confirm Modal 里确认：创建 session 并启动 ───────────
  const handleConfirmStart = async (importTarget: ImportTarget, selectedWorldGroupId?: number | null, depth?: import('../../lib/types').ReferenceAnalysisDepth) => {
    if (!plans) return
    if (importTarget === 'project' && project.enableMultiWorld && selectedWorldGroupId == null) {
      toast.error('请先选择本次导入要写入的目标世界。')
      return
    }
    closeConfirm()

    useImportStatusStore.getState().reset()
    useImportStatusStore.getState().setPhase('preparing')

    let createdSessionId: number | undefined
    try {
      const targetScope = previewTargetScope.current
      if (!targetScope || targetScope.projectId !== project.id)
        throw new ImportSessionAuthorityError('请在当前世界和作品重新预览并确认导入。')
      const chunks: ChunkState[] = []
      for (const plan of plans) {
        chunks.push({ index: plan.index, startChar: plan.startChar, endChar: plan.endChar,
          charCount: plan.charCount, label: plan.label, status: 'pending', attempts: 0,
          sourceTextHash: await hashImportChunkTextV1(plan.text) })
      }
      const fileHash = quickHash(rawText)
      const sessionData: Omit<ImportSession, 'id' | 'createdAt' | 'updatedAt'> = {
        projectId: project.id!,
        targetScope,
        filename: filename || '未命名文档',
        fileHash,
        totalChars: rawText.length,
        totalChunks: plans.length,
        chunkSize,
        chunks,
        merged: { worldview: {}, characters: [], outline: [], codexCandidates: [] },
        rollingContext: '',
        importTarget,
        analysisDepth: importTarget === 'reference' ? (depth ?? 'quick') : undefined,
        targetWorldGroupId: importTarget === 'project' ? (selectedWorldGroupId ?? null) : null,
        status: 'pending',
      }

      const sessionId = await useImportSessionStore.getState().create(sessionData)
      createdSessionId = sessionId
      registerChunkTexts(sessionId, plans.map(p => ({ index: p.index, text: p.text })))

      // 存原文 Blob —— 优先用原始 File（保留 Word/PDF 原格式，下次恢复一致）
      // 如果用户是粘贴文本，退化为 text/plain Blob
      try {
        const { blob: fileBlob, filename: saveName } = sourceBlob()
        await useImportSessionStore.getState().saveBlob(sessionId, saveName, fileBlob, fileHash)
      } catch (err) {
        if (err instanceof ImportSessionUnavailableError) throw err
        toast.info('原文未能保存到本地存档；本次仍可继续，刷新后需要重新上传。')
        // 存 Blob 失败不应阻塞主流程（本次内存里原文还在，依然能跑完）
        console.warn('[import] saveBlob 失败（本次跑不受影响，但下次刷新将无法自动续跑）：', err)
      }

      // 刷新未完成列表（新 session 本身就是未完成态）
      clearUnfinished()
      autoReportShown.current = null
      setReportSession(null)

      // Wait for the formal candidate, then open the existing review surface.
      await runAndReview(sessionId)
    } catch (error) {
      reportImportFailure('无法开始导入', error, createdSessionId)
    }
  }

  // ── 解析一次·多次落地:复用已完成会话,灌进当前项目设定库(世界观/角色/大纲),不再解析 ──
  const handleReuseToProject = async () => {
    if (!reusable?.id || applyingReuse) return
    setApplyingReuse(true)
    const statusStore = useImportStatusStore.getState()
    statusStore.reset()
    statusStore.setPhase('preparing')
    statusStore.pushActivity('info', `♻️ 复用已解析《${reusable.filename}》→ 当前项目设定库（不重新解析）`)
    try {
      const targetGroup = reusable.importTarget === 'reference' && project.enableMultiWorld ? targetWorldGroupId : null
      await applyProjectFromSession(project.id!, reusable, targetGroup, statusStore, reusable.importTarget === 'reference')
      statusStore.setPhase('done')
      clearReusable()
      toast.success('对标设定已灌入当前项目的世界观 / 角色 / 大纲')
    } catch (err) {
      console.error('[import] 复用应用到项目失败：', err)
      statusStore.setPhase('failed')
      toast.error(`复用失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setApplyingReuse(false)
    }
  }

  // ── 解析一次·多次落地:复用已完成会话,应用到项目参考(浅/深),不再解析 ──
  const handleReuseToReference = async (depth: ReferenceAnalysisDepth) => {
    if (!reusable?.id || applyingReuse) return
    setApplyingReuse(true)
    const statusStore = useImportStatusStore.getState()
    statusStore.reset()
    statusStore.setPhase('preparing')
    statusStore.pushActivity('info', `♻️ 复用已解析《${reusable.filename}》→ 项目参考·${depth === 'deep' ? '深层' : '浅层'}（不重新解析）`)
    try {
      await applyReferenceFromSession(project.id!, reusable, reusable.id!, statusStore, depth)
      statusStore.setPhase('done')
      clearReusable()
      onNavigate?.('references')
    } catch (err) {
      console.error('[import] 复用应用到参考失败：', err)
      statusStore.setPhase('failed')
      toast.error(`复用失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setApplyingReuse(false)
    }
  }

  const showImportRecord = async (sessionId: number) => {
    const row = await useImportSessionStore.getState().load(sessionId)
    if (!row || row.projectId !== project.id || (row.targetScope &&
      (row.targetScope.workId !== project.activeWorkId || row.targetScope.worldId !== project.activeWorldId))) return
    const evidence = row.targetScope && hasFrozenImportIdentityV1(row) && row.status !== 'done'
      ? await readPendingDocumentImportV1({ sessionId, projectId: project.id! }) : null
    setReportEvidence(evidence)
    setReportSession(row)
  }

  const runAndReview = async (sessionId: number) => {
    await runSession({ sessionId, projectId: project.id! })
    if (useImportStatusStore.getState().sessionId === sessionId) await showImportRecord(sessionId)
  }

  const handleConfirmCandidate = async (reviewedResult: UnifiedParseResult) => {
    const candidate = reportEvidence?.candidate
    if (!candidate || !reportSession?.id || candidate.sessionId !== reportSession.id) throw new Error('请重新打开原候选。')
    const id = reportSession.id
    await confirmDocumentImportChunkV1({ projectId: project.id!, sessionId: id, chunkIndex: candidate.chunkIndex,
      candidateHash: candidate.candidateHash, reviewedResult })
    const row = await useImportSessionStore.getState().load(id)
    if (!row) throw new Error('导入会话已不存在。')
    setReportEvidence(null)
    clearUnfinished()
    const current = useImportStatusStore.getState()
    current.attachSession({ sessionId: id, filename: row.filename, totalChunks: row.totalChunks,
      finishedChunks: row.chunks.filter(chunk => chunk.status === 'done').length,
      phase: row.status === 'done' ? 'done' : 'paused' })
    setReportSession(row.status === 'done' ? row : null)
    if (row.publishedReferenceId && row.analysisDepth !== 'deep') {
      runPublishedReferenceAnalysisV1({ sessionId: id, projectId: project.id! }, current).then(async () => {
        const fresh = await useImportSessionStore.getState().load(id)
        setReportSession(open => open?.id === id ? fresh : open)
      }).catch(error => toast.error(`项目参考已保存，浅层分析未完成：${error instanceof Error ? error.message : String(error)}`))
    }
  }

  const handleStartPublishedAnalysis = async () => {
    if (!reportSession?.id) return
    try {
      const id = reportSession.id
      await runPublishedReferenceAnalysisV1({ sessionId: id, projectId: project.id! }, useImportStatusStore.getState())
      const fresh = await useImportSessionStore.getState().load(id)
      setReportSession(open => open?.id === id ? fresh : open)
      toast.success('请在项目参考中查看分析进度。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  // ── 续跑入口（Blob 已恢复 → 直接跑） ─────────────────────
  const handleResume = async () => {
    if (!unfinished?.id) return
    if (!hasChunkTexts(unfinished.id)) {
      toast.error('原文丢失且 Blob 恢复失败。请重新上传同一文件后再点"用当前文件续跑"。')
      return
    }
    autoReportShown.current = null
    setReportSession(null)
    try {
      await runAndReview(unfinished.id)
    } catch (error) {
      reportImportFailure('无法续跑', error, unfinished.id)
    }
  }

  // ── 用当前上传的文件续跑（作为兜底） ─────────────────────
  const restoreOriginalFromUpload = async (session: ImportSession) => {
    if (!session.id || !rawText) return
    const id = session.id
    const newHash = quickHash(rawText)
    if (newHash !== session.fileHash) {
      toast.error('上传文件与原导入文件不同。请上传原文件，或为新文件另开导入。')
      return
    }
    const p = chunkDocument(rawText, { targetChars: session.chunkSize })
    if (p.length !== session.totalChunks) {
      toast.error(`重新切块得到 ${p.length} 块，与原任务的 ${session.totalChunks} 块不一致，无法续跑。建议清理该任务后重新开始解析。`)
      return
    }
    try {
      const frozen = await readImportSessionAuthorityV1(id, project.id!, session)
      for (const chunk of p) {
        if (frozen.chunks[chunk.index]?.sourceTextHash !== await hashImportChunkTextV1(chunk.text))
          throw new ImportSessionAuthorityError('上传文件与原分块内容不同；请另开导入。')
      }
      await readImportSessionAuthorityV1(id, project.id!, frozen)
      registerChunkTexts(id, p.map(c => ({ index: c.index, text: c.text })))
      // 普通持久化失败仍可用本次内存原文；父根已删必须停止。
      try {
        const { blob: fileBlob, filename: saveName } = sourceBlob()
        await useImportSessionStore.getState().saveBlob(id, saveName, fileBlob, session.fileHash)
      } catch (error) {
        if (error instanceof ImportSessionUnavailableError) throw error
        toast.info('原文未能保存到本地存档；本次仍可继续，刷新后需要重新上传。')
      }
      markBlobRestored()
      autoReportShown.current = null
      setReportSession(null)
      if (session.status === 'done') await showImportRecord(id)
      else await runAndReview(id)
    } catch (error) {
      reportImportFailure('无法恢复原文件', error, id)
    }
  }
  const handleResumeWithUploaded = () => {
    if (unfinished) return restoreOriginalFromUpload(unfinished)
  }

  // ── Report Modal 里：重试失败块 / 关闭 / 清理 ─────────────
  const handleRetryFailed = async () => {
    if (!reportSession?.id) return
    if (!hasChunkTexts(reportSession.id)) {
      toast.error('原文已从内存清除，请重新上传同一文件后才能重试失败块。')
      return
    }
    setReportSession(null)
    autoReportShown.current = null
    try {
      await runAndReview(reportSession.id)
    } catch (error) {
      reportImportFailure('无法重试', error, reportSession.id)
    }
  }
  const handleCloseReport = () => {
    setReportSession(null)
    setReportEvidence(null)
    // done 的会话：清内存原文 + Blob 存档释放空间
    if (reportSession?.id && reportSession.status === 'done' && reportSession.analysisDepth !== 'deep') {
      clearChunkTexts(reportSession.id)
      useImportSessionStore.getState().deleteBlob(reportSession.id).catch(error => {
        toast.error(`原文存档清理失败：${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }
  const handleDiscardSession = async () => {
    if (!reportSession?.id) return
    const ok = await dialog.confirm({
      title: '清理本次会话记录？',
      message: '已入库的解析数据不会被删除。',
      confirmText: '清理',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await useImportSessionStore.getState().deleteSession(reportSession.id)
      clearChunkTexts(reportSession.id)
      setReportSession(null)
      useImportStatusStore.getState().reset()
    } catch (error) {
      toast.error(`清理会话失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleCancelCurrent = async () => {
    const ok = await dialog.confirm({
      title: '取消本次任务？',
      message: '已入库的解析数据不会被删除。',
      confirmText: '取消任务',
      tone: 'danger',
    })
    if (!ok) return
    try {
      if (isPipelineRunning()) cancelPipeline()
      else if (status.sessionId != null) {
        await cancelPausedDocumentImportV1({ sessionId: status.sessionId, projectId: project.id! })
        useImportStatusStore.getState().reset()
        setReportSession(null)
        setReportEvidence(null)
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
  }

  const handleResumeCurrent = () => {
    if (!status.sessionId) return
    runAndReview(status.sessionId).catch(err => reportImportFailure('无法续跑', err, status.sessionId!))
  }

  const handleShowCurrentReport = async () => {
    if (status.sessionId != null) {
      try { await showImportRecord(status.sessionId) }
      catch (error) { reportImportFailure('无法读取原记录', error, status.sessionId) }
    }
  }

  const handleOpenCodexReview = async (session: ImportSession) => {
    if (!session.merged?.codexCandidates?.length || session.codexAdoption ||
      session.status !== 'done' || !session.chunks.every(chunk => chunk.durableParse?.confirmation)) return
    try {
      if (session.id == null) throw new ImportSessionUnavailableError()
      const original = await readImportSessionAuthorityV1(session.id, project.id!, session)
      const categories = await loadCodexImportCategoryOptions(original.targetScope)
      await readImportSessionAuthorityV1(session.id, project.id!, original)
      setCodexReview({ session, categories })
    } catch (error) {
      toast.error(`加载词条分类失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleConfirmCodex = async (
    session: ImportSession,
    candidates: import('../../lib/types').CodexImportCandidate[],
  ) => {
    const worldGroupId = session.importTarget === 'project'
      ? session.targetWorldGroupId ?? null
      : (project.enableMultiWorld ? targetWorldGroupId : null)
    if (project.enableMultiWorld && worldGroupId == null) {
      toast.error('请先选择词条候选要写入的目标世界。')
      return
    }
    try {
      if (session.id == null) throw new ImportSessionUnavailableError()
      const original = await readImportSessionAuthorityV1(session.id, project.id!, session)
      await verifyImportProjectTargetGroupV1(original.targetScope, worldGroupId)
      const result = await applyCodexImportCandidates({
        projectId: project.id!,
        scope: original.targetScope,
        worldGroupId,
        candidates,
      })
      if (session.id != null) {
        await useImportSessionStore.getState().patch(session.id, {
          codexAdoption: {
            adoptedAt: Date.now(),
            imported: result.imported,
            updated: result.updated,
            skipped: result.skipped,
          },
        })
        const fresh = await useImportSessionStore.getState().load(session.id)
        if (fresh) {
          setReportSession(current => current?.id === fresh.id ? fresh : current)
        }
      }
      setCodexReview(null)
      clearReusable()
      const detail = result.errors.length ? `；${result.errors.slice(0, 2).join('；')}` : ''
      toast.success(`词条审查完成：新增 ${result.imported}、补全 ${result.updated}、跳过 ${result.skipped}${detail}`)
    } catch (error) {
      toast.error(`词条写入失败，候选仍保留：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleRestart = () => {
    if (status.sessionId) {
      clearChunkTexts(status.sessionId)
      useImportSessionStore.getState().deleteBlob(status.sessionId).catch(error => {
        toast.error(`原文存档清理失败：${error instanceof Error ? error.message : String(error)}`)
      })
    }
    useImportStatusStore.getState().reset()
    setReportSession(null)
  }

  return (
    <div className="max-w-4xl p-6 space-y-4">
      {/* 顶部状态条：流水线跑起来后常驻显示 */}
      <ImportPipelineControls
        phase={phase}
        canResume={status.sessionId != null}
        onPause={pausePipeline}
        onResume={handleResumeCurrent}
        onCancel={handleCancelCurrent}
      />

      {/* 标题 + 介绍 */}
      <ImportDocIntro chunkSize={chunkSize} />

      {/* 未完成会话提示 */}
      {unfinished && phase === 'idle' && (
        <ImportUnfinishedBanner
          unfinished={unfinished}
          restoringBlob={restoringBlob}
          blobRestored={blobRestored}
          hasRawText={!!rawText.trim()}
          boundToOriginal={hasFrozenImportIdentityV1(unfinished)}
          onResume={handleResume}
          onResumeWithUploaded={handleResumeWithUploaded}
          onShowDetail={() => {
            if (unfinished.id != null) showImportRecord(unfinished.id).catch(error =>
              reportImportFailure('无法读取原记录', error, unfinished.id))
          }}
          onDiscard={async () => {
            const ok = await dialog.confirm({
              title: '放弃这个未完成任务？',
              message: '已入库数据不会被删除。',
              confirmText: '放弃任务',
              tone: 'danger',
            })
            if (!ok) return
            try {
              await useImportSessionStore.getState().deleteSession(unfinished.id!)
              clearChunkTexts(unfinished.id!)
              clearUnfinished()
            } catch (error) {
              toast.error(`放弃任务失败：${error instanceof Error ? error.message : String(error)}`)
            }
          }}
        />
      )}

      {/* 解析一次·多次落地:已完成会话可复用解析,直接做项目参考分析(不重新解析) */}
      {reusable && phase === 'idle' && !unfinished && (
        <ImportReusableSessionBanner
          session={reusable}
          applying={applyingReuse}
          originalTextAvailable={hasChunkTexts(reusable.id!)}
          onApplyProject={handleReuseToProject}
          onApplyReference={handleReuseToReference}
          onReviewCodex={() => handleOpenCodexReview(reusable)}
          onRestoreOriginal={reusable.publishedReferenceId && reusable.analysisDepth === 'deep' &&
            !hasChunkTexts(reusable.id!) && rawText.trim() ? () => { void restoreOriginalFromUpload(reusable) } : undefined}
          onShowReport={() => {
            if (reusable.id != null) showImportRecord(reusable.id).catch(error =>
              reportImportFailure('无法读取原记录', error, reusable.id))
          }}
          onIgnore={clearReusable}
        />
      )}

      {/* 上传区 */}
      {phase === 'idle' && (
        <ImportUploadZone
          filename={filename}
          rawText={rawText}
          loadingFile={loadingFile}
          fileError={fileError}
          extractInfo={extractInfo}
          chunkSize={chunkSize}
          previewPlans={previewPlans}
          onFile={handleFile}
          onRawTextChange={handleRawTextChange}
          onStart={prepareScopedConfirmation}
        />
      )}

      {/* 运行时：进度面板 + 活动日志 */}
      {phase !== 'idle' && (
        <ImportRuntimeView
          phase={phase}
          fatalError={status.fatalError}
          failedChunks={status.failedChunks}
          onRetryFailed={handleRetryFailed}
          onShowReport={handleShowCurrentReport}
          onRestart={handleRestart}
        />
      )}

      {/* Confirm Modal */}
      {showConfirm && plans && (
        <ImportConfirmModal
          filename={filename || '未命名文档'}
          totalChars={rawText.length}
          chunks={plans}
          chunkSize={chunkSize}
          volumeDetect={volumeDetect}
          worldGroups={project.enableMultiWorld ? worldGroups : []}
          targetWorldGroupId={targetWorldGroupId}
          onTargetWorldGroupChange={setTargetWorldGroupId}
          onChunkSizeChange={handleChunkSizeChange}
          onConfirm={handleConfirmStart}
          onCancel={closeConfirm}
        />
      )}

      {/* Report Modal */}
      {reportSession && (
        <ImportReportModal
          session={reportSession}
          onRetryFailed={handleRetryFailed}
          onClose={handleCloseReport}
          onDiscard={handleDiscardSession}
          evidence={reportEvidence}
          onStartAnalysis={reportSession.publishedReferenceId && reportSession.referenceAnalysisStartedAt == null
            ? handleStartPublishedAnalysis : undefined}
          review={reportEvidence?.candidate && reportEvidence.candidate.sessionId === reportSession.id && reportEvidence.state === 'awaiting_confirmation'
            ? { candidate: reportEvidence.candidate, raw: reportEvidence.raw,
              canConfirm: hasChunkTexts(reportSession.id!), onConfirm: handleConfirmCandidate }
            : undefined}
          onReviewCodex={reportSession.status === 'done' && reportSession.chunks.every(chunk => chunk.durableParse?.confirmation) && (reportSession.merged?.codexCandidates?.length || 0) > 0
            ? () => handleOpenCodexReview(reportSession)
            : undefined}
          onNavigate={onNavigate && (() => {
            // 当前项目 → 跳设定库(世界观起源);项目参考 → 跳项目参考页
            onNavigate(reportSession.importTarget === 'reference' ? 'references' : 'worldview-origin')
            handleCloseReport()
          })}
        />
      )}
      {codexReview && (
        <CodexImportReviewModal
          filename={codexReview.session.filename}
          candidates={codexReview.session.merged?.codexCandidates || []}
          categories={codexReview.categories}
          onConfirm={candidates => handleConfirmCodex(codexReview.session, candidates)}
          onCancel={() => setCodexReview(null)}
        />
      )}
    </div>
  )
}
