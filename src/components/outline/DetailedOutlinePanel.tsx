import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Plus, Sparkles, Wand2, AlertTriangle } from 'lucide-react'
import { useOutlineStore } from '../../stores/outline'
import { useDetailedOutlineStore } from '../../stores/detailed-outline'
import { useCharacterStore } from '../../stores/character'
import { useForeshadowStore } from '../../stores/foreshadow'
import { normalizeParsedScenes, parseEnhancedDetailResult } from '../../lib/ai/adapters/detail-scene-adapter'
import { batchGenerateDetails, type BatchProgress } from '../../lib/ai/batch-detail-runner'
import AIStreamOutput from '../shared/AIStreamOutput'
import { nanoid } from '../../lib/utils/id'
import type { Project, DetailedOutline, DetailedScene, EmotionArc } from '../../lib/types'
import { db } from '../../lib/db/schema'
import { resolveScopeLike } from '../../lib/world-engine/scope'
import {
  hashDetailedOutlineSourceSummaryV1,
  type DetailedOutlineGenerationOperationV1,
} from '../../lib/agent/run/detailed-outline-generation-durable'
import {
  commitDetailedOutlineBatchCandidateV1,
  detailedOutlineBatchStepIdV1,
  pauseDetailedOutlineBatchRunV1,
  readLatestDetailedOutlineBatchCandidatesV1,
  readLatestRecoverableDetailedOutlineBatchCandidateV1,
  rejectDetailedOutlineBatchCandidateV1,
  verifyDetailedOutlineBatchRunV1,
  type DetailedOutlineBatchCandidateV1,
} from '../../lib/agent/run/detailed-outline-batch-durable'
import { useToast } from '../shared/Toast'
import DetailedOutlineSidebar from './DetailedOutlineSidebar'
import DetailedSceneCard from './DetailedSceneCard'
import { useDetailedOutlineGenerationController } from './useDetailedOutlineGenerationController'

interface Props {
  project: Project
  /** 外部影响交接指定的章纲节点；仍通过既有细纲面板处理。 */
  initialNodeId?: number | null
}

const EMOTION_LABELS: Record<EmotionArc, string> = {
  rising:  '📈 升温',
  falling: '📉 降温',
  flat:    '➡️ 平稳',
  wave:    '🌊 波动',
  climax:  '⚡ 高潮',
}

export function filterExistingIds(ids: number[], validIds: Set<number>): number[] {
  return [...new Set(ids.filter(id => validIds.has(id)))]
}

