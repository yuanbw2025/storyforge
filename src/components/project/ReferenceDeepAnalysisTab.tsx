import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  CheckCircle2,
  History,
  Loader2,
  Microscope,
  RotateCcw,
  StopCircle,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import type {
  Reference,
  ReferenceAnalysisDepth,
  ReferenceAnalysisRun,
  ReferenceChunkAnalysis,
  ReferenceSourceKind,
  ReferenceUsageScope,
} from '../../lib/types'
import { DIMENSION_LABELS } from '../../lib/types/reference'
import {
  cancelRefAnalysisPipeline,
  getActiveRefAnalysisRunId,
  isRefAnalysisPipelineRunning,
  planRefChunks,
  registerRefChunks,
  runRefAnalysis,
  setRefAnalysisPipelineListener,
} from '../../lib/reference-analysis/pipeline'
import {
  activateReferenceAnalysisRun,
  createReferenceAnalysisRun,
  diffReferenceAnalysisChunks,
  discardReferenceAnalysisRun,
  listReferenceAnalysisRuns,
} from '../../lib/reference-analysis/lifecycle'
import { useReferenceStore } from '../../stores/reference'
import AnalysisReportViewer from './AnalysisReportViewer'

interface Props {
  reference: Reference
}

const STATUS_LABEL: Record<ReferenceAnalysisRun['status'], string> = {
  analyzing: '分析中',
  ready: '待确认',
  active: '当前使用',
  superseded: '历史版本',
  failed: '失败',
  cancelled: '已取消',
}

