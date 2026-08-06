import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  GitCompareArrows,
  Loader2,
  RotateCcw,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { useAIStream } from '../../hooks/useAIStream'
import { useAIConfigStore } from '../../stores/ai-config'
import { assembleContext } from '../../lib/registry/assemble-context'
import {
  prepareGenerationNode,
  runGenerationNode,
  type PreparedGenerationNode,
} from '../../lib/generation/generation-node'
import {
  confirmWorkshopArtifact,
  createOutlineWorkshopNode,
  evaluateWorkshopQuality,
  extractWorkshopSceneNarrative,
  formatWorkshopCanonCatalog,
  OUTLINE_WORKSHOP_STAGE_META,
  OUTLINE_WORKSHOP_STAGES,
  rewindWorkshopArtifacts,
  type OutlineWorkshopArtifacts,
  type OutlineWorkshopStage,
  type WorkshopQualityEvaluation,
} from '../../lib/outline/workshop'
import { walkOutlineChaptersInCanonicalOrder } from '../../lib/outline/canonical-outline-walk'
import {
  formatCognitionCatalog,
  readCognitionAuditSnapshot,
  type CognitionAuditSnapshot,
} from '../../lib/knowledge-ledger/knowledge-ledger'
import {
  readProjectHeldItems,
  type HeldItemProjection,
} from '../../lib/consistency/held-items'
import {
  readCanonAssertions,
} from '../../lib/fact-ledger/setting-assertions'
import { estimateTokens } from '../../lib/ai/context-budget'
import type {
  Character,
  OutlineNode,
  Project,
  TemporalFact,
} from '../../lib/types'
import type { AssembleContextResult } from '../../lib/registry/types'
import PromptPreviewGate from '../shared/PromptPreviewGate'

interface Props {
  project: Project
  chapter: OutlineNode
  nodes: OutlineNode[]
  characters: Character[]
  onAdopt: (raw: string) => Promise<boolean>
  onClose: () => void
}

type Attempts = Partial<Record<OutlineWorkshopStage, string[]>>

interface WorkshopEvidence {
  assembled: AssembleContextResult
  heldItems: HeldItemProjection[]
  cognition: CognitionAuditSnapshot
  canonFacts: TemporalFact[]
}

