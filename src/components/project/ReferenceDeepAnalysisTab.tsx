import { useEffect, useRef, useState } from 'react'
import { BarChart3, Loader2, Microscope, StopCircle, UploadCloud } from 'lucide-react'
import type { Reference, ReferenceAnalysisDepth, ReferenceChunkAnalysis } from '../../lib/types'
import {
  cancelRefAnalysisPipeline,
  planRefChunks,
  registerRefChunks,
  runRefAnalysis,
  setRefAnalysisPipelineListener,
} from '../../lib/reference-analysis/pipeline'
import { useReferenceStore } from '../../stores/reference'
import AnalysisReportViewer from './AnalysisReportViewer'

interface Props {
  reference: Reference
  onUpdate: (data: Partial<Reference>) => void
}

export default function ReferenceDeepAnalysisTab({ reference, onUpdate }: Props) {
  const { getChunkAnalyses, clearChunkAnalyses } = useReferenceStore()
  const [chunks, setChunks] = useState<ReferenceChunkAnalysis[]>([])
  const [depth, setDepth] = useState<ReferenceAnalysisDepth>(reference.analysisDepth || 'quick')
  const [progress, setProgress] = useState(reference.analysisProgress || 0)
  const [statusMessage, setStatusMessage] = useState('')
  const [activityLog, setActivityLog] = useState<{ level: string; msg: string }[]>([])
  const [running, setRunning] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const status = reference.analysisStatus || 'none'

  useEffect(() => {
    if (reference.id && (status === 'done' || status === 'analyzing')) {
      getChunkAnalyses(reference.id).then(setChunks)
    }
  }, [getChunkAnalyses, reference.id, status])

  useEffect(() => {
    setRefAnalysisPipelineListener({
      onProgress: (nextProgress, message) => {
        setProgress(nextProgress)
        if (message) setStatusMessage(message)
      },
      onActivity: (level, message) => {
        setActivityLog(current => [...current.slice(-20), { level, msg: message }])
      },
      onDone: (referenceId) => {
        setRunning(false)
        if (reference.id === referenceId) getChunkAnalyses(referenceId).then(setChunks)
      },
    })
    return () => setRefAnalysisPipelineListener({})
  }, [getChunkAnalyses, reference.id])

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !reference.id) return
    const text = await file.text()
    if (!text.trim()) {
      setStatusMessage('文件内容为空')
      return
    }

    const plan = planRefChunks(text, depth)
    onUpdate({
      totalChars: plan.totalChars,
      fileHash: plan.fileHash,
      analysisDepth: depth,
      analysisStatus: 'pending',
      analysisProgress: 0,
      analysisError: undefined,
    })
    await clearChunkAnalyses(reference.id)
    setChunks([])
    registerRefChunks(reference.id, plan.chunks)
    setStatusMessage(`已加载「${file.name}」，共 ${plan.totalChars.toLocaleString()} 字，分 ${plan.chunks.length} 块`)
    setActivityLog([])
    setRunning(true)
    setProgress(0)
    runRefAnalysis(reference.id)
    event.target.value = ''
  }

  const handleCancel = () => {
    cancelRefAnalysisPipeline()
    setRunning(false)
  }
  const handleReanalyze = () => {
    if (!reference.id) return
    setStatusMessage('请上传文件以重新分析')
    fileInputRef.current?.click()
  }

  const isAnalyzing = status === 'analyzing' || running
  const isHistorical = reference.type === 'historical'

  return (
    <div className="space-y-4">
      <div className="bg-bg-elevated rounded-lg p-3 text-xs text-text-muted leading-relaxed">
        <Microscope className="w-4 h-4 inline mr-1.5 text-accent" />
        {isHistorical ? (
          <>
            上传历史文献、考证资料或学术论文，让 AI 从
            <span className="text-amber-500 font-medium"> 历史背景、社会制度、日常生活、物质文化、语言习惯 </span>
            等维度提炼最地道的时代细节。分析结果永久保留在浏览器本地，创作时可「引用手法」注入 AI prompt 上下文。
          </>
        ) : (
          <>
            上传优秀网文 / 小说样本，让 AI 从
            <span className="text-accent font-medium"> 叙事架构、开篇技法、情节节奏、人物塑造、冲突升级、伏笔悬念、文笔对话、世界观构建 </span>
            八个维度提炼创作方法论。分析结果永久保留在浏览器本地，创作时可「引用手法」注入 AI prompt 上下文。
          </>
        )}
      </div>

      {!isAnalyzing && status !== 'done' && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">分析深度：</span>
            <select value={depth} onChange={event => setDepth(event.target.value as ReferenceAnalysisDepth)}
              className="bg-bg-elevated border border-border rounded px-2 py-1 text-xs text-text-primary">
              <option value="quick">浅层 · 快速摸底（每维 50-100 字，省 token）</option>
              <option value="deep">深层 · 拆成模板（每维 300-500 字 + 原文佐证）</option>
            </select>
          </div>
          <input ref={fileInputRef} type="file" accept=".txt,.md,.epub" onChange={handleFileUpload} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover transition-colors">
            <UploadCloud className="w-4 h-4" /> 上传文件并分析
          </button>
        </div>
      )}

      {isAnalyzing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-accent"><Loader2 className="w-4 h-4 animate-spin" /> 正在分析...</div>
            <button onClick={handleCancel}
              className="flex items-center gap-1 px-3 py-1 text-xs text-red-400 hover:text-red-300 border border-red-400/30 rounded transition-colors">
              <StopCircle className="w-3.5 h-3.5" /> 取消
            </button>
          </div>
          <div className="h-2 bg-bg-elevated rounded-full overflow-hidden">
            <div className="h-full bg-accent transition-all duration-300 rounded-full" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-xs text-text-muted">{progress}% — {statusMessage}</div>
        </div>
      )}

      {status === 'done' && !isAnalyzing && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-green-400">
            <BarChart3 className="w-4 h-4" /> 分析完成 — 共 {chunks.length} 块
            {reference.totalChars && <span className="text-text-muted text-xs">（{reference.totalChars.toLocaleString()} 字）</span>}
          </div>
          <button onClick={handleReanalyze}
            className="flex items-center gap-1 px-3 py-1.5 text-xs text-text-muted hover:text-accent border border-border rounded-lg transition-colors">
            重新分析
          </button>
        </div>
      )}

      {status === 'failed' && !isAnalyzing && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-sm text-red-400">分析失败</p>
          {reference.analysisError && <p className="text-xs text-text-muted mt-1">{reference.analysisError}</p>}
          <button onClick={handleReanalyze}
            className="mt-2 flex items-center gap-1 px-3 py-1.5 text-xs text-accent border border-accent/30 rounded-lg hover:bg-accent/10 transition-colors">
            重新上传并分析
          </button>
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

      {chunks.length > 0 && !isAnalyzing && (
        <AnalysisReportViewer reference={reference} chunks={chunks} isHistorical={isHistorical} />
      )}
    </div>
  )
}
