import { useState, useEffect, useRef } from 'react'
import {
  Play, Square, Sparkles, Check, X, Loader2, ChevronRight, Save, ClipboardCopy,
} from 'lucide-react'
import { usePromptStore } from '../../../stores/prompt'
import { useWorldviewStore } from '../../../stores/worldview'
import { useCreativeRulesStore } from '../../../stores/project-singletons'
import { useCharacterStore } from '../../../stores/character'
import { useOutlineStore } from '../../../stores/outline'
import { useForeshadowStore } from '../../../stores/foreshadow'
import { useWorldGroupStore } from '../../../stores/world-group'
import { useAIStream } from '../../../hooks/useAIStream'
import { renderPrompt } from '../../../lib/ai/prompt-engine'
import { extractJSON } from '../../../lib/ai/adapters/import-adapter'
import { adopt } from '../../../lib/registry/adopt'
import { assembleContext } from '../../../lib/registry/assemble-context'
import { db } from '../../../lib/db/schema'
import type { PromptWorkflow, PromptWorkflowStep, SaveTarget } from '../../../lib/types/workflow'
import type { Project } from '../../../lib/types'
import type { TokenUsage } from '../../../lib/ai/logger'
import { targetLabel, assembleWorkflowStepVars } from './workflow-helpers'

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
  tokenUsage?: TokenUsage | null
}

async function findExistingOutlineNode(
  projectId: number,
  node: { parentId: number | null; type: string; title: string },
): Promise<number | null> {
  const rows = await db.outlineNodes.where('projectId').equals(projectId).toArray()
  const hit = rows.find(n =>
    (n.parentId ?? null) === (node.parentId ?? null) &&
    n.type === node.type &&
    n.title === node.title
  )
  return hit?.id ?? null
}

/**
 * 工作流执行器：按顺序运行一个 PromptWorkflow 的所有步骤，
 * 每步可暂停让用户审核、重试、跳过、或自动写入 SaveTarget。
 * 从 PromptWorkflowsPanel.tsx 抽出。
 */
