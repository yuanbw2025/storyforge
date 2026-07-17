import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Plus, Sparkles, Wand2, AlertTriangle } from 'lucide-react'
import { useOutlineStore } from '../../stores/outline'
import { useDetailedOutlineStore } from '../../stores/detailed-outline'
import { useCharacterStore } from '../../stores/character'
import { useForeshadowStore } from '../../stores/foreshadow'
import { useAIStream } from '../../hooks/useAIStream'
import { createAISessionKey } from '../../stores/ai-generation-session'
import { buildDetailSceneGeneratePrompt, buildEnhancedDetailPrompt, normalizeParsedScenes, parseEnhancedDetailSmart } from '../../lib/ai/adapters/detail-scene-adapter'
import { useAIConfigStore } from '../../stores/ai-config'
import { batchGenerateDetails, type BatchProgress } from '../../lib/ai/batch-detail-runner'
import AIStreamOutput from '../shared/AIStreamOutput'
import { nanoid } from '../../lib/utils/id'
import { adopt } from '../../lib/registry/adopt'
import { assembleContext } from '../../lib/registry/assemble-context'
import type { Project, DetailedOutline, DetailedScene, EmotionArc } from '../../lib/types'
import { useToast } from '../shared/Toast'
import DetailedOutlineSidebar from './DetailedOutlineSidebar'
import DetailedSceneCard from './DetailedSceneCard'

interface Props {
  project: Project
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
export default function DetailedOutlinePanel({ project }: Props) {
  const toast = useToast()
  const { nodes, loadAll: loadOutline } = useOutlineStore()
  const { detailedOutlines, loadAll: loadDetailed, getOrCreate, save } = useDetailedOutlineStore()
  const { characters, loadAll: loadCharacters } = useCharacterStore()
  const aiConfig = useAIConfigStore(s => s.config)
  const { foreshadows, loadAll: loadForeshadows } = useForeshadowStore()
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)
  const ai = useAIStream(createAISessionKey(project.id!, 'detail.scene', selectedNodeId ?? 'unselected'))
  const enhanceAI = useAIStream(createAISessionKey(project.id!, 'detail.enhance', selectedNodeId ?? 'unselected'))

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

  const adoptDetailedPatch = useCallback(async (
    outlineNodeId: number,
    patch: Partial<DetailedOutline>,
  ) => {
    const result = await adopt({
      projectId: project.id!,
      target: 'detailedOutlines',
      mode: 'add',
      data: { outlineNodeId, ...patch },
    })
    await loadDetailed(project.id!)
    return result
  }, [project.id, loadDetailed])

  const buildDetailContext = useCallback(async (outlineNodeId: number) => {
    const node = nodes.find(n => n.id === outlineNodeId)
    const assembled = await assembleContext({
      projectId: project.id!,
      worldGroupId: node?.worldGroupId ?? null,
      outlineNodeId,
      provider: aiConfig.provider,
      model: aiConfig.model,
      sourceKeys: ['chapterOutline', 'worldview', 'storyCore', 'powerSystem', 'codex', 'characters', 'creativeRules', 'worldRules', 'historical', 'locations'],
    })
    const charIdx = assembled.included.indexOf('characters')
    return {
      worldContext: assembled.text,
      characterContext: charIdx >= 0 ? assembled.segments[charIdx]?.content ?? '' : '',
    }
  }, [project.id, nodes, aiConfig.provider, aiConfig.model])

  const handleAIGenerate = async () => {
    if (!currentChapter) return
    const ctx = await buildDetailContext(currentChapter.id!)
    const messages = buildDetailSceneGeneratePrompt(
      currentChapter.title,
      currentChapter.summary || '',
      ctx.worldContext,
      ctx.characterContext,
      '',
    )
    ai.start(messages, undefined, { category: 'detail.scene', projectId: project.id! })
  }

  // D2: 完善细纲
  const handleEnhancedGenerate = async () => {
    if (!currentChapter) return
    const idx = chapterNodes.indexOf(currentChapter)
    const prevSummary = idx > 0 ? (chapterNodes[idx - 1].summary || '') : ''
    const nextSummary = idx < chapterNodes.length - 1 ? (chapterNodes[idx + 1].summary || '') : ''
    const { worldContext: worldCtx } = await buildDetailContext(currentChapter.id!)

    const charCtx = characters
      .filter(c => c.roleWeight === 'main')
      .map(c => `[ID:${c.id}] ${c.name}（${c.orderAxis}/${c.moralAxis}）`)
      .join('\n')

    const foreshadowCtx = foreshadows
      .filter(f => f.status !== 'resolved')
      .map(f => `[ID:${f.id}] ${f.name}（${f.type}）：${f.description}`)
      .join('\n')

    const messages = buildEnhancedDetailPrompt(
      currentChapter.title,
      currentChapter.summary || '',
      prevSummary, nextSummary,
      worldCtx, charCtx, foreshadowCtx,
    )
    enhanceAI.start(messages, undefined, { category: 'detail.enhance', projectId: project.id! })
  }

