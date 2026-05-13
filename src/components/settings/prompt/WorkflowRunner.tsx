import { useState, useEffect } from 'react'
import {
  Play, Square, Sparkles, Check, X, Loader2, ChevronRight, Save, ClipboardCopy,
} from 'lucide-react'
import { usePromptStore } from '../../../stores/prompt'
import { useWorldviewStore } from '../../../stores/worldview'
import { useCreativeRulesStore } from '../../../stores/project-singletons'
import { useCharacterStore } from '../../../stores/character'
import { useOutlineStore } from '../../../stores/outline'
import { useForeshadowStore } from '../../../stores/foreshadow'
import { useAIStream } from '../../../hooks/useAIStream'
import { renderPrompt } from '../../../lib/ai/prompt-engine'
import { extractJSON } from '../../../lib/ai/adapters/import-adapter'
import type { PromptWorkflow, PromptWorkflowStep, SaveTarget } from '../../../lib/types/workflow'
import type { Project, CharacterRole } from '../../../lib/types'
import { targetLabel } from './workflow-helpers'

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

/**
 * 工作流执行器：按顺序运行一个 PromptWorkflow 的所有步骤，
 * 每步可暂停让用户审核、重试、跳过、或自动写入 SaveTarget。
 * 从 PromptWorkflowsPanel.tsx 抽出。
 */
export default function WorkflowRunner({ workflow, project, onClose }: RunnerProps) {
  const ai = useAIStream()
  const { worldview, saveWorldview, storyCore, saveStoryCore, loadAll: loadWorldview } = useWorldviewStore()
  const { creativeRules, save: saveCreativeRules, loadAll: loadCreativeRules } = useCreativeRulesStore()
  const { addCharacter, loadAll: loadCharacters } = useCharacterStore()
  const { addNode, loadAll: loadOutline } = useOutlineStore()
  const { addForeshadow, loadAll: loadForeshadows } = useForeshadowStore()
  const [savedSteps, setSavedSteps] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (project?.id) {
      loadWorldview(project.id)
      loadCreativeRules(project.id)
      loadCharacters(project.id)
      loadOutline(project.id)
      loadForeshadows(project.id)
    }
  }, [project?.id, loadWorldview, loadCreativeRules, loadCharacters, loadOutline, loadForeshadows])

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
      } else if (target.type === 'create-characters') {
        const parsed = extractJSON(output) as unknown[]
        if (!Array.isArray(parsed)) throw new Error('AI 输出不是 JSON 数组')
        let n = 0
        for (const raw of parsed) {
          if (typeof raw !== 'object' || raw === null) continue
          const c = raw as Record<string, unknown>
          if (typeof c.name !== 'string') continue
          await addCharacter({
            projectId: project.id,
            name: c.name,
            role: ((c.role as string) || 'minor') as CharacterRole,
            shortDescription: String(c.shortDescription || ''),
            appearance: String(c.appearance || ''),
            personality: String(c.personality || ''),
            background: String(c.background || ''),
            motivation: String(c.motivation || ''),
            abilities: String(c.abilities || ''),
            relationships: String(c.relationships || ''),
            arc: String(c.arc || ''),
          })
          n++
        }
        alert(`已写入 ${n} 个角色`)
      } else if (target.type === 'create-outline-nodes') {
        const parsed = extractJSON(output) as unknown[]
        if (!Array.isArray(parsed)) throw new Error('AI 输出不是 JSON 数组')
        let order = 0, n = 0
        const writeNode = async (raw: Record<string, unknown>, parentId: number | null) => {
          if (typeof raw.title !== 'string') return
          const isVolume = raw.type === 'volume' || (Array.isArray(raw.children) && raw.children.length > 0)
          const id = await addNode({
            projectId: project.id!,
            parentId,
            type: isVolume ? 'volume' : 'chapter',
            title: raw.title,
            summary: String(raw.summary || ''),
            order: order++,
          })
          n++
          if (Array.isArray(raw.children)) {
            for (const child of raw.children) {
              await writeNode(child as Record<string, unknown>, id)
            }
          }
        }
        for (const x of parsed) {
          if (typeof x === 'object' && x) await writeNode(x as Record<string, unknown>, null)
        }
        alert(`已写入 ${n} 个大纲节点`)
      } else if (target.type === 'create-foreshadows') {
        const parsed = extractJSON(output) as unknown[]
        if (!Array.isArray(parsed)) throw new Error('AI 输出不是 JSON 数组')
        let n = 0
        for (const raw of parsed) {
          if (typeof raw !== 'object' || raw === null) continue
          const f = raw as Record<string, unknown>
          if (typeof f.name !== 'string') continue
          await addForeshadow({
            projectId: project.id,
            name: f.name,
            type: ((f.type as string) || 'chekhov') as 'chekhov',
            status: 'planned',
            description: String(f.description || ''),
            plantChapterId: null,
            echoChapterIds: '[]',
            resolveChapterId: null,
            notes: '',
          })
          n++
        }
        alert(`已写入 ${n} 个伏笔`)
      }
      setSavedSteps(prev => new Set(prev).add(stepId))
    } catch (e) {
      alert(`保存失败：${e instanceof Error ? e.message : String(e)}\n\n（角色/大纲/伏笔类目标需 AI 输出 JSON。可用「import.parse-*」类提示词预先调好。）`)
    }
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
  onSave, saved, hasProject,
}: {
  step: PromptWorkflowStep
  index: number
  result: StepResult
  isCurrent: boolean
  onSkip: () => void
  onRetry: () => void
  onSave: (output: string, target: SaveTarget) => void
  saved: boolean
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