export default function ChapterOutlineWorkshop({
  project,
  chapter,
  nodes,
  characters,
  onAdopt,
  onClose,
}: Props) {
  const ai = useAIStream()
  const stopAIRef = useRef(ai.stop)
  stopAIRef.current = ai.stop
  const aiConfig = useAIConfigStore(state => state.config)
  const requestRef = useRef(0)
  const runRef = useRef(0)
  const [evidence, setEvidence] = useState<WorkshopEvidence | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [error, setError] = useState('')
  const [activeStage, setActiveStage] = useState<OutlineWorkshopStage>('scan')
  const [artifacts, setArtifacts] = useState<OutlineWorkshopArtifacts>({})
  const [draft, setDraft] = useState('')
  const [attempts, setAttempts] = useState<Attempts>({})
  const [running, setRunning] = useState(false)
  const [transparentMode, setTransparentMode] = useState(false)
  const [promptPreview, setPromptPreview] = useState<PreparedGenerationNode | null>(null)
  const [lastInputTokens, setLastInputTokens] = useState(0)
  const [quality, setQuality] = useState<WorkshopQualityEvaluation | null>(null)
  const [adopting, setAdopting] = useState(false)

  const worldGroupId = useMemo(() => (
    walkOutlineChaptersInCanonicalOrder(nodes).chapters
      .find(entry => entry.outlineNode.id === chapter.id)?.worldGroupId ?? null
  ), [chapter.id, nodes])

  const initialize = useCallback(async () => {
    if (chapter.id == null || project.id == null) return
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setInitializing(true)
    setError('')
    setEvidence(null)
    try {
      const [assembled, heldItems, cognition, canonFacts] = await Promise.all([
        assembleContext({
          projectId: project.id,
          worldGroupId,
          outlineNodeId: chapter.id,
          provider: aiConfig.provider,
          model: aiConfig.model,
          sourceKeys: [
            'chapterOutline',
            'storyCore',
            'activeNarrativeBlueprint',
            'characterDrivenPlan',
            'characters',
            'foreshadows',
            'storyArcs',
            'storylineProgress',
            'worldview',
            'powerSystem',
            'cultivationProgress',
            'creativeRules',
            'worldRules',
            'historical',
            'locations',
            'canonAssertions',
            'characterKnowledge',
            'heldItems',
          ],
        }),
        readProjectHeldItems(project.id, null, worldGroupId, null, chapter.id),
        readCognitionAuditSnapshot(project.id, null, worldGroupId, chapter.id),
        readCanonAssertions(project.id, worldGroupId),
      ])
      if (requestRef.current !== requestId) return
      setEvidence({ assembled, heldItems, cognition, canonFacts })
    } catch (reason) {
      if (requestRef.current !== requestId) return
      setError(reason instanceof Error ? reason.message : '未知错误')
    } finally {
      if (requestRef.current === requestId) setInitializing(false)
    }
  }, [aiConfig.model, aiConfig.provider, chapter.id, project.id, worldGroupId])

  useEffect(() => {
    void initialize()
    return () => {
      requestRef.current += 1
      runRef.current += 1
      stopAIRef.current()
    }
  }, [initialize])

  const generatedDraft = useMemo(() => (
    ['scan', 'motivation', 'collision']
      .flatMap(stage => artifacts[stage as OutlineWorkshopStage]?.trim() ?? [])
      .join('\n\n')
  ), [artifacts])

  const evaluate = useCallback((
    raw: string,
    draftText = generatedDraft,
  ): WorkshopQualityEvaluation => {
    if (!evidence) return {
      gate: {
        status: 'blocked',
        issues: [{ code: 'evidence-missing', message: '校验证据尚未准备完成。' }],
      },
      advisories: [],
    }
    return evaluateWorkshopQuality({
      raw,
      generatedDraft: draftText,
      heldItems: evidence.heldItems,
      knownCharacterNames: characters.map(character => character.name),
      cognition: evidence.cognition,
      canonFacts: evidence.canonFacts,
    })
  }, [characters, evidence, generatedDraft])

  const buildNode = useCallback((stage: OutlineWorkshopStage) => {
    if (project.id == null || chapter.id == null) throw new Error('章节身份缺失。')
    return createOutlineWorkshopNode({
      stage,
      projectId: project.id,
      chapterIdentity: chapter.id,
      ai,
      qualityGate: stage === 'quality'
        ? output => evaluate(output).gate
        : undefined,
    })
  }, [ai, chapter.id, evaluate, project.id])

  const runPrepared = useCallback(async (
    prepared: PreparedGenerationNode,
    messages = prepared.messages,
  ) => {
    const runId = runRef.current + 1
    runRef.current = runId
    const runningStage = activeStage
    setPromptPreview(null)
    setRunning(true)
    setDraft('')
    setQuality(null)
    setError('')
    ai.reset()
    ai.setOperation(`outline.workshop.${activeStage}`)
    try {
      const result = await runGenerationNode(
        buildNode(runningStage),
        prepared,
        { messages },
      )
      if (runRef.current !== runId) return
      setDraft(result.output)
      setAttempts(current => ({
        ...current,
        [runningStage]: [
          ...(current[runningStage] ?? []),
          result.output,
        ].filter((value, index, values) => value.trim() && values.indexOf(value) === index),
      }))
      if (runningStage === 'quality') setQuality(evaluate(result.output))
    } catch (reason) {
      if (runRef.current !== runId) return
      setError(reason instanceof Error ? reason.message : '节点执行失败')
    } finally {
      if (runRef.current === runId) setRunning(false)
    }
  }, [activeStage, ai, buildNode, evaluate])

  const generateCurrent = () => {
    if (!evidence || chapter.id == null) return
    try {
      const node = buildNode(activeStage)
      const prepared = prepareGenerationNode(node, {
        chapterTitle: chapter.title,
        chapterSummary: chapter.summary || '',
        assembled: evidence.assembled,
        artifacts,
        cognitionCatalog: formatCognitionCatalog(evidence.cognition.catalog),
        canonCatalog: formatWorkshopCanonCatalog(evidence.canonFacts),
      })
      setLastInputTokens(prepared.messages.reduce(
        (sum, message) => sum + estimateTokens(message.content),
        0,
      ))
      if (transparentMode) {
        setPromptPreview(prepared)
        return
      }
      void runPrepared(prepared)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法准备当前节点')
    }
  }

  const confirmCurrent = () => {
    if (!draft.trim()) return
    if (activeStage === 'quality') {
      const latest = evaluate(draft)
      setQuality(latest)
      if (latest.gate.status === 'blocked') return
    }
    try {
      const confirmed = confirmWorkshopArtifact(artifacts, activeStage, draft)
      setArtifacts(confirmed.artifacts)
      if (confirmed.nextStage) {
        setActiveStage(confirmed.nextStage)
        setDraft('')
        setQuality(null)
        ai.reset()
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法确认当前节点')
    }
  }

  const rewindTo = (stage: OutlineWorkshopStage) => {
    runRef.current += 1
    ai.stop()
    setRunning(false)
    setArtifacts(current => rewindWorkshopArtifacts(current, stage))
    setActiveStage(stage)
    setDraft('')
    setQuality(null)
    setPromptPreview(null)
    ai.reset()
  }

  const adoptScenes = async () => {
    if (activeStage !== 'scenes' || !draft.trim()) return
    const finalQuality = evaluate(draft, extractWorkshopSceneNarrative(draft))
    setQuality(finalQuality)
    if (finalQuality.gate.status === 'blocked') return
    setAdopting(true)
    try {
      const ok = await onAdopt(draft)
      if (ok) onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '采纳场景卡失败')
    } finally {
      setAdopting(false)
    }
  }

  const activeIndex = OUTLINE_WORKSHOP_STAGES.indexOf(activeStage)
  const stageAttempts = attempts[activeStage] ?? []
  const displayedOutput = running ? ai.output : draft

  return (
    <div className="mb-4 rounded-xl border border-accent/30 bg-bg-surface p-4 shadow-theme-sm" data-testid="chapter-outline-workshop">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Sparkles className="h-4 w-4 text-accent" />
            五阶段章纲工坊 · {chapter.title}
          </h3>
          <p className="mt-1 text-[11px] text-text-muted">
            深度模式预计调用 5 次模型；所有中间产物仅保留在本次会话，最终场景卡仍需作者确认采纳。
          </p>
        </div>
        <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary" aria-label="关闭章纲工坊">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1" aria-label="工坊步骤">
        {OUTLINE_WORKSHOP_STAGES.map((stage, index) => {
          const confirmed = Boolean(artifacts[stage])
          const active = stage === activeStage
          return (
            <div key={stage} className="flex items-center gap-1">
              <button
                type="button"
                disabled={index > activeIndex}
                onClick={() => index < activeIndex && rewindTo(stage)}
                className={`rounded px-2 py-1 text-[11px] ${
                  active
                    ? 'bg-accent text-white'
                    : confirmed
                      ? 'bg-success/10 text-success hover:bg-success/20'
                      : 'bg-bg-elevated text-text-muted'
                } disabled:cursor-not-allowed disabled:opacity-50`}
                title={index < activeIndex ? '从此步重做，清空其后会话产物' : undefined}
              >
                {confirmed && <Check className="mr-1 inline h-3 w-3" />}
                {index + 1}. {OUTLINE_WORKSHOP_STAGE_META[stage].title}
              </button>
              {index < OUTLINE_WORKSHOP_STAGES.length - 1 && (
                <ChevronRight className="h-3 w-3 text-text-muted" />
              )}
            </div>
          )
        })}
      </div>

      {initializing ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> 正在按注册表装配本章证据...
        </div>
      ) : error && !evidence ? (
        <div className="mt-4 flex items-start justify-between gap-3 rounded border border-error/30 bg-error/10 p-3 text-xs text-error">
          <span>{error}</span>
          <button onClick={() => { void initialize() }} className="shrink-0 underline">重试</button>
        </div>
      ) : evidence ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-bg-elevated px-3 py-2 text-[11px]">
            <span className="text-text-secondary">
              当前：<strong>{OUTLINE_WORKSHOP_STAGE_META[activeStage].title}</strong>
              <span className="ml-2 text-text-muted">{OUTLINE_WORKSHOP_STAGE_META[activeStage].description}</span>
            </span>
            <span className="text-text-muted">
              登记上下文约 {evidence.assembled.totalInputTokens.toLocaleString()} tokens
              {lastInputTokens > 0 && ` · 本节点约 ${lastInputTokens.toLocaleString()}`}
            </span>
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-[11px] text-text-secondary">
            <input
              type="checkbox"
              checked={transparentMode}
              onChange={event => {
                setTransparentMode(event.target.checked)
                setPromptPreview(null)
              }}
              className="mt-0.5 accent-accent"
            />
            每个节点发送前预览/编辑最终消息（一次性，不保存）
          </label>

          {promptPreview ? (
            <PromptPreviewGate
              messages={promptPreview.messages}
              backLabel="返回当前步骤"
              onBack={() => setPromptPreview(null)}
              onConfirm={messages => { void runPrepared(promptPreview, messages) }}
            />
          ) : (
            <>
              {(displayedOutput || running) ? (
                <div className="space-y-2">
                  <textarea
                    aria-label={`${OUTLINE_WORKSHOP_STAGE_META[activeStage].title}产物`}
                    value={displayedOutput}
                    disabled={running}
                    onChange={event => {
                      const next = event.target.value
                      setDraft(next)
                      if (activeStage === 'quality') setQuality(evaluate(next))
                      else if (activeStage === 'scenes') setQuality(null)
                    }}
                    rows={activeStage === 'quality' || activeStage === 'scenes' ? 16 : 12}
                    className="w-full resize-y rounded border border-border bg-bg-base px-3 py-2 text-xs leading-6 text-text-primary focus:border-accent focus:outline-none disabled:opacity-80"
                  />
                  {running && (
                    <button
                      type="button"
                      onClick={() => {
                        runRef.current += 1
                        ai.stop()
                        setRunning(false)
                      }}
                      className="flex items-center gap-1 text-xs text-error"
                    >
                      <Square className="h-3 w-3" /> 停止本步
                    </button>
                  )}
                </div>
              ) : (
                <p className="rounded border border-dashed border-border p-4 text-center text-xs text-text-muted">
                  本步尚未生成。系统只会注入该节点需要的登记上下文和已确认前序产物。
                </p>
              )}

              {quality && (
                <div className="space-y-2">
                  {quality.gate.issues.length > 0 && (
                    <div className="rounded border border-error/30 bg-error/10 p-3 text-xs text-error">
                      <p className="font-medium">确定性闸门阻断，不能进入场景卡：</p>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {quality.gate.issues.map(issue => <li key={issue.code}>{issue.message}</li>)}
                      </ul>
                    </div>
                  )}
                  {quality.advisories.length > 0 && (
                    <div className="rounded border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                      <p className="font-medium">软性质量建议（由作者判断）：</p>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {quality.advisories.map((item, index) => (
                          <li key={`${item.category}-${index}`}>
                            {item.category}：{item.reason}{item.suggestion ? `；建议：${item.suggestion}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {stageAttempts.length > 1 && (
                <details className="rounded border border-border bg-bg-base p-2">
                  <summary className="cursor-pointer text-[11px] text-text-secondary">
                    <GitCompareArrows className="mr-1 inline h-3 w-3" />
                    比较本步历史版本（{stageAttempts.length}）
                  </summary>
                  <div className="mt-2 grid gap-2 lg:grid-cols-2">
                    {stageAttempts.slice(-2).map((attempt, index) => (
                      <div key={`${attempt.slice(0, 20)}-${index}`} className="min-w-0">
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-bg-elevated p-2 text-[10px] leading-5 text-text-secondary">
                          {attempt}
                        </pre>
                        <button
                          type="button"
                          onClick={() => setDraft(attempt)}
                          className="mt-1 text-[10px] text-accent hover:underline"
                        >
                          采用此版本继续编辑
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {error && (
                <div className="flex items-start gap-2 text-xs text-error">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={generateCurrent}
                  disabled={running || adopting}
                  className="flex items-center gap-1 rounded border border-accent/30 px-2.5 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-40"
                >
                  {draft ? <RotateCcw className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                  {draft ? '重新生成本步' : '生成本步'}
                </button>
                {activeStage === 'scenes' ? (
                  <button
                    type="button"
                    disabled={!draft.trim() || running || adopting}
                    onClick={() => { void adoptScenes() }}
                    className="rounded bg-success px-3 py-1 text-xs text-white hover:opacity-90 disabled:opacity-40"
                  >
                    {adopting ? '正在采纳...' : '确认采纳场景卡'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!draft.trim() || running || quality?.gate.status === 'blocked'}
                    onClick={confirmCurrent}
                    className="rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-40"
                  >
                    确认本步并进入下一步
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
