import { useEffect, useState } from 'react'
import {
  Check,
  ChevronRight,
  ClipboardCopy,
  Loader2,
  Save,
  Sparkles,
  X,
} from 'lucide-react'
import type { TokenUsage } from '../../../lib/ai/logger'
import type { PromptWorkflowStep, SaveTarget } from '../../../lib/types/workflow'
import { targetLabel } from './workflow-helpers'

export interface StepResult {
  stepId: string
  output: string
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed'
  error?: string
  tokenUsage?: TokenUsage | null
}

interface Props {
  step: PromptWorkflowStep
  index: number
  result: StepResult
  isCurrent: boolean
  onSkip: () => void
  onRetry: () => void
  onSave: (output: string, target: SaveTarget) => void
  onUserInputChange: (value: string) => void
  onOutputChange: (value: string) => void
  saved: boolean
  hasProject: boolean
}

export function WorkflowStepCard({
  step,
  index,
  result,
  isCurrent,
  onSkip,
  onRetry,
  onSave,
  onUserInputChange,
  onOutputChange,
  saved,
  hasProject,
}: Props) {
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)
  const [userInput, setUserInput] = useState('')
  const [editedOutput, setEditedOutput] = useState('')
  useEffect(() => { setEditedOutput(result.output || '') }, [result.output])

  const handleCopy = () => {
    if (!editedOutput) return
    navigator.clipboard.writeText(editedOutput).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const statusIcon = {
    pending: <ChevronRight className="w-4 h-4 text-text-muted" />,
    running: <Loader2 className="w-4 h-4 text-accent animate-spin" />,
    done: <Check className="w-4 h-4 text-success" />,
    skipped: <X className="w-4 h-4 text-text-muted" />,
    failed: <X className="w-4 h-4 text-error" />,
  }[result.status]

  const borderClass = isCurrent
    ? 'border-accent'
    : result.status === 'done'
      ? 'border-success/40'
      : result.status === 'failed'
        ? 'border-error/40'
        : 'border-border'

  return (
    <div className={`bg-bg-surface border-2 rounded-xl overflow-hidden ${borderClass}`}>
      <button onClick={() => setExpanded(value => !value)} className="w-full flex items-center gap-2 p-3 hover:bg-bg-hover">
        {statusIcon}
        <span className="text-text-muted text-xs w-6">{index + 1}.</span>
        <span className="text-sm font-medium text-text-primary">{step.label}</span>
        <span className="text-xs text-text-muted">→ {step.promptModuleKey}</span>
        {step.userConfirmRequired && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning">⏸ 需确认</span>
        )}
        <span className="ml-auto text-xs text-text-muted">
          {result.status === 'done' && `${result.output.length} 字`}
          {result.status === 'failed' && '失败'}
          {result.status === 'skipped' && '已跳过'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border p-3 space-y-2 bg-bg-base">
          {step.userHint && <p className="text-xs text-text-muted">💡 {step.userHint}</p>}
          <textarea
            value={userInput}
            onChange={event => {
              setUserInput(event.target.value)
              onUserInputChange(event.target.value)
            }}
            rows={2}
            placeholder="你的输入(可选)：在此写本步内容,AI 会在你写的基础上生成/扩展"
            className="w-full px-2 py-1.5 bg-bg-surface border border-border rounded text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
          />
          {result.status === 'pending' && <p className="text-xs text-text-muted">待执行</p>}
          {result.status === 'running' && (
            <p className="text-xs text-accent flex items-center gap-1">
              <Sparkles className="w-3 h-3 animate-pulse" /> AI 生成中...
            </p>
          )}
          {result.status === 'done' && result.tokenUsage && (
            <div className="text-[10px] text-text-muted">
              Token: ↑{result.tokenUsage.inputTokens.toLocaleString()} ↓{result.tokenUsage.outputTokens.toLocaleString()}
            </div>
          )}
          {result.status === 'done' && (
            <>
              <textarea
                value={editedOutput}
                onChange={event => {
                  setEditedOutput(event.target.value)
                  onOutputChange(event.target.value)
                }}
                rows={8}
                className="w-full text-xs text-text-primary font-sans max-h-72 p-2 bg-bg-surface border border-border rounded resize-y focus:outline-none focus:border-accent"
              />
              <p className="text-[10px] text-text-muted">AI 输出可直接编辑,保存/复制将使用编辑后的内容。</p>
            </>
          )}
          {result.error && <p className="text-xs text-error">⚠ {result.error}</p>}
          {(result.status === 'done' || result.status === 'failed') && (
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <button onClick={onRetry} className="text-xs text-accent hover:underline">重新生成</button>
              {result.status === 'done' && (
                <>
                  <span className="text-text-muted">·</span>
                  <button onClick={handleCopy} className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
                    {copied ? <Check className="w-3 h-3 text-success" /> : <ClipboardCopy className="w-3 h-3" />}
                    {copied ? '已复制' : '复制'}
                  </button>
                  {step.saveTarget && (
                    <>
                      <span className="text-text-muted">·</span>
                      <button
                        onClick={() => onSave(editedOutput, step.saveTarget!)}
                        disabled={saved || !hasProject}
                        title={!hasProject ? '需先进入项目' : `自动写入 ${targetLabel(step.saveTarget)}`}
                        className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded ${
                          saved
                            ? 'bg-success/15 text-success'
                            : !hasProject
                              ? 'text-text-muted opacity-50 cursor-not-allowed'
                              : 'bg-accent/10 text-accent hover:bg-accent/20'
                        }`}
                      >
                        {saved ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
                        {saved ? `已存到 ${targetLabel(step.saveTarget)}` : `保存到 ${targetLabel(step.saveTarget)}`}
                      </button>
                    </>
                  )}
                </>
              )}
              {result.status !== 'done' && (
                <>
                  <span className="text-text-muted">·</span>
                  <button onClick={onSkip} className="text-xs text-text-secondary hover:underline">跳过此步</button>
                </>
              )}
            </div>
          )}
          {result.status === 'pending' && isCurrent && (
            <button onClick={onSkip} className="text-xs text-text-secondary hover:underline">跳过此步</button>
          )}
        </div>
      )}
    </div>
  )
}

export default WorkflowStepCard
