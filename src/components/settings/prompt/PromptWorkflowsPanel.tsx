import { useState, useEffect } from 'react'
import {
  Play, Trash2, Copy, ArrowRight, Square,
  Sparkles, Check, X, Loader2, ChevronRight, Save, ClipboardCopy,
} from 'lucide-react'
import { useWorkflowStore } from '../../../stores/workflow'
import { usePromptStore } from '../../../stores/prompt'
import { useWorldviewStore } from '../../../stores/worldview'
import { useCreativeRulesStore } from '../../../stores/creative-rules'
import { useAIStream } from '../../../hooks/useAIStream'
import { renderPrompt } from '../../../lib/ai/prompt-engine'
import type { PromptWorkflow, PromptWorkflowStep, SaveTarget } from '../../../lib/types/workflow'
import type { Project } from '../../../lib/types'

interface Props {
  project?: Project
}

/** 工作流面板：列表 + Runner（在同一面板切换） */
export default function PromptWorkflowsPanel({ project }: Props = {}) {
  const workflows = useWorkflowStore(s => s.workflows)
  const cloneWorkflow = useWorkflowStore(s => s.clone)
  const removeWorkflow = useWorkflowStore(s => s.remove)
  const initWorkflows = useWorkflowStore(s => s.init)

  const [runningId, setRunningId] = useState<number | null>(null)

  useEffect(() => { initWorkflows() }, [initWorkflows])

  if (runningId !== null) {
    const wf = workflows.find(w => w.id === runningId)
    if (!wf) {
      setRunningId(null)
      return null
    }
    return <WorkflowRunner workflow={wf} project={project} onClose={() => setRunningId(null)} />
  }

  return (
    <div className="p-5 space-y-3">
      <div>
        <h2 className="text-base font-semibold text-text-primary mb-1">🔗 提示词工作流</h2>
        <p className="text-sm text-text-muted">
          一键跑完一段创作流程，每步可暂停审核。借鉴蛙蛙写作的链式工作流理念。
        </p>
      </div>

      {workflows.length === 0 ? (
        <div className="text-center py-12 text-text-muted text-sm">加载中...</div>
      ) : (
        <div className="space-y-2">
          {workflows.map(w => (
            <div key={w.id} className="bg-bg-surface border border-border rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-text-primary truncate">{w.name}</h3>
                    {w.scope === 'system'
                      ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning">系统</span>
                      : <span className="text-[10px] px-1.5 py-0.5 rounded bg-info/15 text-info">我的</span>}
                    {w.isDefault && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent">★ 默认</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-text-secondary">{w.description}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setRunningId(w.id!)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white text-xs rounded hover:bg-accent-hover"
                  >
                    <Play className="w-3 h-3" /> 运行
                  </button>
                  <button
                    onClick={() => cloneWorkflow(w.id!)}
                    className="p-1.5 text-text-muted hover:text-text-primary"
                    title="克隆"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  {w.scope === 'user' && (
                    <button
                      onClick={() => {
                        if (confirm(`删除工作流「${w.name}」？`)) removeWorkflow(w.id!)
                      }}
                      className="p-1.5 text-text-muted hover:text-error"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* 步骤预览 */}
              <div className="flex items-center gap-1 flex-wrap mt-2">
                {w.steps.map((s, i) => (
                  <span key={s.stepId} className="flex items-center gap-1 text-xs">
                    <span className="px-2 py-0.5 bg-bg-elevated text-text-secondary rounded">
                      {i + 1}. {s.label}
                    </span>
                    {i < w.steps.length - 1 && <ArrowRight className="w-3 h-3 text-text-muted" />}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-text-muted">
                共 {w.steps.length} 步 · {w.steps.filter(s => s.userConfirmRequired).length} 步需用户确认
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 工作流执行器 ─────────────────────────────────────────────────────────

interface RunnerProps {
  workflow: PromptWorkflow
  project?: Project
  onClose: () => void
}

interface StepResult {
  stepId: string
  output: string
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed'
  error?: string
}

function WorkflowRunner({ workflow, project, onClose }: RunnerProps) {
  const ai = useAIStream()
  const { worldview, saveWorldview, storyCore, saveStoryCore, loadAll: loadWorldview } = useWorldviewStore()
  const { creativeRules, save: saveCreativeRules, loadAll: loadCreativeRules } = useCreativeRulesStore()
  const [savedSteps, setSavedSteps] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (project?.id) {
      loadWorldview(project.id)
      loadCreativeRules(project.id)
    }
  }, [project?.id, loadWorldview, loadCreativeRules])

  /** 写入对应模块 */
  const handleSaveTarget = async (stepId: string, output: string, target: SaveTarget) => {
    if (!project?.id) {
      alert('未关联项目，无法自动保存。请进入某个项目后再运行。')
      return
    }
    try {
      if (target.type === 'worldview-field') {
        const existing = (worldview?.[target.field as keyof typeof worldview] as string) || ''
        const next = target.mode === 'append' && existing ? `${existing}\n\n${output}` : output
        await saveWorldview({ projectId: project.id, [target.field]: next })
      } else if (target.type === 'storyCore-field') {
        const existing = (storyCore?.[target.field as keyof typeof storyCore] as string) || ''
        const next = target.mode === 'append' && existing ? `${existing}\n\n${output}` : output
        await saveStoryCore({ projectId: project.id, [target.field]: next })
      } else if (target.type === 'creativeRules-field') {
        const existing = (creativeRules?.[target.field as keyof typeof creativeRules] as string) || ''
        const next = target.mode === 'append' && existing ? `${existing}\n\n${output}` : output
        await saveCreativeRules({ projectId: project.id, [target.field]: next })
      }
      setSavedSteps(prev => new Set(prev).add(stepId))
    } catch (e) {
      alert(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const targetLabel = (target: SaveTarget): string => {
    const fieldMap: Record<string, string> = {
      worldOrigin: '世界起源', powerHierarchy: '力量层次',
      historyLine: '世界历史线', summary: '世界观摘要',
      logline: '一句话故事', concept: '故事概念', theme: '主题',
      writingStyle: '写作风格', toneAndMood: '基调氛围',
    }
    const label = fieldMap[target.field] || target.field
    if (target.type === 'worldview-field') return `世界观.${label}`
    if (target.type === 'storyCore-field') return `故事.${label}`
    return `创作规则.${label}`
  }
  const [results, setResults] = useState<Map<string, StepResult>>(() => {
    const m = new Map<string, StepResult>()
    workflow.steps.forEach(s => m.set(s.stepId, { stepId: s.stepId, output: '', status: 'pending' }))
    return m
  })
  const [currentIndex, setCurrentIndex] = useState(0)
  const [globalStatus, setGlobalStatus] = useState<'idle' | 'running' | 'paused' | 'completed' | 'aborted'>('idle')

  const updateResult = (stepId: string, patch: Partial<StepResult>) => {
    setResults(prev => {
      const next = new Map(prev)
      const old = next.get(stepId)
      if (old) next.set(stepId, { ...old, ...patch })
      return next
    })
  }

  /** 执行第 idx 步 */
  const runStep = async (idx: number) => {
    const step = workflow.steps[idx]
    if (!step) return
    const tpl = usePromptStore.getState().getActive(step.promptModuleKey)

    // 拼上下文：前一步的输出作为 inputMapping
    const ctx: Record<string, string | number | undefined> = {}
    const prevStep = workflow.steps[idx - 1]
    if (prevStep && step.inputMapping) {
      const prevResult = results.get(prevStep.stepId)
      if (prevResult?.output) {
        for (const [from, to] of Object.entries(step.inputMapping)) {
          if (from === 'previousOutput') ctx[to] = prevResult.output
        }
      }
    }
    if (step.userHint) ctx.userHint = step.userHint

    updateResult(step.stepId, { status: 'running', output: '', error: undefined })

    try {
      const { messages } = renderPrompt(tpl, ctx, {
        parameterValues: step.parameterValues,
      })
      const output = await ai.start(messages)
      updateResult(step.stepId, { status: 'done', output })
      setCurrentIndex(idx + 1)

      // 是否暂停等用户确认
      if (step.userConfirmRequired && idx < workflow.steps.length - 1) {
        setGlobalStatus('paused')
      } else if (idx === workflow.steps.length - 1) {
        setGlobalStatus('completed')
      } else {
        // 继续下一步
        await runStep(idx + 1)
      }
    } catch (e) {
      updateResult(step.stepId, {
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      })
      setGlobalStatus('paused')
    }
  }

  const handleStart = () => {
    setGlobalStatus('running')
    runStep(currentIndex)
  }

  const handleContinue = () => {
    setGlobalStatus('running')
    runStep(currentIndex)
  }

  const handleSkip = (stepId: string) => {
    updateResult(stepId, { status: 'skipped' })
    setCurrentIndex(prev => prev + 1)
  }

  const handleRetryStep = (idx: number) => {
    setGlobalStatus('running')
    runStep(idx)
  }

  const handleAbort = () => {
    ai.stop()
    setGlobalStatus('aborted')
  }

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text-primary">▶ 运行：{workflow.name}</h2>
          <p className="mt-0.5 text-xs text-text-muted">{workflow.description}</p>
        </div>
        <div className="flex items-center gap-2">
          {globalStatus === 'idle' && (
            <button
              onClick={handleStart}
              className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm rounded hover:bg-accent-hover"
            >
              <Play className="w-4 h-4" /> 开始
            </button>
          )}
          {globalStatus === 'running' && (
            <button
              onClick={handleAbort}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-error/10 text-error text-sm rounded hover:bg-error/20"
            >
              <Square className="w-4 h-4" /> 中止
            </button>
          )}
          {globalStatus === 'paused' && (
            <button
              onClick={handleContinue}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded hover:bg-accent-hover"
            >
              <Play className="w-4 h-4" /> 继续
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-text-secondary text-sm rounded hover:bg-bg-hover"
          >
            返回列表
          </button>
        </div>
      </div>

      {/* 全局状态 */}
      {globalStatus !== 'idle' && (
        <div className={`px-3 py-2 rounded text-xs ${
          globalStatus === 'completed' ? 'bg-success/10 text-success' :
          globalStatus === 'aborted' ? 'bg-error/10 text-error' :
          globalStatus === 'paused' ? 'bg-warning/10 text-warning' :
          'bg-info/10 text-info'
        }`}>
          {globalStatus === 'running' && `▶ 正在运行第 ${currentIndex + 1} / ${workflow.steps.length} 步...`}
          {globalStatus === 'paused' && `⏸ 已暂停（第 ${currentIndex + 1} 步等待你审核）`}
          {globalStatus === 'completed' && `✓ 工作流完成`}
          {globalStatus === 'aborted' && `✗ 已中止`}
        </div>
      )}

      {/* 步骤列表 */}
      <div className="space-y-2">
        {workflow.steps.map((step, idx) => (
          <StepCard
            key={step.stepId}
            step={step}
            index={idx}
            result={results.get(step.stepId)!}
            isCurrent={idx === currentIndex && globalStatus === 'running'}
            onSkip={() => handleSkip(step.stepId)}
            onRetry={() => handleRetryStep(idx)}
            onSave={(output, target) => handleSaveTarget(step.stepId, output, target)}
            saved={savedSteps.has(step.stepId)}
            targetLabel={targetLabel}
            hasProject={!!project?.id}
          />
        ))}
      </div>

      {globalStatus === 'completed' && (
        <div className="bg-bg-surface border border-success/30 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-success mb-2">✓ 全部完成</h3>
          <p className="text-xs text-text-secondary mb-3">
            可以把每步输出复制到对应模块（角色 / 大纲 / 章节正文等）。
            后续 Phase 可以做"一键写入"自动化。
          </p>
        </div>
      )}
    </div>
  )
}

function StepCard({
  step, index, result, isCurrent, onSkip, onRetry,
  onSave, saved, targetLabel, hasProject,
}: {
  step: PromptWorkflowStep
  index: number
  result: StepResult
  isCurrent: boolean
  onSkip: () => void
  onRetry: () => void
  onSave: (output: string, target: SaveTarget) => void
  saved: boolean
  targetLabel: (target: SaveTarget) => string
  hasProject: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (!result.output) return
    navigator.clipboard.writeText(result.output).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const statusIcon = {
    pending:  <ChevronRight className="w-4 h-4 text-text-muted" />,
    running:  <Loader2 className="w-4 h-4 text-accent animate-spin" />,
    done:     <Check className="w-4 h-4 text-success" />,
    skipped:  <X className="w-4 h-4 text-text-muted" />,
    failed:   <X className="w-4 h-4 text-error" />,
  }[result.status]

  const borderClass = isCurrent ? 'border-accent' :
    result.status === 'done' ? 'border-success/40' :
    result.status === 'failed' ? 'border-error/40' :
    'border-border'

  return (
    <div className={`bg-bg-surface border-2 rounded-xl overflow-hidden ${borderClass}`}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 p-3 hover:bg-bg-hover"
      >
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
          {step.userHint && (
            <p className="text-xs text-text-muted">💡 {step.userHint}</p>
          )}
          {result.status === 'pending' && (
            <p className="text-xs text-text-muted">待执行</p>
          )}
          {result.status === 'running' && (
            <p className="text-xs text-accent flex items-center gap-1">
              <Sparkles className="w-3 h-3 animate-pulse" /> AI 生成中...
            </p>
          )}
          {result.output && (
            <pre className="text-xs text-text-primary whitespace-pre-wrap font-sans max-h-64 overflow-y-auto p-2 bg-bg-surface rounded">
              {result.output}
            </pre>
          )}
          {result.error && (
            <p className="text-xs text-error">⚠ {result.error}</p>
          )}
          {(result.status === 'done' || result.status === 'failed') && (
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <button
                onClick={onRetry}
                className="text-xs text-accent hover:underline"
              >
                重新生成
              </button>
              {result.status === 'done' && (
                <>
                  <span className="text-text-muted">·</span>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
                  >
                    {copied ? <Check className="w-3 h-3 text-success" /> : <ClipboardCopy className="w-3 h-3" />}
                    {copied ? '已复制' : '复制'}
                  </button>
                  {step.saveTarget && (
                    <>
                      <span className="text-text-muted">·</span>
                      <button
                        onClick={() => onSave(result.output, step.saveTarget!)}
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
                  <button
                    onClick={onSkip}
                    className="text-xs text-text-secondary hover:underline"
                  >
                    跳过此步
                  </button>
                </>
              )}
            </div>
          )}
          {result.status === 'pending' && isCurrent && (
            <button
              onClick={onSkip}
              className="text-xs text-text-secondary hover:underline"
            >
              跳过此步
            </button>
          )}
        </div>
      )}
    </div>
  )
}