export default function WorkflowRunner({ workflow, project, onClose }: RunnerProps) {
  const ai = useAIStream()
  const { loadAll: loadWorldview } = useWorldviewStore()
  const { loadAll: loadCreativeRules } = useCreativeRulesStore()
  const { loadAll: loadCharacters } = useCharacterStore()
  const { loadAll: loadOutline } = useOutlineStore()
  const { loadAll: loadForeshadows } = useForeshadowStore()
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)
  const [savedSteps, setSavedSteps] = useState<Set<string>>(new Set())

  /**
   * 步骤输出累加器(FB-1 修复 · 缺陷 A)。
   * 用 ref 存每一步的输出,而非读 React state `results`——递归推进下一步时
   * `results` 闭包是上一次渲染的旧值(setResults 异步),会导致 previousOutput 永远取空。
   * ref.current 始终是最新值,且能跨「暂停/继续/重试」存活。
   */
  const stepOutputsRef = useRef<Map<string, string>>(new Map())

  /**
   * FB-7(BUG-INPUT-WITH-GEN):每个步骤的「用户输入」。
   * 此前步骤卡完全没有输入框,用户连「一句话故事」都没法自己敲。现在每步可预先输入,
   * 点生成时并入 ctx(作为 userHint/seed)。用 ref 读取避免闭包陈旧(同 FB-1 教训)。
   */
  const userInputsRef = useRef<Map<string, string>>(new Map())

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
    const projectId = project.id
    try {
      if (target.type === 'worldview-field') {
        await adopt({
          projectId,
          target: 'worldviews',
          mode: target.mode === 'append' ? 'append' : 'replace',
          data: { [target.field]: output },
        })
        await loadWorldview(projectId)
      } else if (target.type === 'storyCore-field') {
        await adopt({
          projectId,
          target: 'storyCores',
          mode: target.mode === 'append' ? 'append' : 'replace',
          data: { [target.field]: output },
        })
        await loadWorldview(projectId)
      } else if (target.type === 'creativeRules-field') {
        await adopt({
          projectId,
          target: 'creativeRules',
          mode: target.mode === 'append' ? 'append' : 'replace',
          data: { [target.field]: output },
        })
        await loadCreativeRules(projectId)
      } else if (target.type === 'create-characters') {
        const parsed = extractJSON(output) as unknown[]
        if (!Array.isArray(parsed)) throw new Error('AI 输出不是 JSON 数组')
        const result = await adopt({ projectId, target: 'characters', mode: 'add-many', data: parsed as Record<string, unknown>[] })
        await loadCharacters(projectId)
        alert(`已写入 ${result.written.length} 个角色${result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ''}`)
      } else if (target.type === 'create-outline-nodes') {
        const parsed = extractJSON(output) as unknown[]
        if (!Array.isArray(parsed)) throw new Error('AI 输出不是 JSON 数组')
        let order = 0, n = 0
        const writeNode = async (raw: Record<string, unknown>, parentId: number | null): Promise<number | null> => {
          if (typeof raw.title !== 'string') return null
          const isVolume = raw.type === 'volume' || (Array.isArray(raw.children) && raw.children.length > 0)
          const normalized = {
            projectId,
            parentId,
            type: isVolume ? 'volume' : 'chapter',
            title: raw.title,
            summary: String(raw.summary || ''),
            order: order++,
          }
          const adopted = await adopt({
            projectId,
            target: 'outlineNodes',
            mode: 'add',
            data: normalized,
          })
          const id = adopted.written[0]?.id ?? (await findExistingOutlineNode(projectId, normalized))
          if (adopted.written.length) n++
          if (id != null && Array.isArray(raw.children)) {
            for (const child of raw.children) {
              await writeNode(child as Record<string, unknown>, id)
            }
          }
          return id
        }
        for (const x of parsed) {
          if (typeof x === 'object' && x) await writeNode(x as Record<string, unknown>, null)
        }
        await loadOutline(projectId)
        alert(`已写入 ${n} 个大纲节点`)
      } else if (target.type === 'create-foreshadows') {
        const parsed = extractJSON(output) as unknown[]
        if (!Array.isArray(parsed)) throw new Error('AI 输出不是 JSON 数组')
        const normalized = parsed
          .filter((raw): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null)
          .map(f => ({
            ...f,
            status: f.status || 'planned',
            type: f.type || 'chekhov',
            echoChapterIds: f.echoChapterIds || [],
            plantChapterId: f.plantChapterId ?? null,
            resolveChapterId: f.resolveChapterId ?? null,
            notes: f.notes || '',
          }))
        const result = await adopt({ projectId, target: 'foreshadows', mode: 'add-many', data: normalized })
        await loadForeshadows(projectId)
        alert(`已写入 ${result.written.length} 个伏笔${result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ''}`)
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

  /**
   * 为第 idx 步装配上下文(FB-1 修复 · 缺陷 B：走 assembleContext,不再裸 renderPrompt)。
   * - 项目元信息 projectName/genres + 维度 dimension + userHint(此前全空,AI 失去依据)
   * - 经注册表 assembleContext 拉取已存项目设定(故事核心/世界观/角色/力量/词条)+ 真实与幻想规则
   * - 上一步输出经 ref 累加器取得(缺陷 A),与已存设定一起注入「通用前序上下文」槽位 worldContext
   *   (worldContext 是所有工作流步骤模板都读取的通用槽位,因此 step2 世界起源也能拿到 step1 一句话故事)
   * - 同时保留步骤声明的 inputMapping(供 chapter.content 的 chapterSummary 等特定变量)
   */
  const buildStepContext = async (
    step: PromptWorkflowStep,
    idx: number,
  ): Promise<Record<string, string | number | undefined>> => {
    // ① 上一步输出(经 ref 累加器 → 修复闭包陈旧 · 缺陷 A)
    const prevStep = idx > 0 ? workflow.steps[idx - 1] : undefined
    const prevOut = prevStep ? (stepOutputsRef.current.get(prevStep.stepId) ?? '') : ''

    // ② 走注册表拉取已存项目设定 + 真实与幻想规则(单一事实源,不在此手挑 buildXxxContext · 缺陷 B)
    let assembledText = ''
    let worldRulesText = ''
    if (project?.id) {
      const wg = project.enableMultiWorld ? activeGroupId : null
      try {
        assembledText = (await assembleContext({
          projectId: project.id,
          worldGroupId: wg,
          sourceKeys: ['storyCore', 'worldview', 'powerSystem', 'characters', 'codex'],
        })).text
      } catch { /* 上下文装配失败不应阻断生成 */ }
      try {
        worldRulesText = (await assembleContext({
          projectId: project.id,
          worldGroupId: wg,
          sourceKeys: ['worldRules'],
        })).text
      } catch { /* ignore */ }
    }

    // ③ 纯逻辑整形(可单测,见 tests/regression/R-WF-*)
    const ctx = assembleWorkflowStepVars({
      step,
      prevOutput: prevOut,
      projectName: project?.name,
      genres: project?.genre,
      assembledContext: assembledText,
      worldRulesContext: worldRulesText,
    })
    // FB-7:把用户为本步输入的内容并入 userHint(在用户已写的基础上生成/扩展)
    const userInput = userInputsRef.current.get(step.stepId)?.trim()
    if (userInput) {
      ctx.userHint = [ctx.userHint, userInput].filter(Boolean).join('\n')
    }
    return ctx
  }

  /** 执行第 idx 步 */
  const runStep = async (idx: number) => {
    const step = workflow.steps[idx]
    if (!step) return
    const tpl = usePromptStore.getState().getActive(step.promptModuleKey)

    updateResult(step.stepId, { status: 'running', output: '', error: undefined })

    try {
      const ctx = await buildStepContext(step, idx)
      const { messages } = renderPrompt(tpl, ctx, {
        parameterValues: step.parameterValues,
      })
      const output = await ai.start(messages, undefined, { category: step.promptModuleKey, projectId: project?.id })
      // FB-1 修复 · 缺陷 A：把本步输出存进 ref(而非只存 React state),供下一步取用
      stepOutputsRef.current.set(step.stepId, output)
      updateResult(step.stepId, { status: 'done', output, tokenUsage: ai.tokenUsage })
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
    stepOutputsRef.current.clear() // 全新运行:清空上一轮的步骤输出累加器
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
            onUserInputChange={(v) => userInputsRef.current.set(step.stepId, v)}
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
  onSave, onUserInputChange, saved, hasProject,
}: {
  step: PromptWorkflowStep
  index: number
  result: StepResult
  isCurrent: boolean
  onSkip: () => void
  onRetry: () => void
  onSave: (output: string, target: SaveTarget) => void
  onUserInputChange: (v: string) => void
  saved: boolean
  hasProject: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)
  // FB-7:用户为本步输入的内容(生成前可填,作为种子并入 prompt)
  const [userInput, setUserInput] = useState('')
  // FB-7:AI 输出可编辑(产出后允许用户改了再保存/复制)
  const [editedOutput, setEditedOutput] = useState('')
  useEffect(() => { setEditedOutput(result.output || '') }, [result.output])
  const outText = editedOutput

  const handleCopy = () => {
    if (!outText) return
    navigator.clipboard.writeText(outText).then(() => {
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
          {/* FB-7:用户输入框 — 可预先写本步内容(如一句话故事),生成时会带进 prompt */}
          <textarea
            value={userInput}
            onChange={e => { setUserInput(e.target.value); onUserInputChange(e.target.value) }}
            rows={2}
            placeholder="你的输入(可选)：在此写本步内容,AI 会在你写的基础上生成/扩展"
            className="w-full px-2 py-1.5 bg-bg-surface border border-border rounded text-xs text-text-primary resize-y focus:outline-none focus:border-accent"
          />
          {result.status === 'pending' && (
            <p className="text-xs text-text-muted">待执行</p>
          )}
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
                onChange={e => setEditedOutput(e.target.value)}
                rows={8}
                className="w-full text-xs text-text-primary font-sans max-h-72 p-2 bg-bg-surface border border-border rounded resize-y focus:outline-none focus:border-accent"
              />
              <p className="text-[10px] text-text-muted">AI 输出可直接编辑,保存/复制将使用编辑后的内容。</p>
            </>
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
                        onClick={() => onSave(outText, step.saveTarget!)}
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
