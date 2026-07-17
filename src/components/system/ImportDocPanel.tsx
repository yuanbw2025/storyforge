import { useEffect, useMemo, useRef, useState } from 'react'
import { chunkDocument, quickHash } from '../../lib/import/chunker'
import {
  runSession, pausePipeline, cancelPipeline, retryFailedChunks,
  registerChunkTexts, hasChunkTexts, clearChunkTexts,
  applyReferenceFromSession, applyProjectFromSession,
} from '../../lib/import/pipeline'
import type { ReferenceAnalysisDepth } from '../../lib/types'
import { useImportSessionStore } from '../../stores/import-session'
import { useImportStatusStore } from '../../stores/import-status'
import { useOutlineStore } from '../../stores/outline'
import { useWorldGroupStore } from '../../stores/world-group'
import ImportConfirmModal from './import/ImportConfirmModal'
import ImportReportModal from './import/ImportReportModal'
import { ImportDocIntro, ImportReusableSessionBanner } from './import/ImportDocOverview'
import ImportRuntimeView, { ImportPipelineControls } from './import/ImportRuntimeView'
import ImportUnfinishedBanner from './import/ImportUnfinishedBanner'
import ImportUploadZone from './import/ImportUploadZone'
import useImportDocumentPreparation from './import/useImportDocumentPreparation'
import useImportSessionRecovery from './import/useImportSessionRecovery'
import type { Project } from '../../lib/types'
import type { ImportSession, ChunkState, ImportTarget } from '../../lib/types/import-session'
import type { SidebarModule } from '../layout/Sidebar'
import { useDialog } from '../shared/Dialog'
import { useToast } from '../shared/Toast'

interface Props {
  project: Project
  /** 解析完成后「前往查看」用:跳到导入落点(当前项目=设定库 / 项目参考页)。 */
  onNavigate?: (module: SidebarModule) => void
}