  const handleAcceptEnhanced = async (text: string) => {
    const parsed = await parseEnhancedDetailSmart(text, aiConfig)
    if (!parsed) {
      toast.error('解析增强细纲失败，请重试')
      return
    }
    if (!currentChapter?.id) return

    const patch: Partial<DetailedOutline> = {}
    if (parsed.openingHook) patch.openingHook = parsed.openingHook
    if (parsed.endingCliffhanger) patch.endingCliffhanger = parsed.endingCliffhanger
    if (parsed.sceneLocation) patch.sceneLocation = parsed.sceneLocation
    if (parsed.emotionArc) patch.emotionArc = parsed.emotionArc as EmotionArc
    if (parsed.appearingCharacterIds) {
      patch.appearingCharacterIds = filterExistingIds(parsed.appearingCharacterIds, validCharacterIds)
    }
    if (parsed.foreshadowIds) {
      patch.foreshadowIds = filterExistingIds(parsed.foreshadowIds, validForeshadowIds)
    }

    // 如果 AI 返回了场景，也写入
    if (parsed.scenes && parsed.scenes.length > 0) {
      const newScenes = normalizeParsedScenes(
        parsed.scenes,
        ids => filterExistingIds(ids, validCharacterIds),
      )
      patch.scenes = newScenes
    }

    // Phase 30.3: 同时快照当前大纲摘要
    patch.lastUsedSummary = currentChapter?.summary || ''
    await adoptDetailedPatch(currentChapter.id, patch)
    enhanceAI.reset()
  }

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
    const baseCtx = await assembleContext({
      projectId: project.id!,
      worldGroupId: null,
      provider: aiConfig.provider,
      model: aiConfig.model,
      sourceKeys: ['worldview', 'storyCore', 'powerSystem', 'codex', 'characters', 'creativeRules', 'worldRules', 'historical', 'locations'],
    })
    const worldCtx = baseCtx.text
    const charCtx = characters
      .filter(c => c.roleWeight === 'main')
      .map(c => `[ID:${c.id}] ${c.name}（${c.orderAxis}/${c.moralAxis}）`)
      .join('\n')
    const foreshadowCtx = foreshadows
      .filter(f => f.status !== 'resolved')
      .map(f => `[ID:${f.id}] ${f.name}（${f.type}）：${f.description}`)
      .join('\n')

    const ac = new AbortController()
    batchAbortRef.current = ac

    try {
      const result = await batchGenerateDetails({
        chapters: chapterNodes,
        existingDetails: detailedOutlines,
        worldContext: worldCtx,
        // 多世界：逐章用本章所属世界的上下文
        worldContextResolver: project.enableMultiWorld
          ? async (chId) => (await buildDetailContext(chId)).worldContext
          : undefined,
        characterContext: charCtx,
        foreshadowContext: foreshadowCtx,
        onSave: async (outlineNodeId, data) => {
          await adoptDetailedPatch(outlineNodeId, data)
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
      // 3 秒后清除进度信息
      setTimeout(() => setBatchProgress(null), 3000)
    }
  }, [batchProgress, characters, foreshadows, chapterNodes, detailedOutlines, project.id, project.enableMultiWorld, loadDetailed, adoptDetailedPatch, buildDetailContext, aiConfig.provider, aiConfig.model])

  const handleBatchStop = useCallback(() => {
    batchAbortRef.current?.abort()
  }, [])

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
                disabled={ai.isStreaming || enhanceAI.isStreaming}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 text-accent text-sm rounded hover:bg-accent/20 disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" /> AI 一键拆场景
              </button>
              <button
                onClick={handleEnhancedGenerate}
                disabled={ai.isStreaming || enhanceAI.isStreaming}
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
                  onAccept={async (text) => {
                    try {
                      if (!currentChapter.id) return
                      const parsed = await parseEnhancedDetailSmart(text, aiConfig)
                      const newScenes = normalizeParsedScenes(
                        parsed?.scenes,
                        ids => filterExistingIds(ids, validCharacterIds),
                      )
                      if (newScenes.length === 0) {
                        toast.error('未能从 AI 输出解析出场景，请重试')
                        return
                      }
                      await adoptDetailedPatch(currentChapter.id, {
                        scenes: [...(currentDetailed?.scenes || []), ...newScenes],
                        lastUsedSummary: currentChapter.summary || '',
                      })
                      toast.success(`已采纳 ${newScenes.length} 个场景`)
                    } catch (err) {
                      console.error('[DetailedOutline] 采纳失败:', err)
                      toast.error('采纳场景失败，请重试')
                    }
                    ai.reset()
                  }}
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
                  onAccept={handleAcceptEnhanced}
                  onRetry={handleEnhancedGenerate}
                />
              </div>
            )}

            {/* D2: 增强字段展示 */}
            {currentDetailed && (currentDetailed.openingHook || currentDetailed.endingCliffhanger || currentDetailed.emotionArc) && (
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
