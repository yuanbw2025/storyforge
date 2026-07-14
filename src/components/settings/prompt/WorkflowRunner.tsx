import { useState, useEffect, useRef } from 'react'
import { Play, Square } from 'lucide-react'
import { usePromptStore } from '../../../stores/prompt'
import { useWorldviewStore } from '../../../stores/worldview'
import { useCreativeRulesStore } from '../../../stores/project-singletons'
import { useCharacterStore } from '../../../stores/character'
import { useOutlineStore } from '../../../stores/outline'
import { useForeshadowStore } from '../../../stores/foreshadow'
import { useWorldGroupStore } from '../../../stores/world-group'
import { useAIStream } from '../../../hooks/useAIStream'
import { renderPrompt } from '../../../lib/ai/prompt-engine'
import { assembleBoundPrompt } from '../../../lib/ai/prompt-variable-bindings'
import { extractJSON } from '../../../lib/ai/adapters/import-adapter'
import { adopt } from '../../../lib/registry/adopt'
import { assembleContext } from '../../../lib/registry/assemble-context'
import { db } from '../../../lib/db/schema'
import type { PromptWorkflow, PromptWorkflowStep, SaveTarget } from '../../../lib/types/workflow'
import type { Project } from '../../../lib/types'
import { assembleWorkflowStepVars } from './workflow-helpers'
import { useToast } from '../../shared/Toast'
import WorkflowStepCard from './WorkflowStepCard'
import type { StepResult } from './WorkflowStepCard'

export { WorkflowStepCard as StepCard } from './WorkflowStepCard'
export type { StepResult } from './WorkflowStepCard'

interface RunnerProps {
  workflow: PromptWorkflow
  project?: Project
  onClose: () => void
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
  const toast = useToast()
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
      toast.error('未关联项目，无法自动保存。请进入某个项目后再运行。')
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
        toast.success(`已写入 ${result.written.length} 个角色${result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ''}`)
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
        toast.success(`已写入 ${n} 个大纲节点`)
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
        toast.success(`已写入 ${result.written.length} 个伏笔${result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ''}`)
      }
      setSavedSteps(prev => new Set(prev).add(stepId))
    } catch (e) {
      toast.error(`保存失败：${e instanceof Error ? e.message : String(e)}。角色/大纲/伏笔类目标需 AI 输出 JSON。可用 import.parse-* 类提示词预先调好。`)
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
      userInput: userInputsRef.current.get(step.stepId),
    })
    return ctx
  }

  /** 执行第 idx 步 */
  const runStep = async (idx: number) => {
    const step = workflow.steps[idx]
    if (!step) return
    const promptState = usePromptStore.getState()
    const tpl = step.templateId != null
      ? promptState.templates.find(template => template.id === step.templateId)
        ?? promptState.getActive(step.promptModuleKey)
      : promptState.getActive(step.promptModuleKey)

    updateResult(step.stepId, { status: 'running', output: '', error: undefined })

    try {
      let messages
      if (tpl.variableBindings?.length) {
        const wg = project?.enableMultiWorld ? activeGroupId : null
        const bound = await assembleBoundPrompt({
          template: tpl,
          project,
          worldGroupId: wg,
          previousOutput: idx > 0 ? stepOutputsRef.current.get(workflow.steps[idx - 1].stepId) : '',
          userHint: userInputsRef.current.get(step.stepId),
          manualValues: step.inputValues,
          parameterValues: step.parameterValues,
        })
        if (bound.missingScopes.length) {
          throw new Error(`当前模板需要${bound.missingScopes.join('、')}范围，请先补齐对应项目/章节选择`)
        }
        if (bound.missingVariables.length) {
          throw new Error(`请填写必填字段：${bound.missingVariables.join('、')}`)
        }
        messages = bound.messages
      } else {
        const ctx = await buildStepContext(step, idx)
        messages = renderPrompt(tpl, ctx, { parameterValues: step.parameterValues }).messages
      }
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
          <WorkflowStepCard
            key={step.stepId}
            step={step}
            index={idx}
            result={results.get(step.stepId)!}
            isCurrent={idx === currentIndex && globalStatus === 'running'}
            onSkip={() => handleSkip(step.stepId)}
            onRetry={() => handleRetryStep(idx)}
            onSave={(output, target) => handleSaveTarget(step.stepId, output, target)}
            onUserInputChange={(v) => userInputsRef.current.set(step.stepId, v)}
            onOutputChange={(output) => {
              stepOutputsRef.current.set(step.stepId, output)
              updateResult(step.stepId, { output })
            }}
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
