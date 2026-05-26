import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Download, Loader2, AlertCircle, RefreshCw,
  StopCircle, Calendar, Hash, BookOpen, Sparkles,
  BarChart3, Activity,
} from 'lucide-react'
import MasterAnalysisReport from './MasterAnalysisReport'
import MasterStyleCard from './MasterStyleCard'
import MasterBeatsTimeline from './MasterBeatsTimeline'
import { useMasterStudyStore } from '../../stores/master-study'
import {
  setMasterPipelineListener,
  cancelMasterPipeline,
  getActiveMasterWorkId,
  hasMasterChunks,
  runMasterAnalysis,
  loadMasterBlob,
} from '../../lib/master-study/pipeline'
import { computeAndSaveStyleMetrics } from '../../lib/master-study/style-analyzer'
import {
  extractChapterBeats,
  splitIntoChapters,
  cancelBeatExtraction,
  type BeatExtractorListener,
} from '../../lib/master-study/beat-extractor'
import { extractTextFromFile } from '../../lib/doc-parser'
import { downloadAnalysisArchive } from '../../lib/master-study/export-archive'
import type {
  MasterWork, MasterChunkAnalysis, MasterChapterBeat,
  MasterStyleMetrics, MasterWorkStatus,
} from '../../lib/types/master-study'

interface Props {
  workId: number
  onBack: () => void
}

/**
 * 作品详情页（Phase 19-b）
 *
 * 展示：
 *  · Header：标题 / 作者 / 流派 / 深度 / 状态
 *  · 实时 progress + 活动日志（订阅 pipeline listener）
 *  · 操作：下载档案 / 重新分析（仅 pending/failed）/ 取消分析（仅 analyzing）
 *  · 五维分析报告
 */
