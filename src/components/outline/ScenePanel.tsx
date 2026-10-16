/**
 * 场景拆分面板 — 从 DetailedOutlinePanel 提取，可嵌入章节编辑页
 *
 * 展示并编辑某章节的细纲场景列表，支持 AI 一键拆场景。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Sparkles, ChevronDown, ChevronRight, Wand2 } from 'lucide-react'
import { useDetailedOutlineStore } from '../../stores/detailed-outline'
import { useOutlineStore } from '../../stores/outline'
import { useCharacterStore } from '../../stores/character'
import { useForeshadowStore } from '../../stores/foreshadow'
import AIStreamOutput from '../shared/AIStreamOutput'
import { nanoid } from '../../lib/utils/id'
import { useToast } from '../shared/Toast'
import type { DetailedScene, Project, WorkspaceScope } from '../../lib/types'
import ChapterOutlineWorkshop from './ChapterOutlineWorkshop'
import { adoptChapterOutlineWorkshopResult } from '../../lib/outline/adopt-workshop'
import { useDetailedOutlineGenerationController } from './useDetailedOutlineGenerationController'
import CreativeArtifactSummary from '../agent/CreativeArtifactSummary'
import DetailedSceneCard from './DetailedSceneCard'

interface Props {
  project: Project
  outlineNodeId: number
  chapterTitle: string
  chapterSummary: string
}

export default function ScenePanel({ project, outlineNodeId, chapterTitle, chapterSummary }: Props) {
  const projectId = project.id!
  const scope = useMemo<WorkspaceScope>(() => ({ projectId, worldId: project.activeWorldId!, workId: project.activeWorkId! }), [projectId, project.activeWorldId, project.activeWorkId])
  const { detailedOutlines, loadAll, getOrCreate, editScene } = useDetailedOutlineStore()
  const nodes = useOutlineStore(state => state.nodes)
  const { characters, loadAll: loadCharacters } = useCharacterStore()
  const { foreshadows, loadAll: loadForeshadows } = useForeshadowStore()
  const toast = useToast()
  const [expanded, setExpanded] = useState(false)
  const [showWorkshop, setShowWorkshop] = useState(false)

  useEffect(() => {
    void Promise.all([loadAll(scope), loadCharacters(scope), loadForeshadows(scope)]).catch(error => toast.error(error instanceof Error ? error.message : '场景资料读取失败'))
  }, [loadAll, loadCharacters, loadForeshadows, scope, toast])
  useEffect(() => { setShowWorkshop(false) }, [outlineNodeId])

  const detailed = detailedOutlines.find(d => d.workId === scope.workId && d.projectId === scope.projectId && d.outlineNodeId === outlineNodeId)
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
  const reloadDetailed = useCallback(() => loadAll(scope), [loadAll, scope])
  const {
    ai,
    enhanceAI,
    isRecovering,
    finalizingOperation,
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
    return await getOrCreate(scope, outlineNodeId)
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
    await editScene(dt.id!, { kind: 'add', scene: newScene }, scope, chapterSummary)
    setExpanded(true)
  }

  const updateScene = async (sceneId: string, patch: Partial<DetailedScene>) => {
    if (!detailed) throw new Error('当前作品的场景细纲尚未就绪')
    await editScene(detailed.id!, { kind: 'patch', sceneId, patch }, scope, chapterSummary)
  }

  const deleteScene = async (sceneId: string) => {
    if (!detailed) throw new Error('当前作品的场景细纲尚未就绪')
    await editScene(detailed.id!, { kind: 'remove', sceneId }, scope, chapterSummary)
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
          className={`p-1 text-text-muted hover:text-accent rounded ${isRecovering || finalizingOperation || ai.isStreaming || enhanceAI.isStreaming || pendingCandidate ? 'opacity-50 pointer-events-none' : ''}`}
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
                output={ai.output} isStreaming={ai.isStreaming} isFinalizing={finalizingOperation === 'scenes' && !ai.isStreaming} error={ai.error} tokenUsage={ai.tokenUsage}
                editable={pendingCandidate?.candidate.operation === 'scenes'}
                onStop={ai.stop}
                onAccept={pendingCandidate?.candidate.operation === 'scenes' ? async (text) => {
                  try {
                    if (await acceptCandidate('scenes', text)) toast.success('已采纳场景细纲')
                  } catch (err) {
                    console.error('[ScenePanel] 采纳失败:', err)
                    toast.error(err instanceof Error ? err.message : '采纳场景失败，请重试')
                  }
                } : undefined}
                onDismiss={pendingCandidate?.candidate.operation === 'scenes'
                  ? () => { void dismissCandidate('scenes') }
                  : undefined}
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
                isFinalizing={finalizingOperation === 'enhanced' && !enhanceAI.isStreaming}
                error={enhanceAI.error}
                tokenUsage={enhanceAI.tokenUsage}
                editable={pendingCandidate?.candidate.operation === 'enhanced'}
                onStop={enhanceAI.stop}
                onAccept={pendingCandidate?.candidate.operation === 'enhanced' ? async text => {
                  try {
                    if (await acceptCandidate('enhanced', text)) toast.success('已采纳增强细纲')
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : '采纳增强细纲失败，请重试')
                  }
                } : undefined}
                onDismiss={pendingCandidate?.candidate.operation === 'enhanced'
                  ? () => { void dismissCandidate('enhanced') }
                  : undefined}
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
            scenes.map((scene, index) => (
              <DetailedSceneCard key={scene.sceneId} scene={scene} index={index}
                onUpdate={patch => updateScene(scene.sceneId, patch)}
                onDelete={() => { void deleteScene(scene.sceneId).catch(error => toast.error(error instanceof Error ? error.message : '场景删除失败')) }} />
            ))
          )}
        </div>
      )}
    </div>
  )
}
