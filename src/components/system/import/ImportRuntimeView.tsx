import { AlertTriangle, FileBarChart2, PauseCircle, PlayCircle, RotateCcw, StopCircle } from 'lucide-react'
import type { PipelinePhase } from '../../../stores/import-status'
import ImportActivityLog from './ImportActivityLog'
import ImportProgressPanel from './ImportProgressPanel'
import ImportStatusBar from './ImportStatusBar'

export function ImportPipelineControls({
  phase,
  canResume,
  onPause,
  onResume,
  onCancel,
}: {
  phase: PipelinePhase
  canResume: boolean
  onPause: () => void
  onResume: () => void
  onCancel: () => void
}) {
  const isRunning = phase === 'running' || phase === 'merging' || phase === 'preparing'
  const isPaused = phase === 'paused'
  if (phase === 'idle') return null

  return (
    <div className="sticky top-0 z-10 bg-bg-base pb-2 flex items-center justify-between gap-3">
      <ImportStatusBar />
      <div className="flex items-center gap-1">
        {isRunning && (
          <button onClick={onPause} className="flex items-center gap-1 px-2 py-1 text-xs text-warning hover:bg-warning/10 rounded">
            <PauseCircle className="w-3.5 h-3.5" /> 暂停
          </button>
        )}
        {isPaused && canResume && (
          <button onClick={onResume} className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded">
            <PlayCircle className="w-3.5 h-3.5" /> 恢复
          </button>
        )}
        {(isRunning || isPaused) && (
          <button onClick={onCancel} className="flex items-center gap-1 px-2 py-1 text-xs text-error hover:bg-error/10 rounded">
            <StopCircle className="w-3.5 h-3.5" /> 取消
          </button>
        )}
      </div>
    </div>
  )
}

export default function ImportRuntimeView({
  phase,
  fatalError,
  failedChunks,
  onRetryFailed,
  onShowReport,
  onRestart,
}: {
  phase: Exclude<PipelinePhase, 'idle'>
  fatalError: string | null
  failedChunks: number
  onRetryFailed: () => void
  onShowReport: () => void
  onRestart: () => void
}) {
  return (
    <div className="space-y-3">
      <ImportProgressPanel />
      <ImportActivityLog />
      {fatalError && (
        <div className="bg-error/10 border border-error/30 rounded-xl p-3 text-sm text-error">
          <AlertTriangle className="inline w-4 h-4 mr-1" />
          {fatalError}
        </div>
      )}

      {(phase === 'done' || phase === 'failed') && (
        <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
          {failedChunks > 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 flex items-center justify-between gap-3">
              <div className="text-sm text-warning flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{failedChunks} 个块解析失败，可重新尝试</span>
              </div>
              <button onClick={onRetryFailed}
                className="flex items-center gap-1.5 px-4 py-2 bg-warning text-white text-sm rounded hover:bg-warning/90 shrink-0">
                <RotateCcw className="w-4 h-4" /> 重试失败块
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button onClick={onShowReport}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-text-secondary hover:text-accent hover:bg-accent/10 rounded border border-border">
              <FileBarChart2 className="w-3.5 h-3.5" /> 查看解析报告
            </button>
            <button onClick={onRestart}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-text-muted hover:text-text-secondary hover:bg-bg-hover rounded border border-border">
              重新开始
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