/** v3 §2.1 — 创作区.细纲（场景拆分 + AI） */
export default function DetailedOutlinePanel({ project, initialNodeId }: Props) {
  const toast = useToast()
  const { nodes, loadAll: loadOutline } = useOutlineStore()
  const { detailedOutlines, loadAll: loadDetailed, getOrCreate, save } = useDetailedOutlineStore()
  const { characters, loadAll: loadCharacters } = useCharacterStore()
  const { foreshadows, loadAll: loadForeshadows } = useForeshadowStore()
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(initialNodeId ?? null)
  const [pendingBatchCandidate, setPendingBatchCandidate] = useState<DetailedOutlineBatchCandidateV1 | null>(null)
  const batchDecisionRef = useRef<((decision: 'adopt' | 'reject') => void) | null>(null)

  useEffect(() => {
    loadOutline(project.id!)
    loadDetailed(project.id!)
    loadForeshadows(project.id!)
    loadCharacters(project.id!)
  }, [project.id, loadOutline, loadDetailed, loadForeshadows, loadCharacters])

  // 章节节点列表（按 order 排序）
  const chapterNodes = useMemo(() =>
    nodes.filter(n => n.type === 'chapter').sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [nodes],
  )

  useEffect(() => {
    if (initialNodeId != null) setSelectedNodeId(initialNodeId)
  }, [initialNodeId])

  // 当前选中章节的细纲
  const currentChapter = chapterNodes.find(n => n.id === selectedNodeId)
  const currentDetailed = detailedOutlines.find(d => d.outlineNodeId === selectedNodeId)
  const validCharacterIds = useMemo(
    () => new Set(characters.map(c => c.id).filter((id): id is number => id != null)),
    [characters],
  )
  const validForeshadowIds = useMemo(
    () => new Set(foreshadows.map(f => f.id).filter((id): id is number => id != null)),
    [foreshadows],
  )
  const reloadDetailed = useCallback(() => loadDetailed(project.id!), [loadDetailed, project.id])
  const detailGeneration = useDetailedOutlineGenerationController({
    projectId: project.id!,
    outlineNodeId: selectedNodeId,
    worldGroupId: currentChapter?.worldGroupId ?? null,
    chapterTitle: currentChapter?.title ?? '',
    chapterSummary: currentChapter?.summary ?? '',
    currentDetailed,
    validCharacterIds,
    validForeshadowIds,
    reloadDetailed,
    suspendRecovery: !!pendingBatchCandidate,
  })
  const {
    ai,
    enhanceAI,
    isRecovering,
    pendingCandidate: pendingDetailedCandidate,
    buildDetailContext,
    adoptDetailedPatch,
    generateScenes,
    generateEnhanced,
    acceptCandidate,
    dismissCandidate,
    clearPendingCandidate,
    restoreEnhanced,
  } = detailGeneration

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const scope = await resolveScopeLike(project.id!)
        const candidate = await readLatestRecoverableDetailedOutlineBatchCandidateV1({ scope })
        if (!active || !candidate) return
        clearPendingCandidate()
        setPendingBatchCandidate(candidate)
        setSelectedNodeId(candidate.outlineNodeId)
        restoreEnhanced({
          output: candidate.output,
          operation: `batch-durable:${candidate.runId}:${candidate.outlineNodeId}`,
        })
      } catch (error) {
        console.error('[DetailedOutline] batch candidate recovery failed', error)
      }
    })()
    return () => { active = false }
  }, [clearPendingCandidate, project.id, restoreEnhanced])

  const ensureDetailed = async () => {
    if (!currentChapter) return null
    return await getOrCreate(project.id!, currentChapter.id!)
  }

  const updateScenes = async (scenes: DetailedScene[]) => {
    const dt = await ensureDetailed()
    if (!dt?.id) return
    await save(dt.id, { scenes })
  }

  const addScene = async () => {
    const dt = await ensureDetailed()
    if (!dt) return
    const newScene: DetailedScene = {
      sceneId: nanoid(),
      title: '新场景', summary: '',
      characterIds: [], location: '', conflict: '',
      pace: 'medium', estimatedWords: 0, notes: '',
    }
    await updateScenes([...(dt.scenes || []), newScene])
  }

  const updateScene = async (sceneId: string, patch: Partial<DetailedScene>) => {
    if (!currentDetailed) return
    const next = currentDetailed.scenes.map(s =>
      s.sceneId === sceneId ? { ...s, ...patch } : s
    )
    await updateScenes(next)
  }

  const deleteScene = async (sceneId: string) => {
    if (!currentDetailed) return
    await updateScenes(currentDetailed.scenes.filter(s => s.sceneId !== sceneId))
  }

  const handleAIGenerate = async () => {
    if (!currentChapter) return
    try {
      await generateScenes()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '场景细纲生成失败，请重试。')
    }
  }

  // D2: 完善细纲
  const handleEnhancedGenerate = async () => {
    if (!currentChapter) return
    try {
      await generateEnhanced()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '增强细纲生成失败，请重试。')
    }
  }

  const handleAcceptDetailed = useCallback(async (
    operation: DetailedOutlineGenerationOperationV1,
    text: string,
  ) => {
    const batchPending = pendingBatchCandidate
    if (batchPending) {
      if (operation !== 'enhanced' || !currentChapter?.id || batchPending.outlineNodeId !== currentChapter.id || batchPending.output !== text) {
        toast.error('批量细纲候选已变化，请刷新后重新确认。')
        return
      }
      const decide = batchDecisionRef.current
      if (decide) {
        batchDecisionRef.current = null
        setPendingBatchCandidate(null)
        enhanceAI.reset()
        decide('adopt')
        return
      }
      const parsed = parseEnhancedDetailResult(text)
      if (!parsed?.scenes?.length) {
        toast.error('解析恢复的批量细纲候选失败，请重新运行批量任务。')
        return
      }
      const patch: Partial<DetailedOutline> = {
        openingHook: parsed.openingHook?.trim() || '',
        endingCliffhanger: parsed.endingCliffhanger?.trim() || '',
        sceneLocation: parsed.sceneLocation?.trim() || '',
        emotionArc: parsed.emotionArc as EmotionArc | undefined,
        appearingCharacterIds: filterExistingIds(parsed.appearingCharacterIds ?? [], validCharacterIds),
        foreshadowIds: filterExistingIds(parsed.foreshadowIds ?? [], validForeshadowIds),
        scenes: normalizeParsedScenes(parsed.scenes, ids => filterExistingIds(ids, validCharacterIds)),
        lastUsedSummary: currentChapter.summary || '',
      }
      try {
        const scope = await resolveScopeLike(project.id!)
        const committed = await commitDetailedOutlineBatchCandidateV1({
          scope,
          runId: batchPending.runId,
          candidate: batchPending,
          output: text,
          currentSourceSummaryHash: () => hashDetailedOutlineSourceSummaryV1(currentChapter.summary || ''),
          adopt: async () => {
            const result = await adoptDetailedPatch(currentChapter.id!, patch, scope)
            if (!result.written.length || result.typeErrors.length || result.fkErrors.length || result.skipped.length) {
              throw new Error('恢复的批量细纲候选未能经正式注册表完整写入。')
            }
          },
          postState: async () => {
            const row = await db.detailedOutlines.where('outlineNodeId').equals(currentChapter.id!).first()
            return row ? { outlineNodeId: row.outlineNodeId, scenes: row.scenes, lastUsedSummary: row.lastUsedSummary ?? '' } : null
          },
        })
        const expectedIds = committed.contract.scope.outlineNodeIds ?? []
        const allSucceeded = expectedIds.every(outlineNodeId => (
          committed.projection.steps[detailedOutlineBatchStepIdV1(outlineNodeId)]?.status === 'succeeded'
        ))
        if (allSucceeded) {
          const candidates = await readLatestDetailedOutlineBatchCandidatesV1({
            scope,
            runId: committed.run.id,
            includeSucceeded: true,
          })
          const postStates = await Promise.all(expectedIds.map(async outlineNodeId => (
            db.detailedOutlines.where('outlineNodeId').equals(outlineNodeId).first()
          )))
          await verifyDetailedOutlineBatchRunV1({
            scope,
            runId: committed.run.id,
            candidates,
            postStates,
          })
        } else {
          await pauseDetailedOutlineBatchRunV1({
            scope,
            snapshot: committed,
            reason: '刷新后恢复的批量候选已采纳；其余章节将在下次批量运行中继续。',
          })
        }
        setPendingBatchCandidate(null)
        enhanceAI.reset()
        await loadDetailed(project.id!)
        toast.success('已采纳恢复的批量细纲候选')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '批量细纲候选采纳失败，请重试。')
      }
      return
    }
    try {
      const accepted = await acceptCandidate(operation, text)
      if (accepted) toast.success(operation === 'scenes' ? '已采纳场景细纲' : '已采纳增强细纲')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '细纲采纳失败，请重试。')
    }
  }, [acceptCandidate, adoptDetailedPatch, currentChapter, enhanceAI, loadDetailed, pendingBatchCandidate, project.id, toast, validCharacterIds, validForeshadowIds])

  const handleDismissDetailed = useCallback(async (operation: DetailedOutlineGenerationOperationV1) => {
    const batchPending = pendingBatchCandidate
    if (batchPending) {
      if (operation !== 'enhanced') return
      const decide = batchDecisionRef.current
      if (decide) {
        batchDecisionRef.current = null
        setPendingBatchCandidate(null)
        enhanceAI.reset()
        decide('reject')
        return
      }
      try {
        const scope = await resolveScopeLike(project.id!)
        await rejectDetailedOutlineBatchCandidateV1({
          scope,
          runId: batchPending.runId,
          candidate: batchPending,
        })
      } finally {
        setPendingBatchCandidate(null)
        enhanceAI.reset()
      }
      return
    }
    await dismissCandidate(operation)
  }, [dismissCandidate, enhanceAI, pendingBatchCandidate, project.id])

  const totalWords = currentDetailed?.scenes.reduce((s, sc) => s + (sc.estimatedWords || 0), 0) ?? 0

  // Phase 30.3: 大纲-细纲同步检测
  const isSyncStale = useMemo(() => {
    if (!currentDetailed || !currentChapter) return false
    // 只有曾经生成过细纲（有 lastUsedSummary）才检测
    if (!currentDetailed.lastUsedSummary) return false
    const currentSummary = currentChapter.summary || ''
    return currentDetailed.lastUsedSummary !== currentSummary
  }, [currentDetailed, currentChapter])

  /** 标记同步：将当前大纲摘要快照写入细纲 */
  const markSynced = useCallback(async () => {
    if (!currentDetailed?.id || !currentChapter) return
    await save(currentDetailed.id, { lastUsedSummary: currentChapter.summary || '' })
  }, [currentDetailed, currentChapter, save])

  // Phase 30.1: 批量生成细纲
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null)
  const batchAbortRef = useRef<AbortController | null>(null)

  const handleBatchDetail = useCallback(async () => {
    if (batchProgress) return // 已在运行
    const ac = new AbortController()
    batchAbortRef.current = ac

    try {
      const scope = await resolveScopeLike(project.id!)
      const result = await batchGenerateDetails({
        chapters: chapterNodes,
        existingDetails: detailedOutlines,
        scope,
        contextResolver: async outlineNodeId => {
          const worldGroupId = nodes.find(node => node.id === outlineNodeId)?.worldGroupId ?? null
          const context = await buildDetailContext(outlineNodeId, scope, worldGroupId)
          return {
            worldGroupId,
            worldContext: context.worldContext,
            characterContext: context.characterContext,
            foreshadowContext: context.foreshadowContext,
            assembled: context.assembled,
          }
        },
        onCandidate: ({ chapter, candidate }) => new Promise(resolve => {
          setSelectedNodeId(chapter.id!)
          clearPendingCandidate()
          setPendingBatchCandidate(candidate)
          restoreEnhanced({
            output: candidate.output,
            operation: `batch-durable:${candidate.runId}:${candidate.outlineNodeId}`,
          })
          batchDecisionRef.current = resolve
        }),
        onSave: async (outlineNodeId, data) => {
          const adoption = await adoptDetailedPatch(outlineNodeId, data, scope)
          if (!adoption.written.length || adoption.typeErrors.length || adoption.fkErrors.length || adoption.skipped.length) {
            throw new Error('批量细纲候选未能经正式注册表完整写入。')
          }
        },
        onPostState: async outlineNodeId => {
          const row = await db.detailedOutlines.where('outlineNodeId').equals(outlineNodeId).first()
          return row ? {
            outlineNodeId: row.outlineNodeId,
            scenes: row.scenes,
            openingHook: row.openingHook ?? '',
            endingCliffhanger: row.endingCliffhanger ?? '',
            lastUsedSummary: row.lastUsedSummary ?? '',
          } : null
        },
        onProgress: setBatchProgress,
        signal: ac.signal,
      })

      if (!result.cancelled) {
        // 刷新列表
        await loadDetailed(project.id!)
      }
    } finally {
      batchAbortRef.current = null
      batchDecisionRef.current = null
      // 3 秒后清除进度信息
      setTimeout(() => setBatchProgress(null), 3000)
    }
  }, [adoptDetailedPatch, batchProgress, buildDetailContext, chapterNodes, clearPendingCandidate, detailedOutlines, loadDetailed, nodes, project.id, restoreEnhanced])

  const handleBatchStop = useCallback(() => {
    batchAbortRef.current?.abort()
    const decide = batchDecisionRef.current
    if (decide) {
      batchDecisionRef.current = null
      setPendingBatchCandidate(null)
      enhanceAI.reset()
      decide('reject')
    }
  }, [enhanceAI])

  return (
    <div className="h-full flex">
      <DetailedOutlineSidebar
        chapters={chapterNodes}
        detailedOutlines={detailedOutlines}
        selectedNodeId={selectedNodeId}
        batchProgress={batchProgress}
        onSelect={setSelectedNodeId}
        onBatchStart={() => { void handleBatchDetail() }}
        onBatchStop={handleBatchStop}
      />

      {/* 右侧：细纲编辑 */}
      <div className="flex-1 overflow-y-auto p-6">
        {!currentChapter ? (
          <div className="h-full flex items-center justify-center text-text-muted text-sm">
            从左侧选一个章节开始编辑细纲。
          </div>
        ) : (
          <>
            {/* 章节头 */}
            <div className="mb-4">
              <h2 className="text-xl font-bold text-text-primary mb-1">📝 {currentChapter.title}</h2>
              <p className="text-sm text-text-muted">
                {currentChapter.summary || '（章节大纲未填写）'}
              </p>
              {currentDetailed && currentDetailed.scenes.length > 0 && (
                <p className="text-xs text-text-muted mt-1">
                  {currentDetailed.scenes.length} 个场景 · 估算 {totalWords.toLocaleString()} 字
                </p>
              )}
            </div>

            {/* Phase 30.3: 大纲变更警告 */}
            {isSyncStale && (
              <div className="mb-3 flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-warning">大纲已变更</p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    本章大纲摘要在生成细纲后发生了修改，当前细纲可能与大纲不一致。建议重新生成或手动调整。
                  </p>
                </div>
                <button
                  onClick={markSynced}
                  className="flex-shrink-0 text-[11px] px-2 py-0.5 rounded bg-warning/20 text-warning hover:bg-warning/30"
                >
                  忽略
                </button>
              </div>
            )}

            {/* 操作栏 */}
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={addScene}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded hover:bg-accent-hover"
              >
                <Plus className="w-4 h-4" /> 添加场景
              </button>
              <button
                onClick={handleAIGenerate}
                disabled={isRecovering || ai.isStreaming || enhanceAI.isStreaming || !!pendingDetailedCandidate || !!pendingBatchCandidate}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 text-accent text-sm rounded hover:bg-accent/20 disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" /> AI 一键拆场景
              </button>
              <button
                onClick={handleEnhancedGenerate}
                disabled={isRecovering || ai.isStreaming || enhanceAI.isStreaming || !!pendingDetailedCandidate || !!pendingBatchCandidate}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-success/10 text-success text-sm rounded hover:bg-success/20 disabled:opacity-50"
              >
                <Wand2 className="w-4 h-4" /> 完善细纲
              </button>
            </div>

            {/* AI 输出 */}
            {(ai.output || ai.isStreaming || ai.error) && (
              <div className="mb-4">
                <AIStreamOutput
                  output={ai.output} isStreaming={ai.isStreaming} error={ai.error} tokenUsage={ai.tokenUsage}
                  onStop={ai.stop}
                  onAccept={text => { void handleAcceptDetailed('scenes', text) }}
                  onDismiss={() => { void handleDismissDetailed('scenes') }}
                  onRetry={handleAIGenerate}
                />
              </div>
            )}

            {/* 完善细纲 AI 输出 */}
            {(enhanceAI.output || enhanceAI.isStreaming || enhanceAI.error) && (
              <div className="mb-4">
                <AIStreamOutput
                  output={enhanceAI.output} isStreaming={enhanceAI.isStreaming} error={enhanceAI.error} tokenUsage={enhanceAI.tokenUsage}
                  onStop={enhanceAI.stop}
                  onAccept={text => { void handleAcceptDetailed('enhanced', text) }}
                  onDismiss={() => { void handleDismissDetailed('enhanced') }}
                  onRetry={handleEnhancedGenerate}
                />
              </div>
            )}

            {/* D2: 增强字段展示 */}
            {currentDetailed && (
              currentDetailed.openingHook
              || currentDetailed.endingCliffhanger
              || currentDetailed.emotionArc
              || currentDetailed.prohibitions?.length
            ) && (
              <div className="mb-4 bg-bg-surface border border-border rounded-xl p-3 space-y-2">
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">章节细纲增强信息</h3>
                {currentDetailed.openingHook && (
                  <div>
                    <span className="text-[10px] text-text-muted">🔗 开头衔接</span>
                    <p className="text-xs text-text-primary mt-0.5">{currentDetailed.openingHook}</p>
                  </div>
                )}
                {currentDetailed.endingCliffhanger && (
                  <div>
                    <span className="text-[10px] text-text-muted">🎣 结尾悬念</span>
                    <p className="text-xs text-text-primary mt-0.5">{currentDetailed.endingCliffhanger}</p>
                  </div>
                )}
                <div className="flex items-center gap-4 text-xs">
                  {currentDetailed.sceneLocation && (
                    <span className="text-text-secondary">📍 {currentDetailed.sceneLocation}</span>
                  )}
                  {currentDetailed.emotionArc && (
                    <span className="text-text-secondary">{EMOTION_LABELS[currentDetailed.emotionArc] || currentDetailed.emotionArc}</span>
                  )}
                  {currentDetailed.appearingCharacterIds && currentDetailed.appearingCharacterIds.length > 0 && (
                    <span className="text-text-secondary">
                      👥 {currentDetailed.appearingCharacterIds.length} 个角色
                    </span>
                  )}
                  {currentDetailed.foreshadowIds && currentDetailed.foreshadowIds.length > 0 && (
                    <span className="text-text-secondary">
                      🔮 {currentDetailed.foreshadowIds.length} 个伏笔
                    </span>
                  )}
                </div>
                {currentDetailed.prohibitions && currentDetailed.prohibitions.length > 0 && (
                  <div className="border-t border-border pt-2">
                    <span className="text-[10px] text-warning">⛔ 不可写清单</span>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-text-secondary">
                      {currentDetailed.prohibitions.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* 场景列表 */}
            {!currentDetailed || currentDetailed.scenes.length === 0 ? (
              <div className="text-center py-12 text-text-muted text-sm">
                还没有场景。点「添加场景」或「AI 一键拆场景」开始。
              </div>
            ) : (
              <div className="space-y-3">
                {currentDetailed.scenes.map((s, idx) => (
                  <DetailedSceneCard
                    key={s.sceneId}
                    scene={s}
                    index={idx}
                    onUpdate={patch => { void updateScene(s.sceneId, patch) }}
                    onDelete={() => { void deleteScene(s.sceneId) }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
