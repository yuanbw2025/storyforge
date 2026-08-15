/**
 * 场景拆分面板 — 从 DetailedOutlinePanel 提取，可嵌入章节编辑页
 *
 * 展示并编辑某章节的细纲场景列表，支持 AI 一键拆场景。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Sparkles, ChevronDown, ChevronRight, Wand2 } from 'lucide-react'
import { useDetailedOutlineStore } from '../../stores/detailed-outline'
import { useOutlineStore } from '../../stores/outline'
import { useCharacterStore } from '../../stores/character'
import { useForeshadowStore } from '../../stores/foreshadow'
import AIStreamOutput from '../shared/AIStreamOutput'
import { nanoid } from '../../lib/utils/id'
import { useToast } from '../shared/Toast'
import type { DetailedScene, Project, ScenePace } from '../../lib/types'
import ChapterOutlineWorkshop from './ChapterOutlineWorkshop'
import { adoptChapterOutlineWorkshopResult } from '../../lib/outline/adopt-workshop'
import { useDetailedOutlineGenerationController } from './useDetailedOutlineGenerationController'
import CreativeArtifactSummary from '../agent/CreativeArtifactSummary'

const PACE_LABELS: Record<ScenePace, string> = {
  slow:   '🐢 慢',
  medium: '🚶 中',
  fast:   '🏃 快',
  climax: '⚡ 高潮',
}

const PACE_COLORS: Record<ScenePace, string> = {
  slow:   'bg-info/10 text-info',
  medium: 'bg-text-muted/10 text-text-secondary',
  fast:   'bg-warning/10 text-warning',
  climax: 'bg-error/10 text-error',
}

interface Props {
  project: Project
  outlineNodeId: number
  chapterTitle: string
  chapterSummary: string
}

export default function ScenePanel({ project, outlineNodeId, chapterTitle, chapterSummary }: Props) {
  const projectId = project.id!
  const { detailedOutlines, loadAll, getOrCreate, save } = useDetailedOutlineStore()
  const nodes = useOutlineStore(state => state.nodes)
  const { characters, loadAll: loadCharacters } = useCharacterStore()
  const { foreshadows, loadAll: loadForeshadows } = useForeshadowStore()
  const toast = useToast()
  const [expanded, setExpanded] = useState(false)
  const [showWorkshop, setShowWorkshop] = useState(false)

  useEffect(() => {
    loadAll(projectId)
    loadCharacters(projectId)
    loadForeshadows(projectId)
  }, [loadAll, loadCharacters, loadForeshadows, projectId])
  useEffect(() => { setShowWorkshop(false) }, [outlineNodeId])

  const detailed = detailedOutlines.find(d => d.outlineNodeId === outlineNodeId)
  const scenes = detailed?.scenes || []
  const hasScenes = scenes.length > 0
  const chapterNode = nodes.find(node => node.id === outlineNodeId && node.type === 'chapter')
  const validCharacterIds = useMemo(
    () => new Set(characters.map(character => character.id).filter((id): id is number => id != null)),
    [characters],
  )
  const validForeshadowIds = useMemo(
    () => new Set(foreshadows.map(item => item.id).filter((id): id is number => id != null)),
    [foreshadows],
  )
  const reloadDetailed = useCallback(() => loadAll(projectId), [loadAll, projectId])
  const {
    ai,
    enhanceAI,
    isRecovering,
    pendingCandidate,
    generateScenes,
    generateEnhanced,
    acceptCandidate,
    dismissCandidate,
  } = useDetailedOutlineGenerationController({
    projectId,
    outlineNodeId,
    worldGroupId: chapterNode?.worldGroupId ?? null,
    chapterTitle,
    chapterSummary,
    currentDetailed: detailed,
    validCharacterIds,
    validForeshadowIds,
    reloadDetailed,
  })

  const ensureDetailed = async () => {
    return await getOrCreate(projectId, outlineNodeId)
  }

  const updateScenes = async (nextScenes: DetailedScene[]) => {
    const dt = await ensureDetailed()
    if (!dt?.id) return
    await save(dt.id, { scenes: nextScenes })
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
    setExpanded(true)
  }

  const updateScene = async (sceneId: string, patch: Partial<DetailedScene>) => {
    if (!detailed) return
    const next = detailed.scenes.map(s =>
      s.sceneId === sceneId ? { ...s, ...patch } : s
    )
    await updateScenes(next)
  }

  const deleteScene = async (sceneId: string) => {
    if (!detailed) return
    await updateScenes(detailed.scenes.filter(s => s.sceneId !== sceneId))
  }

  const handleAIGenerate = async () => {
    try {
      setExpanded(true)
      await generateScenes()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '场景细纲生成失败，请重试。')
    }
  }

  const handleEnhancedGenerate = async () => {
    try {
      setExpanded(true)
      await generateEnhanced()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '增强细纲生成失败，请重试。')
    }
  }

  const totalWords = scenes.reduce((s, sc) => s + (sc.estimatedWords || 0), 0)

  const handleAdoptWorkshop = async (raw: string): Promise<boolean> => {
    const result = await adoptChapterOutlineWorkshopResult({
      raw,
      projectId,
      outlineNodeId,
      chapterSummary,
      validCharacterIds: new Set(
        characters.map(character => character.id).filter((id): id is number => id != null),
      ),
      validForeshadowIds: new Set(
        foreshadows.map(item => item.id).filter((id): id is number => id != null),
      ),
    })
    if (!result.ok) {
      toast.error(`采纳失败：${result.reason}`)
      return false
    }
    await loadAll(projectId)
    toast.success(`已采纳 ${result.sceneCount} 个场景和 ${result.prohibitionCount} 条不可写约束`)
    return true
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* 折叠头 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-bg-elevated hover:bg-bg-hover transition-colors text-left"
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
        <span className="text-sm font-medium text-text-primary">场景细纲</span>
        {hasScenes && (
          <span className="text-xs text-text-muted">
            {scenes.length} 个场景 · 约 {totalWords.toLocaleString()} 字
          </span>
        )}
        <div className="flex-1" />
        <span onClick={e => { e.stopPropagation(); addScene() }}
          className="p-1 text-text-muted hover:text-accent rounded" title="添加场景">
          <Plus className="w-3.5 h-3.5" />
        </span>
        <span onClick={e => { e.stopPropagation(); handleAIGenerate() }}
          className={`p-1 text-text-muted hover:text-accent rounded ${isRecovering || ai.isStreaming || enhanceAI.isStreaming || pendingCandidate ? 'opacity-50 pointer-events-none' : ''}`}
          title="AI 一键拆场景">
          <Sparkles className="w-3.5 h-3.5" />
        </span>
        <span
          onClick={event => {
            event.stopPropagation()
            setExpanded(true)
            setShowWorkshop(value => !value)
          }}
          className="p-1 text-text-muted hover:text-purple-500 rounded"
          title="五阶段章纲工坊"
        >
          <Wand2 className="w-3.5 h-3.5" />
        </span>
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="p-3 space-y-3 bg-bg-surface">
          {showWorkshop && chapterNode && (
            <ChapterOutlineWorkshop
              key={chapterNode.id}
              project={project}
              chapter={chapterNode}
              nodes={nodes}
              characters={characters}
              onAdopt={handleAdoptWorkshop}
              onClose={() => setShowWorkshop(false)}
            />
          )}

          {detailed?.prohibitions && detailed.prohibitions.length > 0 && (
            <div className="rounded border border-warning/30 bg-warning/10 p-2 text-[11px] text-text-secondary">
              <span className="font-medium text-warning">不可写清单：</span>
              {detailed.prohibitions.join('；')}
            </div>
          )}
          {/* AI 输出 */}
          {(ai.output || ai.isStreaming || ai.error) && (
            <div>
              <AIStreamOutput
                output={ai.output} isStreaming={ai.isStreaming} error={ai.error} tokenUsage={ai.tokenUsage}
                editable
                onStop={ai.stop}
                onAccept={async (text) => {
                  try {
                    if (await acceptCandidate('scenes', text)) toast.success('已采纳场景细纲')
                  } catch (err) {
                    console.error('[ScenePanel] 采纳失败:', err)
                    toast.error(err instanceof Error ? err.message : '采纳场景失败，请重试')
                  }
                }}
                onDismiss={() => { void dismissCandidate('scenes') }}
                onRetry={handleAIGenerate}
              />
              {pendingCandidate?.candidate.operation === 'scenes'
                && pendingCandidate.candidate.creativeArtifact && (
                <CreativeArtifactSummary
                  artifact={pendingCandidate.candidate.creativeArtifact}
                  narrativeBrief={pendingCandidate.candidate.narrativeBrief}
                />
              )}
            </div>
          )}

          {(enhanceAI.output || enhanceAI.isStreaming || enhanceAI.error) && (
            <div>
              <AIStreamOutput
                output={enhanceAI.output}
                isStreaming={enhanceAI.isStreaming}
                error={enhanceAI.error}
                tokenUsage={enhanceAI.tokenUsage}
                editable
                onStop={enhanceAI.stop}
                onAccept={async text => {
                  try {
                    if (await acceptCandidate('enhanced', text)) toast.success('已采纳增强细纲')
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : '采纳增强细纲失败，请重试')
                  }
                }}
                onDismiss={() => { void dismissCandidate('enhanced') }}
                onRetry={handleEnhancedGenerate}
              />
              {pendingCandidate?.candidate.operation === 'enhanced'
                && pendingCandidate.candidate.creativeArtifact && (
                <CreativeArtifactSummary
                  artifact={pendingCandidate.candidate.creativeArtifact}
                  narrativeBrief={pendingCandidate.candidate.narrativeBrief}
                />
              )}
            </div>
          )}

          {/* 场景列表 */}
          {scenes.length === 0 ? (
            <div className="text-center py-6 text-text-muted text-xs">
              还没有场景。点「+」或「✨」开始。
            </div>
          ) : (
            scenes.map((s, idx) => (
              <div key={s.sceneId} className="bg-bg-base border border-border rounded-lg p-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-text-muted text-xs">#{idx + 1}</span>
                  <input
                    value={s.title}
                    onChange={e => updateScene(s.sceneId, { title: e.target.value })}
                    placeholder="场景标题..."
                    className="flex-1 px-2 py-1 bg-transparent border border-border rounded text-xs font-medium text-text-primary focus:outline-none focus:border-accent"
                  />
                  <select
                    value={s.pace}
                    onChange={e => updateScene(s.sceneId, { pace: e.target.value as ScenePace })}
                    className={`px-1.5 py-0.5 text-[10px] rounded border-0 ${PACE_COLORS[s.pace]}`}
                  >
                    {Object.entries(PACE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={s.estimatedWords || ''}
                    onChange={e => updateScene(s.sceneId, { estimatedWords: parseInt(e.target.value) || 0 })}
                    placeholder="字数"
                    className="w-16 px-1.5 py-0.5 bg-transparent border border-border rounded text-[10px] text-text-primary focus:outline-none focus:border-accent"
                  />
                  <button onClick={() => deleteScene(s.sceneId)} className="p-0.5 text-text-muted hover:text-error">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <textarea
                  value={s.summary}
                  onChange={e => updateScene(s.sceneId, { summary: e.target.value })}
                  placeholder="一句话场景概要..."
                  rows={1}
                  className="w-full px-2 py-1 bg-transparent border border-border rounded text-xs text-text-primary resize-none focus:outline-none focus:border-accent"
                />
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    value={s.location}
                    onChange={e => updateScene(s.sceneId, { location: e.target.value })}
                    placeholder="📍 地点"
                    className="px-2 py-0.5 bg-transparent border border-border rounded text-[10px] text-text-primary focus:outline-none focus:border-accent"
                  />
                  <input
                    value={s.conflict}
                    onChange={e => updateScene(s.sceneId, { conflict: e.target.value })}
                    placeholder="⚔ 核心冲突"
                    className="px-2 py-0.5 bg-transparent border border-border rounded text-[10px] text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                {s.notes && (
                  <textarea
                    value={s.notes}
                    onChange={e => updateScene(s.sceneId, { notes: e.target.value })}
                    placeholder="备注 / AI 建议..."
                    rows={2}
                    className="w-full px-2 py-1 bg-transparent border border-border rounded text-[10px] text-text-muted resize-y focus:outline-none focus:border-accent"
                  />
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