/**
 * v3 §6 Phase 18 — 大文档分块解析导入（重写版 + 方案 A 持久化）
 *
 * 用户只要上传一个文件 → 预览确认 → AI 串行分块解析 → 实时入库 → 汇报结果。
 * 支持百万～千万字文档，断点续跑，自动重试，跨块角色合并。
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
  const [applyingReuse, setApplyingReuse] = useState(false)
  const recovery = useImportSessionRecovery(project.id!)
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
    () => allWorldGroups.filter(group => group.projectId === project.id),
    [allWorldGroups, project.id],
  )

  useEffect(() => {
    if (!project.enableMultiWorld) {
      setTargetWorldGroupId(null)
      return
    }
    loadWorldGroups(project.id!)
  }, [project.enableMultiWorld, project.id, loadWorldGroups])

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
        if (s) setReportSession(s)
      }
    }
    showReport()
  }, [phase, status.sessionId])

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

    const fileHash = quickHash(rawText)
    const sessionData: Omit<ImportSession, 'id' | 'createdAt' | 'updatedAt'> = {
      projectId: project.id!,
      filename: filename || '未命名文档',
      fileHash,
      totalChars: rawText.length,
      totalChunks: plans.length,
      chunkSize,
      chunks: plans.map<ChunkState>(p => ({
        index: p.index,
        startChar: p.startChar,
        endChar: p.endChar,
        charCount: p.charCount,
        label: p.label,
        status: 'pending',
        attempts: 0,
      })),
      merged: { worldview: {}, characters: [], outline: [] },
      rollingContext: '',
      importTarget,
      analysisDepth: importTarget === 'reference' ? (depth ?? 'quick') : undefined,
      targetWorldGroupId: importTarget === 'project' ? (selectedWorldGroupId ?? null) : null,
      status: 'pending',
    }

    const sessionId = await useImportSessionStore.getState().create(sessionData)
    registerChunkTexts(sessionId, plans.map(p => ({ index: p.index, text: p.text })))

    // 存原文 Blob —— 优先用原始 File（保留 Word/PDF 原格式，下次恢复一致）
    // 如果用户是粘贴文本，退化为 text/plain Blob
    try {
      const { blob: fileBlob, filename: saveName } = sourceBlob()
      await useImportSessionStore.getState().saveBlob(sessionId, saveName, fileBlob, fileHash)
    } catch (err) {
      // 存 Blob 失败不应阻塞主流程（本次内存里原文还在，依然能跑完）
      console.warn('[import] saveBlob 失败（本次跑不受影响，但下次刷新将无法自动续跑）：', err)
    }

    // Phase 28.4: 如果检测到分卷结构，且是导入当前项目，先预写卷结构骨架
    if (importTarget === 'project' && volumeDetect?.hasVolumes) {
      try {
        const olStore = useOutlineStore.getState()
        await olStore.loadAll(project.id!)
        const startOrder = useOutlineStore.getState().nodes
          .filter(n => n.parentId === null).length

        for (let vi = 0; vi < volumeDetect.volumes.length; vi++) {
          const vol = volumeDetect.volumes[vi]
          await olStore.addNode({
            projectId: project.id!,
            parentId: null,
            type: 'volume',
            worldGroupId: selectedWorldGroupId ?? null,
            title: vol.title,
            summary: '',
            order: startOrder + vi,
          })
        }
        useImportStatusStore.getState().pushActivity(
          'info',
          `📚 已创建 ${volumeDetect.volumes.length} 个卷结构骨架`,
        )
      } catch (err) {
        console.warn('[import] 预写卷结构失败（不影响主流程）：', err)
      }
    }

    // 刷新未完成列表（新 session 本身就是未完成态）
    clearUnfinished()
    autoReportShown.current = null
    setReportSession(null)

    // 启动流水线（不 await，让 UI 先渲染 StatusBar/ProgressPanel）
    runSession({ sessionId, projectId: project.id! }).catch(err => {
      console.error('[import] runSession 崩了：', err)
    })
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
      await applyProjectFromSession(project.id!, reusable, null, statusStore)
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

  // ── 续跑入口（Blob 已恢复 → 直接跑） ─────────────────────
  const handleResume = async () => {
    if (!unfinished?.id) return
    if (!hasChunkTexts(unfinished.id)) {
      toast.error('原文丢失且 Blob 恢复失败。请重新上传同一文件后再点"用当前文件续跑"。')
      return
    }
    autoReportShown.current = null
    setReportSession(null)
    await runSession({ sessionId: unfinished.id, projectId: project.id! })
  }

  // ── 用当前上传的文件续跑（作为兜底） ─────────────────────
  const handleResumeWithUploaded = async () => {
    if (!unfinished?.id || !rawText) return
    const newHash = quickHash(rawText)
    if (newHash !== unfinished.fileHash) {
      const ok = await dialog.confirm({
        title: '上传文件与未完成任务不一致',
        message:
          `原任务文件 hash: ${unfinished.fileHash}\n` +
          `当前上传 hash:   ${newHash}\n\n` +
          '仍要用当前文件继续吗？强烈不建议，可能会出现角色/章节错位。',
        confirmText: '仍要继续',
        tone: 'danger',
      })
      if (!ok) return
    }
    const p = chunkDocument(rawText, { targetChars: unfinished.chunkSize })
    if (p.length !== unfinished.totalChunks) {
      toast.error(`重新切块得到 ${p.length} 块，与原任务的 ${unfinished.totalChunks} 块不一致，无法续跑。建议清理该任务后重新开始解析。`)
      return
    }
    registerChunkTexts(unfinished.id, p.map(c => ({ index: c.index, text: c.text })))
    // 同时把新上传的文件作为 Blob 覆盖存档（下次就不必再传了）
    try {
      const { blob: fileBlob, filename: saveName } = sourceBlob()
      await useImportSessionStore.getState().saveBlob(
        unfinished.id, saveName, fileBlob, unfinished.fileHash,
      )
    } catch {/* 静默失败 */}
    markBlobRestored()
    autoReportShown.current = null
    setReportSession(null)
    await runSession({ sessionId: unfinished.id, projectId: project.id! })
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
    await retryFailedChunks({ sessionId: reportSession.id, projectId: project.id! })
  }
  const handleCloseReport = () => {
    setReportSession(null)
    // done 的会话：清内存原文 + Blob 存档释放空间
    if (reportSession?.id && reportSession.status === 'done') {
      clearChunkTexts(reportSession.id)
      useImportSessionStore.getState().deleteBlob(reportSession.id).catch(() => {})
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
    clearChunkTexts(reportSession.id)
    await useImportSessionStore.getState().deleteBlob(reportSession.id).catch(() => {})
    await useImportSessionStore.getState().deleteSession(reportSession.id)
    setReportSession(null)
    useImportStatusStore.getState().reset()
  }

  const handleCancelCurrent = async () => {
    const ok = await dialog.confirm({
      title: '取消本次任务？',
      message: '已入库的解析数据不会被删除。',
      confirmText: '取消任务',
      tone: 'danger',
    })
    if (ok) cancelPipeline()
  }

  const handleResumeCurrent = () => {
    if (!status.sessionId) return
    runSession({ sessionId: status.sessionId, projectId: project.id! }).catch(err => {
      console.error('[import] 恢复任务失败：', err)
    })
  }

  const handleShowCurrentReport = async () => {
    if (!status.sessionId) return
    const session = await useImportSessionStore.getState().load(status.sessionId)
    if (session) setReportSession(session)
  }

  const handleRestart = () => {
    if (status.sessionId) {
      clearChunkTexts(status.sessionId)
      useImportSessionStore.getState().deleteBlob(status.sessionId).catch(() => {})
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
          onResume={handleResume}
          onResumeWithUploaded={handleResumeWithUploaded}
          onShowDetail={() => setReportSession(unfinished)}
          onDiscard={async () => {
            const ok = await dialog.confirm({
              title: '放弃这个未完成任务？',
              message: '已入库数据不会被删除。',
              confirmText: '放弃任务',
              tone: 'danger',
            })
            if (!ok) return
            await useImportSessionStore.getState().deleteSession(unfinished.id!)
            await useImportSessionStore.getState().deleteBlob(unfinished.id!).catch(() => {})
            clearChunkTexts(unfinished.id!)
            clearUnfinished()
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
          onStart={prepareConfirmation}
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
          onNavigate={onNavigate && (() => {
            // 当前项目 → 跳设定库(世界观起源);项目参考 → 跳项目参考页
            onNavigate(reportSession.importTarget === 'reference' ? 'references' : 'worldview-origin')
            handleCloseReport()
          })}
        />
      )}
    </div>
  )
}