export default function MasterWorkDetail({ workId, onBack }: Props) {
  const { getWork, listChunkAnalysis, listChapterBeats, getStyleMetrics } = useMasterStudyStore()

  const [work, setWork] = useState<MasterWork | null>(null)
  const [analyses, setAnalyses] = useState<MasterChunkAnalysis[]>([])
  const [beats, setBeats] = useState<MasterChapterBeat[]>([])
  const [styleMetrics, setStyleMetrics] = useState<MasterStyleMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [log, setLog] = useState<Array<{ level: string; message: string; ts: number }>>([])
  const [downloading, setDownloading] = useState(false)
  const [runningStyleCompute, setRunningStyleCompute] = useState(false)
  const [runningBeats, setRunningBeats] = useState(false)
  const [beatProgress, setBeatProgress] = useState<{ done: number; total: number } | null>(null)

  // 从 store 订阅 works 数组以便 progress 实时刷新
  const storeWorks = useMasterStudyStore(s => s.works)
  const liveWork = useMemo(
    () => storeWorks.find(w => w.id === workId) || work,
    [storeWorks, workId, work],
  )

  // 初次加载数据（Layer 1 + Layer 2）
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [w, rows, b, sm] = await Promise.all([
          getWork(workId),
          listChunkAnalysis(workId),
          listChapterBeats(workId),
          getStyleMetrics(workId),
        ])
        if (cancelled) return
        setWork(w)
        setAnalyses(rows)
        setBeats(b)
        setStyleMetrics(sm)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [workId, getWork, listChunkAnalysis, listChapterBeats, getStyleMetrics])

  // 订阅 pipeline 事件（仅当本作品是当前 active）
  useEffect(() => {
    setMasterPipelineListener({
      onProgress: () => {
        // progress 会通过 store 的 patchWork 自动刷新 liveWork，这里不用手动
      },
      onActivity: (level, message) => {
        setLog(prev => {
          const next = [...prev, { level, message, ts: Date.now() }]
          return next.length > 200 ? next.slice(-200) : next
        })
      },
      onDone: async (finishedId) => {
        if (finishedId !== workId) return
        const [rows, b, sm] = await Promise.all([
          listChunkAnalysis(workId),
          listChapterBeats(workId),
          getStyleMetrics(workId),
        ])
        setAnalyses(rows)
        setBeats(b)
        setStyleMetrics(sm)
      },
    })
    return () => {
      // 卸载时不清除 listener（别的页面可能还需要看日志）
      // 但如果当前就是本页，给个 noop 防泄漏
      setMasterPipelineListener({})
    }
  }, [workId, listChunkAnalysis])

  const handleDownload = async () => {
    if (!liveWork?.id) return
    setDownloading(true)
    try {
      const [chunkAnalyses, chapterBeats, styleMetrics] = await Promise.all([
        listChunkAnalysis(liveWork.id),
        listChapterBeats(liveWork.id),
        getStyleMetrics(liveWork.id),
      ])
      downloadAnalysisArchive({
        work: liveWork,
        chunkAnalyses,
        chapterBeats: chapterBeats.length ? chapterBeats : undefined,
        styleMetrics: styleMetrics ?? null,
      })
    } catch (err) {
      alert(`下载失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDownloading(false)
    }
  }

  const handleRerun = async () => {
    if (!liveWork?.id) return
    if (!hasMasterChunks(liveWork.id)) {
      alert('⚠ 原文已从内存清除（页面可能刷新过）。请回到列表删除后重新上传同一文件。')
      return
    }
    runMasterAnalysis({ workId: liveWork.id }).catch(err => {
      console.error('[master] runMasterAnalysis 崩了：', err)
    })
  }

  const handleCancel = () => {
    if (!liveWork?.id) return
    if (getActiveMasterWorkId() !== liveWork.id) return
    if (!confirm('确认取消本次分析？已完成的块会保留。')) return
    cancelMasterPipeline()
  }

  const handleRunStyleMetrics = async () => {
    if (!liveWork?.id) return
    setRunningStyleCompute(true)
    try {
      const blob = await loadMasterBlob(liveWork.id)
      if (!blob) {
        alert('原文已丢失（页面可能刷新过且 Blob 未保存），请重新上传。')
        return
      }
      const file = new File([blob.blob], blob.filename, { type: 'text/plain' })
      const { text } = await extractTextFromFile(file)
      const sm = await computeAndSaveStyleMetrics(liveWork.id, text)
      setStyleMetrics(sm)
    } catch (err) {
      alert(`风格量化失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunningStyleCompute(false)
    }
  }

  const handleRunBeats = async () => {
    if (!liveWork?.id) return
    setRunningBeats(true)
    setBeatProgress(null)
    try {
      const blob = await loadMasterBlob(liveWork.id)
      if (!blob) {
        alert('原文已丢失，请重新上传。')
        setRunningBeats(false)
        return
      }
      const file = new File([blob.blob], blob.filename, { type: 'text/plain' })
      const { text } = await extractTextFromFile(file)
      const chapters = splitIntoChapters(text)

      const listener: BeatExtractorListener = {
        onProgress: (done, total) => setBeatProgress({ done, total }),
        onActivity: (level, message) => {
          setLog(prev => {
            const next = [...prev, { level, message, ts: Date.now() }]
            return next.length > 200 ? next.slice(-200) : next
          })
        },
      }

      await extractChapterBeats(liveWork, chapters, listener)
      const b = await listChapterBeats(liveWork.id)
      setBeats(b)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        alert(`节奏分析失败：${err instanceof Error ? err.message : String(err)}`)
      }
    } finally {
      setRunningBeats(false)
      setBeatProgress(null)
    }
  }

  const handleCancelBeats = () => {
    if (!confirm('确认取消节奏分析？已完成的章节会保留。')) return
    cancelBeatExtraction()
  }

  if (loading || !liveWork) {
    return (
      <div className="flex items-center justify-center py-16 text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        加载中…
      </div>
    )
  }

  const isActiveHere = getActiveMasterWorkId() === liveWork.id
  const depthLabel = { quick: '快速', standard: '标准', deep: '深度' }[liveWork.analysisDepth]

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* 顶部返回栏 */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 px-2 py-1 text-sm text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="w-4 h-4" />
          返回作品列表
        </button>
        <div className="flex items-center gap-2">
          {(liveWork.status === 'pending' || liveWork.status === 'failed') && (
            <button
              onClick={handleRerun}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent text-white text-xs hover:opacity-90"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {liveWork.status === 'failed' ? '继续分析' : '开始分析'}
            </button>
          )}
          {liveWork.status === 'analyzing' && isActiveHere && (
            <button
              onClick={handleCancel}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-error/40 text-error text-xs hover:bg-error/10"
            >
              <StopCircle className="w-3.5 h-3.5" />
              取消分析
            </button>
          )}
          <button
            onClick={handleDownload}
            disabled={downloading || analyses.length === 0}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-sm text-text-primary hover:bg-bg-hover disabled:opacity-50"
          >
            {downloading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            下载档案
          </button>
        </div>
      </div>

      {/* Header 卡片 */}
      <div className="rounded-2xl border border-border bg-bg-surface p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
            <BookOpen className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-text-primary">{liveWork.title}</h1>
            <p className="text-sm text-text-muted mt-0.5">
              {liveWork.author || '（未知作者）'}
              {liveWork.genre ? ` · ${liveWork.genre}` : ''}
            </p>
            <div className="mt-2 flex items-center gap-3 flex-wrap text-xs text-text-secondary">
              <StatusBadge status={liveWork.status} />
              <span className="inline-flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> {depthLabel}分析
              </span>
              <span className="inline-flex items-center gap-1">
                <Hash className="w-3 h-3" /> {(liveWork.totalChars / 10000).toFixed(1)} 万字
              </span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="w-3 h-3" /> {formatDate(liveWork.updatedAt)}
              </span>
            </div>
          </div>
        </div>

        {/* 进度条 */}
        {(liveWork.status === 'analyzing' || (liveWork.status === 'done' && liveWork.progress < 100)) && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-text-muted mb-1">
              <span>分析进度</span>
              <span>{liveWork.progress.toFixed(0)}%</span>
            </div>
            <div className="h-2 rounded-full bg-bg-elevated overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${Math.max(0, Math.min(100, liveWork.progress))}%` }}
              />
            </div>
          </div>
        )}

        {liveWork.status === 'failed' && liveWork.errorMessage && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-error/10 border border-error/30 text-xs text-error flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {liveWork.errorMessage}
          </div>
        )}
      </div>

      {/* 运行日志（仅在有日志时显示） */}
      {log.length > 0 && (
        <details className="rounded-xl border border-border bg-bg-surface">
          <summary className="px-4 py-2 text-sm font-medium text-text-primary cursor-pointer select-none">
            运行日志（{log.length} 条）
          </summary>
          <div className="px-4 pb-3 max-h-60 overflow-y-auto font-mono text-[11px] space-y-0.5">
            {log.slice(-100).map((l, i) => (
              <div key={i} className={logColor(l.level)}>
                <span className="text-text-muted mr-2">{formatTime(l.ts)}</span>
                {l.message}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* 分析报告 */}
      <div>
        <h2 className="text-base font-semibold text-text-primary mb-2">五维分析报告</h2>
        <MasterAnalysisReport analyses={analyses} />
      </div>

      {/* Layer 2：风格量化 + 节奏时间线 */}
      {liveWork.status === 'done' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-text-primary">Layer 2 深度分析</h2>
            <div className="flex items-center gap-2">
              {!styleMetrics && (
                <button
                  onClick={handleRunStyleMetrics}
                  disabled={runningStyleCompute}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs text-text-primary hover:bg-bg-hover disabled:opacity-50"
                >
                  {runningStyleCompute
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <BarChart3 className="w-3.5 h-3.5" />}
                  {runningStyleCompute ? '计算中…' : '运行风格量化'}
                </button>
              )}
              {beats.length === 0 && !runningBeats && (
                <button
                  onClick={handleRunBeats}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs text-text-primary hover:bg-bg-hover"
                >
                  <Activity className="w-3.5 h-3.5" />
                  运行节奏分析
                </button>
              )}
              {runningBeats && (
                <button
                  onClick={handleCancelBeats}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-error/40 text-error text-xs hover:bg-error/10"
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  取消节奏分析
                </button>
              )}
            </div>
          </div>

          {/* 节奏分析进度 */}
          {runningBeats && beatProgress && (
            <div className="rounded-lg border border-border bg-bg-surface p-3">
              <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                <span>节奏分析进度</span>
                <span>{beatProgress.done} / {beatProgress.total} 章</span>
              </div>
              <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${(beatProgress.done / beatProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {styleMetrics && <MasterStyleCard metrics={styleMetrics} />}
          {beats.length > 0 && <MasterBeatsTimeline beats={beats} />}

          {!styleMetrics && beats.length === 0 && !runningStyleCompute && !runningBeats && (
            <div className="rounded-xl border border-dashed border-border bg-bg-elevated/30 p-6 text-center">
              <p className="text-sm text-text-muted">
                Layer 2 分析尚未运行。点击上方按钮开始风格量化或节奏分析。
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────

function StatusBadge({ status }: { status: MasterWorkStatus }) {
  const label: Record<MasterWorkStatus, string> = {
    pending: '待开始',
    analyzing: '分析中…',
    done: '已完成',
    failed: '失败',
  }
  const color: Record<MasterWorkStatus, string> = {
    pending: 'text-text-muted bg-bg-elevated',
    analyzing: 'text-accent bg-accent/10',
    done: 'text-emerald-500 bg-emerald-500/10',
    failed: 'text-red-500 bg-red-500/10',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${color[status]}`}>
      {status === 'analyzing' && <Loader2 className="w-3 h-3 animate-spin" />}
      {label[status]}
    </span>
  )
}

function logColor(level: string): string {
  switch (level) {
    case 'success': return 'text-emerald-500'
    case 'warn':    return 'text-amber-500'
    case 'error':   return 'text-red-500'
    default:        return 'text-text-secondary'
  }
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