export default function ReferenceDeepAnalysisTab({ reference }: Props) {
  const { getChunkAnalyses, loadAll } = useReferenceStore()
  const [runs, setRuns] = useState<ReferenceAnalysisRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<number>()
  const [chunks, setChunks] = useState<ReferenceChunkAnalysis[]>([])
  const [activeChunks, setActiveChunks] = useState<ReferenceChunkAnalysis[]>([])
  const [depth, setDepth] = useState<ReferenceAnalysisDepth>('quick')
  const [sourceKind, setSourceKind] = useState<ReferenceSourceKind>('unknown')
  const [usageScope, setUsageScope] = useState<ReferenceUsageScope>('analysis-only')
  const [rightsNote, setRightsNote] = useState('')
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState('')
  const [activityLog, setActivityLog] = useState<{ level: string; msg: string }[]>([])
  const [running, setRunning] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(false)
  const reloadRequestRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      reloadRequestRef.current += 1
    }
  }, [])

  const reloadRuns = useCallback(async (preferRunId?: number) => {
    if (!reference.id) return
    const requestId = ++reloadRequestRef.current
    try {
      const nextRuns = await listReferenceAnalysisRuns(reference.id)
      const active = nextRuns.find(run => run.status === 'active')
      const selected = nextRuns.find(run => run.id === preferRunId)
        ?? active
        ?? nextRuns[0]
      const [nextChunks, nextActiveChunks] = await Promise.all([
        selected?.id ? getChunkAnalyses(reference.id, selected.id) : [],
        active?.id ? getChunkAnalyses(reference.id, active.id) : [],
      ])
      if (!mountedRef.current || requestId !== reloadRequestRef.current) return
      setRuns(nextRuns)
      setSelectedRunId(selected?.id)
      setChunks(nextChunks)
      setActiveChunks(nextActiveChunks)
      if (selected) setProgress(selected.progress)
      setRunning(isRefAnalysisPipelineRunning() && getActiveRefAnalysisRunId() === selected?.id)
    } catch (error) {
      if (!mountedRef.current || requestId !== reloadRequestRef.current) return
      setStatusMessage(error instanceof Error ? error.message : String(error))
    }
  }, [getChunkAnalyses, reference.id])

  useEffect(() => {
    reloadRuns()
  }, [reloadRuns])

  useEffect(() => {
    setRefAnalysisPipelineListener({
      onProgress: (nextProgress, message) => {
        setProgress(nextProgress)
        if (message) setStatusMessage(message)
      },
      onActivity: (level, message) => {
        setActivityLog(current => [...current.slice(-20), { level, msg: message }])
      },
      onDone: (referenceId, _success, runId) => {
        if (reference.id !== referenceId) return
        setRunning(false)
        void (async () => {
          await reloadRuns(runId)
          if (mountedRef.current) await loadAll(reference.projectId)
        })().catch(error => {
          if (mountedRef.current) {
            setStatusMessage(error instanceof Error ? error.message : String(error))
          }
        })
      },
    })
    return () => setRefAnalysisPipelineListener({})
  }, [loadAll, reference.id, reference.projectId, reloadRuns])

  useEffect(() => {
    if ((sourceKind === 'research' || sourceKind === 'unknown') && usageScope !== 'analysis-only') {
      setUsageScope('analysis-only')
    }
  }, [sourceKind, usageScope])

  const selectedRun = runs.find(run => run.id === selectedRunId)
  const activeRun = runs.find(run => run.status === 'active')
  const isAnalyzing = running
  const isHistorical = reference.type === 'historical'
  const diff = useMemo(
    () => selectedRun?.status === 'ready'
      ? diffReferenceAnalysisChunks(activeChunks, chunks)
      : undefined,
    [activeChunks, chunks, selectedRun?.status],
  )

  const handleSelectRun = async (run: ReferenceAnalysisRun) => {
    if (!reference.id || !run.id) return
    setSelectedRunId(run.id)
    setChunks(await getChunkAnalyses(reference.id, run.id))
    setProgress(run.progress)
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !reference.id) return
    try {
      if (!/\.(txt|md)$/i.test(file.name)) {
        throw new Error('此入口只接受 TXT / Markdown；EPUB 请通过侧边栏“导入”解析')
      }
      if (!rightsConfirmed) throw new Error('请先确认来源声明')
      const text = await file.text()
      if (!text.trim()) throw new Error('文件内容为空')
      const plan = planRefChunks(text, depth)
      const run = await createReferenceAnalysisRun({
        referenceId: reference.id,
        depth,
        sourceFilename: file.name,
        fileHash: plan.fileHash,
        totalChars: plan.totalChars,
        expectedChunks: plan.chunks.length,
        sourceKind,
        usageScope,
        rightsNote,
        rightsConfirmed: true,
        sourceText: text,
        sourceChunks: plan.chunks,
      })
      registerRefChunks(run.id!, plan.chunks)
      setSelectedRunId(run.id)
      setStatusMessage(`已保存「${file.name}」断点原文，共 ${plan.totalChars.toLocaleString()} 字、${plan.chunks.length} 块`)
      setActivityLog([])
      setProgress(0)
      await reloadRuns(run.id)
      setRunning(true)
      void runRefAnalysis(reference.id, run.id)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error))
    } finally {
      event.target.value = ''
    }
  }

  const handleResume = async () => {
    if (!reference.id || !selectedRun?.id) return
    setRunning(true)
    setProgress(selectedRun.progress)
    setStatusMessage('从本地断点原文继续分析')
    void runRefAnalysis(reference.id, selectedRun.id)
  }

  const handleActivate = async () => {
    if (!selectedRun?.id) return
    try {
      await activateReferenceAnalysisRun(selectedRun.id)
      await reloadRuns(selectedRun.id)
      await loadAll(reference.projectId)
      setStatusMessage(`v${selectedRun.version} 已激活`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const handleDiscard = async () => {
    if (!selectedRun?.id) return
    try {
      await discardReferenceAnalysisRun(selectedRun.id)
      await reloadRuns(activeRun?.id)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-bg-elevated rounded-lg p-3 text-xs text-text-muted leading-relaxed">
        <Microscope className="w-4 h-4 inline mr-1.5 text-accent" />
        {isHistorical ? '从历史背景、制度、日常生活、物质文化与称谓中提炼可追溯方法论。'
          : '从叙事、结构、节奏、人物、冲突、伏笔、文笔与世界观中提炼方法论。'}
        新上传先生成独立版本；只有你激活的版本会进入创作上下文，失败或取消不会覆盖当前结果。
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_1fr] bg-bg-elevated/60 border border-border rounded-lg p-3">
        <div className="space-y-2">
          <p className="text-xs font-medium text-text-primary">新分析设置</p>
          <div className="flex flex-wrap gap-2">
            <select value={depth} onChange={event => setDepth(event.target.value as ReferenceAnalysisDepth)}
              className="bg-bg-elevated border border-border rounded px-2 py-1.5 text-xs text-text-primary">
              <option value="quick">浅层 · 省 token</option>
              <option value="deep">深层 · 逐块精读</option>
            </select>
            <select value={sourceKind} onChange={event => setSourceKind(event.target.value as ReferenceSourceKind)}
              className="bg-bg-elevated border border-border rounded px-2 py-1.5 text-xs text-text-primary">
              <option value="own-work">本人原创</option>
              <option value="authorized">已获授权</option>
              <option value="public-domain">公版 / 明确许可</option>
              <option value="research">研究资料</option>
              <option value="unknown">来源待确认</option>
            </select>
            <select value={usageScope} onChange={event => setUsageScope(event.target.value as ReferenceUsageScope)}
              className="bg-bg-elevated border border-border rounded px-2 py-1.5 text-xs text-text-primary">
              <option value="analysis-only">仅分析</option>
              <option value="creative-reference" disabled={sourceKind === 'research' || sourceKind === 'unknown'}>创作参考</option>
              <option value="continuation-authorized" disabled={sourceKind === 'research' || sourceKind === 'unknown'}>已获续写授权</option>
            </select>
          </div>
          <input value={rightsNote} onChange={event => setRightsNote(event.target.value)}
            placeholder="可选：授权、许可或来源备注"
            className="w-full bg-bg-elevated border border-border rounded px-2 py-1.5 text-xs text-text-primary" />
          <label className="flex items-start gap-2 text-[11px] text-text-muted">
            <input type="checkbox" checked={rightsConfirmed} onChange={event => setRightsConfirmed(event.target.checked)}
              className="mt-0.5" />
            <span>我确认以上来源声明准确；StoryForge 只记录声明，不代替法律或版权核验。</span>
          </label>
          <input ref={fileInputRef} type="file" accept=".txt,.md" onChange={handleFileUpload} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} disabled={isAnalyzing}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors">
            <UploadCloud className="w-4 h-4" /> 上传并建立新版本
          </button>
          {statusMessage && <p className="text-[11px] text-text-muted">{statusMessage}</p>}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-text-primary flex items-center gap-1">
            <History className="w-3.5 h-3.5" /> 分析版本（最多 6 个）
          </p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {runs.length === 0 && <p className="text-xs text-text-muted">暂无分析版本</p>}
            {runs.map(run => (
              <button key={run.id} onClick={() => handleSelectRun(run)}
                className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded border text-xs ${
                  selectedRunId === run.id ? 'border-accent/50 bg-accent/10' : 'border-border hover:bg-bg-hover'
                }`}>
                <span className="text-text-primary">v{run.version} · {run.depth === 'deep' ? '深层' : '浅层'} · {run.sourceFilename}</span>
                <span className={run.status === 'active' ? 'text-green-400' : run.status === 'ready' ? 'text-amber-400' : 'text-text-muted'}>
                  {STATUS_LABEL[run.status]}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {isAnalyzing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-accent"><Loader2 className="w-4 h-4 animate-spin" /> 正在分析 v{selectedRun?.version}…</div>
            <button onClick={cancelRefAnalysisPipeline}
              className="flex items-center gap-1 px-3 py-1 text-xs text-red-400 border border-red-400/30 rounded">
              <StopCircle className="w-3.5 h-3.5" /> 取消
            </button>
          </div>
          <div className="h-2 bg-bg-elevated rounded-full overflow-hidden">
            <div className="h-full bg-accent transition-all rounded-full" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-xs text-text-muted">{progress}% — {statusMessage}</div>
        </div>
      )}

      {!isAnalyzing && selectedRun && (
        <div className="flex items-center justify-between gap-3 border border-border rounded-lg p-3">
          <div className="text-xs text-text-muted">
            <p className="text-sm text-text-primary flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4" /> v{selectedRun.version} · {STATUS_LABEL[selectedRun.status]} · {chunks.length}/{selectedRun.expectedChunks} 块
            </p>
            <p className="mt-1">
              来源：{selectedRun.sourceKind} · 范围：{selectedRun.usageScope}
              {!selectedRun.rightsConfirmed && <span className="text-amber-400"> · 旧数据未确认声明</span>}
            </p>
            {selectedRun.error && <p className="text-amber-400 mt-1">{selectedRun.error}</p>}
          </div>
          <div className="flex items-center gap-2">
            {(selectedRun.status === 'analyzing' || selectedRun.status === 'failed' || selectedRun.status === 'cancelled') && (
              <button onClick={handleResume} className="flex items-center gap-1 px-3 py-1.5 text-xs border border-accent/40 text-accent rounded">
                <RotateCcw className="w-3.5 h-3.5" /> 断点续跑
              </button>
            )}
            {(selectedRun.status === 'ready' || selectedRun.status === 'superseded') && (
              <button onClick={handleActivate} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent text-white rounded">
                <CheckCircle2 className="w-3.5 h-3.5" /> {selectedRun.status === 'superseded' ? '回滚到此版本' : '确认并激活'}
              </button>
            )}
            {selectedRun.status !== 'active' && (
              <button onClick={handleDiscard} className="p-1.5 text-text-muted hover:text-red-400" aria-label="删除此分析版本">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {diff && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 text-xs">
          <p className="font-medium text-amber-400 mb-1">激活前差异</p>
          <p className="text-text-muted">
            新增 {diff.added.length} 维、变化 {diff.changed.length} 维、移除 {diff.removed.length} 维、未变 {diff.unchanged.length} 维
          </p>
          {(diff.added.length + diff.changed.length + diff.removed.length) > 0 && (
            <p className="mt-1 text-text-primary">
              {[...diff.added, ...diff.changed, ...diff.removed].map(dim => DIMENSION_LABELS[dim]).join('、')}
            </p>
          )}
        </div>
      )}

      {isAnalyzing && activityLog.length > 0 && (
        <div className="bg-bg-elevated rounded-lg p-2 max-h-28 overflow-y-auto text-[11px] font-mono space-y-0.5">
          {activityLog.map((log, index) => (
            <div key={index} className={log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-yellow-400' : log.level === 'success' ? 'text-green-400' : 'text-text-muted'}>
              {log.msg}
            </div>
          ))}
        </div>
      )}

      {chunks.length > 0 && !isAnalyzing && selectedRun && (
        <AnalysisReportViewer reference={reference} run={selectedRun} chunks={chunks} isHistorical={isHistorical} />
      )}
    </div>
  )
}
