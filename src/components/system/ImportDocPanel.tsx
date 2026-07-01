import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Info,
  PauseCircle, PlayCircle, StopCircle, RotateCcw, FileBarChart2,
} from 'lucide-react'
import { extractTextFromFile, FILE_LIMIT_HINTS } from '../../lib/doc-parser'
import { chunkDocument, quickHash, type ChunkPlan } from '../../lib/import/chunker'
import { detectVolumeStructure, type VolumeDetectResult } from '../../lib/import/volume-detector'
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
import ImportStatusBar from './import/ImportStatusBar'
import ImportProgressPanel from './import/ImportProgressPanel'
import ImportActivityLog from './import/ImportActivityLog'
import ImportUnfinishedBanner from './import/ImportUnfinishedBanner'
import ImportUploadZone from './import/ImportUploadZone'
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

const DEFAULT_CHUNK_SIZE = 50000

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
  const [filename, setFilename] = useState('')
  const [rawText, setRawText] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [extractInfo, setExtractInfo] = useState<string | null>(null)

  // 切块结果 + confirm modal
  const [plans, setPlans] = useState<ChunkPlan[] | null>(null)
  const [chunkSize, setChunkSize] = useState(DEFAULT_CHUNK_SIZE)
  const [showConfirm, setShowConfirm] = useState(false)
  const [volumeDetect, setVolumeDetect] = useState<VolumeDetectResult | null>(null)
  const [targetWorldGroupId, setTargetWorldGroupId] = useState<number | null>(null)

  // 报告 modal + 未完成会话
  const [reportSession, setReportSession] = useState<ImportSession | null>(null)
  const [unfinished, setUnfinished] = useState<ImportSession | null>(null)
  /** 已完成可复用解析的会话(解析一次·多次落地) */
  const [reusable, setReusable] = useState<ImportSession | null>(null)
  const [applyingReuse, setApplyingReuse] = useState(false)
  /** 当前未完成任务的 Blob 是否已恢复到内存（决定"立即续跑"是否可点） */
  const [blobRestored, setBlobRestored] = useState(false)
  const [restoringBlob, setRestoringBlob] = useState(false)

  const status = useImportStatusStore()
  const {
    groups: allWorldGroups,
    activeGroupId,
    loadAll: loadWorldGroups,
  } = useWorldGroupStore()
  const phase = status.phase
  const isRunning = phase === 'running' || phase === 'merging' || phase === 'preparing'
  const isPaused = phase === 'paused'
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

  // ── 启动时：申请持久存储权限（一次性，浏览器会记住） ─────
  useEffect(() => {
    if (navigator.storage?.persist) {
      navigator.storage.persisted().then(already => {
        if (!already) {
          navigator.storage.persist().catch(() => {/* 用户拒绝也无所谓，后面还能跑 */})
        }
      }).catch(() => {})
    }
  }, [])

  // ── 初始：扫描项目内未完成会话，并尝试从 Blob 恢复 ────────
  useEffect(() => {
    let cancelled = false
    const scan = async () => {
      // 解析一次·多次落地:找已完成可复用的会话
      useImportSessionStore.getState().findReusableCompleted(project.id!).then(r => {
        if (!cancelled) setReusable(r)
      })
      const s = await useImportSessionStore.getState().findUnfinished(project.id!)
      if (cancelled || !s?.id) {
        setUnfinished(s || null)
        setBlobRestored(false)
        return
      }
      setUnfinished(s)
      // 如果 in-memory 里已经有原文，说明本会话没刷过，直接标记已恢复
      if (hasChunkTexts(s.id)) {
        setBlobRestored(true)
        return
      }
      // 否则尝试从 IndexedDB 的 Blob 恢复
      setRestoringBlob(true)
      try {
        const row = await useImportSessionStore.getState().loadBlob(s.id)
        if (cancelled) return
        if (row?.blob) {
          // 重新提取 → 切块 → 注册到内存
          // 包成 File 以复用现有抽取器（保留 filename 识别扩展名）
          const file = new File([row.blob], row.filename, { type: row.blob.type })
          const result = await extractTextFromFile(file)
          if (cancelled) return
          // 用 session 原 chunkSize 切
          const replan = chunkDocument(result.text, { targetChars: s.chunkSize })
          if (replan.length === s.totalChunks) {
            registerChunkTexts(s.id, replan.map(p => ({ index: p.index, text: p.text })))
            setBlobRestored(true)
          } else {
            // 切块数量对不上（chunker 逻辑改了 / 文件不同）—— 标记未恢复，用户手动处理
            console.warn(
              '[import] Blob 恢复后切块数对不上：',
              `原 ${s.totalChunks} vs 新 ${replan.length}`,
            )
            setBlobRestored(false)
          }
        } else {
          setBlobRestored(false)
        }
      } catch (err) {
        console.error('[import] 从 Blob 恢复失败：', err)
        setBlobRestored(false)
      } finally {
        if (!cancelled) setRestoringBlob(false)
      }
    }
    scan()
    return () => { cancelled = true }
  }, [project.id])

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

  // ── 文件上传 ──────────────────────────────────────────────
  /** 暂存最近一次上传的原始 File（创建 session 时存到 importFiles） */
  const lastUploadedFile = useRef<File | null>(null)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setFileError(null)
    setExtractInfo(null)
    setFilename(f.name)
    setRawText('')
    setPlans(null)
    setLoadingFile(true)
    lastUploadedFile.current = f
    try {
      const result = await extractTextFromFile(f)
      setRawText(result.text)
      const sizeMB = (f.size / 1024 / 1024).toFixed(2)
      const parts = [
        `文件 ${sizeMB} MB`,
        `抽取 ${result.rawChars.toLocaleString()} 字符`,
      ]
      if (result.pageCount) parts.push(`${result.pageCount} 页`)
      setExtractInfo(parts.join(' · '))
    } catch (err) {
      setFilename('')
      lastUploadedFile.current = null
      setFileError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingFile(false)
    }
  }

  // ── 点击"开始解析" ───────────────────────────────────────
  const handleStart = () => {
    if (!rawText.trim()) return
    const p = chunkDocument(rawText, { targetChars: chunkSize })
    setPlans(p)
    // Phase 28.4: 本地检测分卷结构
    const vd = detectVolumeStructure(rawText)
    setVolumeDetect(vd)
    setShowConfirm(true)
  }

  // 改 chunkSize 时重新切
  const handleChunkSizeChange = (size: number) => {
    setChunkSize(size)
    if (rawText.trim()) {
      const p = chunkDocument(rawText, { targetChars: size })
      setPlans(p)
    }
  }

  // ── 在 Confirm Modal 里确认：创建 session 并启动 ───────────
  const handleConfirmStart = async (importTarget: ImportTarget, selectedWorldGroupId?: number | null, depth?: import('../../lib/types').ReferenceAnalysisDepth) => {
    if (!plans) return
    if (importTarget === 'project' && project.enableMultiWorld && selectedWorldGroupId == null) {
      toast.error('请先选择本次导入要写入的目标世界。')
      return
    }
    setShowConfirm(false)

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
      const fileBlob = lastUploadedFile.current
        ? lastUploadedFile.current
        : new Blob([rawText], { type: 'text/plain;charset=utf-8' })
      const saveName = lastUploadedFile.current?.name || (filename || '粘贴内容.txt')
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
    setUnfinished(null)
    setBlobRestored(false)
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
      setReusable(null)
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
      setReusable(null)
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
      const fileBlob = lastUploadedFile.current
        ? lastUploadedFile.current
        : new Blob([rawText], { type: 'text/plain;charset=utf-8' })
      const saveName = lastUploadedFile.current?.name || (filename || '粘贴内容.txt')
      await useImportSessionStore.getState().saveBlob(
        unfinished.id, saveName, fileBlob, unfinished.fileHash,
      )
    } catch {/* 静默失败 */}
    setBlobRestored(true)
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

  // ── 预览统计 ──────────────────────────────────────────────
  const previewPlans = useMemo(() => {
    if (!rawText.trim()) return null
    return plans || chunkDocument(rawText, { targetChars: chunkSize })
  }, [rawText, chunkSize, plans])

  return (
    <div className="max-w-4xl p-6 space-y-4">
      {/* 顶部状态条：流水线跑起来后常驻显示 */}
      {phase !== 'idle' && (
        <div className="sticky top-0 z-10 bg-bg-base pb-2 flex items-center justify-between gap-3">
          <ImportStatusBar />
          <div className="flex items-center gap-1">
            {isRunning && (
              <button
                onClick={pausePipeline}
                className="flex items-center gap-1 px-2 py-1 text-xs text-warning hover:bg-warning/10 rounded"
              >
                <PauseCircle className="w-3.5 h-3.5" /> 暂停
              </button>
            )}
            {isPaused && status.sessionId && (
              <button
                onClick={() => runSession({ sessionId: status.sessionId!, projectId: project.id! })}
                className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded"
              >
                <PlayCircle className="w-3.5 h-3.5" /> 恢复
              </button>
            )}
            {(isRunning || isPaused) && (
              <button
                onClick={async () => {
                  const ok = await dialog.confirm({
                    title: '取消本次任务？',
                    message: '已入库的解析数据不会被删除。',
                    confirmText: '取消任务',
                    tone: 'danger',
                  })
                  if (ok) cancelPipeline()
                }}
                className="flex items-center gap-1 px-2 py-1 text-xs text-error hover:bg-error/10 rounded"
              >
                <StopCircle className="w-3.5 h-3.5" /> 取消
              </button>
            )}
          </div>
        </div>
      )}

      {/* 标题 + 介绍 */}
      <div>
        <h2 className="text-xl font-bold text-text-primary mb-1">📥 AI 分块文档解析</h2>
        <p className="text-sm text-text-muted">
          上传任意一份文档（设定集、成品小说、大纲草稿……甚至千万字长篇），AI 自动分块串行解析
          <span className="text-accent">世界观 / 角色 / 大纲章节</span>。
          开始解析前先选择写入<strong>当前项目</strong>还是<strong>项目参考</strong>；解析过程中即<strong>实时入库</strong>，
          完成后数据已就位，无需再手动导入。
        </p>
        <div className="mt-2 bg-bg-surface border border-border rounded-lg p-3 text-xs text-text-secondary">
          <div className="flex items-center gap-1.5 mb-1.5 text-text-primary">
            <Info className="w-3.5 h-3.5 text-accent" />
            <span className="font-medium">支持的文件格式与大小上限</span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {FILE_LIMIT_HINTS.map(h => (
              <div key={h.ext} className="text-center px-2 py-1.5 bg-bg-base rounded">
                <div className="text-xs font-mono text-accent">.{h.ext}</div>
                <div className="text-[10px] text-text-muted">{h.label}</div>
                <div className="text-xs text-text-primary font-medium">≤ {h.mb} MB</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-text-muted leading-relaxed">
            ⚠️ 大文档会自动按「章节边界」或「段落 / 字符数」切块，每块约 {chunkSize.toLocaleString()} 字，AI 串行处理。<br/>
            ✨ <strong>上传后原文会自动存档到浏览器本地 IndexedDB</strong>，即使关闭浏览器，下次打开可<strong>一键续跑</strong>，无需重新上传。
          </div>
        </div>
      </div>

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
            setUnfinished(null)
            setBlobRestored(false)
          }}
        />
      )}

      {/* 解析一次·多次落地:已完成会话可复用解析,直接做项目参考分析(不重新解析) */}
      {reusable && phase === 'idle' && !unfinished && (
        <div className="rounded-lg border border-purple-400/40 bg-purple-400/5 p-3 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-purple-300 mb-1">
            📦 检测到已解析《{reusable.filename}》（{reusable.totalChars.toLocaleString()} 字 · {reusable.totalChunks} 块）
          </div>
          <div className="text-text-muted mb-2 leading-relaxed">
            无需重新上传或解析（不再花 AI）。可<strong className="text-accent">直接灌进当前项目设定库</strong>（世界观/角色/大纲一键入库，不用一个个手填），或存为「项目参考」做 13 维分析{!hasChunkTexts(reusable.id!) && '（原文已不在内存，深层将退回浅层；如需深层请重新上传）'}：
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={applyingReuse} onClick={handleReuseToProject}
              className="px-3 py-1.5 rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50 font-medium">
              📥 灌进当前项目设定库
            </button>
            <button disabled={applyingReuse} onClick={() => handleReuseToReference('quick')}
              className="px-3 py-1.5 rounded bg-purple-500/80 text-white hover:bg-purple-500 disabled:opacity-50">
              ♻️ 应用到 项目参考 · 浅层（免费）
            </button>
            <button disabled={applyingReuse} onClick={() => handleReuseToReference('deep')}
              className="px-3 py-1.5 rounded border border-purple-400/60 text-purple-200 hover:bg-purple-400/10 disabled:opacity-50">
              🔬 应用到 项目参考 · 深层
            </button>
            <button disabled={applyingReuse} onClick={() => setReusable(null)}
              className="px-3 py-1.5 rounded text-text-muted hover:bg-bg-hover">
              忽略
            </button>
          </div>
        </div>
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
          onRawTextChange={text => {
            setRawText(text)
            setPlans(null)
            // 粘贴输入 ≠ 文件上传，清掉 File 引用避免下次误把旧 File 当原文存
            lastUploadedFile.current = null
          }}
          onStart={handleStart}
        />
      )}

      {/* 运行时：进度面板 + 活动日志 */}
      {phase !== 'idle' && (
        <div className="space-y-3">
          <ImportProgressPanel />
          <ImportActivityLog />
          {status.fatalError && (
            <div className="bg-error/10 border border-error/30 rounded-xl p-3 text-sm text-error">
              <AlertTriangle className="inline w-4 h-4 mr-1" />
              {status.fatalError}
            </div>
          )}

          {/* 完成/失败后的操作按钮栏 */}
          {(phase === 'done' || phase === 'failed') && (
            <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
              {status.failedChunks > 0 && (
                <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="text-sm text-warning flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{status.failedChunks} 个块解析失败，可重新尝试</span>
                  </div>
                  <button
                    onClick={handleRetryFailed}
                    className="flex items-center gap-1.5 px-4 py-2 bg-warning text-white text-sm rounded hover:bg-warning/90 shrink-0"
                  >
                    <RotateCcw className="w-4 h-4" /> 重试失败块
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    if (!status.sessionId) return
                    const s = await useImportSessionStore.getState().load(status.sessionId)
                    if (s) setReportSession(s)
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs text-text-secondary hover:text-accent hover:bg-accent/10 rounded border border-border"
                >
                  <FileBarChart2 className="w-3.5 h-3.5" /> 查看解析报告
                </button>
                <button
                  onClick={() => {
                    if (status.sessionId) {
                      clearChunkTexts(status.sessionId)
                      useImportSessionStore.getState().deleteBlob(status.sessionId).catch(() => {})
                    }
                    useImportStatusStore.getState().reset()
                    setReportSession(null)
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs text-text-muted hover:text-text-secondary hover:bg-bg-hover rounded border border-border"
                >
                  重新开始
                </button>
              </div>
            </div>
          )}
        </div>
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
          onCancel={() => setShowConfirm(false)}
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
