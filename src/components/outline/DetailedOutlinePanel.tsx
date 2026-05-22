import { useState, useEffect, useMemo } from 'react'
import { Plus, Trash2, Sparkles, ChevronRight } from 'lucide-react'
import { useOutlineStore } from '../../stores/outline'
import { useDetailedOutlineStore } from '../../stores/detailed-outline'
import { useWorldviewStore } from '../../stores/worldview'
import { useCharacterStore } from '../../stores/character'
import { useAIStream } from '../../hooks/useAIStream'
import { buildDetailSceneGeneratePrompt } from '../../lib/ai/adapters/detail-scene-adapter'
import { buildWorldContext, buildCharacterContext } from '../../lib/ai/context-builder'
import AIStreamOutput from '../shared/AIStreamOutput'
import { nanoid } from '../../lib/utils/id'
import type { Project, DetailedScene, ScenePace } from '../../lib/types'

interface Props {
  project: Project
}

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

/** v3 §2.1 — 创作区.细纲（场景拆分 + AI） */
export default function DetailedOutlinePanel({ project }: Props) {
  const { nodes, loadAll: loadOutline } = useOutlineStore()
  const { detailedOutlines, loadAll: loadDetailed, getOrCreate, save } = useDetailedOutlineStore()
  const { worldview, storyCore } = useWorldviewStore()
  const { characters } = useCharacterStore()
  const ai = useAIStream()

  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)

  useEffect(() => {
    loadOutline(project.id!)
    loadDetailed(project.id!)
  }, [project.id, loadOutline, loadDetailed])

  // 章节节点列表（按 order 排序）
  const chapterNodes = useMemo(() =>
    nodes.filter(n => n.type === 'chapter').sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [nodes],
  )

  // 当前选中章节的细纲
  const currentChapter = chapterNodes.find(n => n.id === selectedNodeId)
  const currentDetailed = detailedOutlines.find(d => d.outlineNodeId === selectedNodeId)

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

  const handleAIGenerate = () => {
    if (!currentChapter) return
    const messages = buildDetailSceneGeneratePrompt(
      currentChapter.title,
      currentChapter.summary || '',
      buildWorldContext(worldview, storyCore, null),
      buildCharacterContext(characters.filter(c => c.role === 'protagonist' || c.role === 'supporting')),
      '',
    )
    ai.start(messages)
  }

  const totalWords = currentDetailed?.scenes.reduce((s, sc) => s + (sc.estimatedWords || 0), 0) ?? 0

  return (
    <div className="h-full flex">
      {/* 左侧：章节选择 */}
      <div className="w-64 flex-shrink-0 border-r border-border overflow-y-auto p-3">
        <h3 className="text-sm font-semibold text-text-primary mb-2 px-2">📖 选择章节</h3>
        {chapterNodes.length === 0 ? (
          <div className="text-xs text-text-muted px-2 py-4">
            还没有章节节点。先去「大纲」里建几章。
          </div>
        ) : (
          <div className="space-y-0.5">
            {chapterNodes.map(n => {
              const has = detailedOutlines.some(d => d.outlineNodeId === n.id)
              const active = selectedNodeId === n.id
              return (
                <button
                  key={n.id}
                  onClick={() => setSelectedNodeId(n.id!)}
                  className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-sm rounded transition-colors ${
                    active ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  <ChevronRight className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate flex-1">{n.title}</span>
                  {has && <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" title="有细纲" />}
                </button>
              )
            })}
          </div>
        )}
      </div>

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
                disabled={ai.isStreaming}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 text-accent text-sm rounded hover:bg-accent/20 disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" /> AI 一键拆场景
              </button>
            </div>

            {/* AI 输出 */}
            {(ai.output || ai.isStreaming || ai.error) && (
              <div className="mb-4">
                <AIStreamOutput
                  output={ai.output} isStreaming={ai.isStreaming} error={ai.error} tokenUsage={ai.tokenUsage}
                  onStop={ai.stop}
                  onAccept={async (text) => {
                    // AI 输出粘贴到第一个场景的备注里，让用户参考着手动拆
                    // 后续 P10 可以做结构化解析
                    try {
                      if (!currentDetailed || currentDetailed.scenes.length === 0) {
                        await addScene()
                        // addScene 后必须从 store 取最新状态，不能用闭包里的旧 currentDetailed
                        const fresh = useDetailedOutlineStore.getState().detailedOutlines.find(d => d.outlineNodeId === currentChapter.id)
                        if (fresh && fresh.scenes[0]) {
                          await updateScenes(fresh.scenes.map((s, i) =>
                            i === 0 ? { ...s, notes: text } : s
                          ))
                        }
                      } else {
                        await updateScene(currentDetailed.scenes[0].sceneId, { notes: text })
                      }
                    } catch (err) {
                      console.error('[DetailedOutline] 采纳失败:', err)
                    }
                    ai.reset()
                  }}
                  onRetry={handleAIGenerate}
                />
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
                  <div key={s.sceneId} className="bg-bg-surface border border-border rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-text-muted text-xs">#{idx + 1}</span>
                      <input
                        value={s.title}
                        onChange={e => updateScene(s.sceneId, { title: e.target.value })}
                        placeholder="场景标题..."
                        className="flex-1 px-2 py-1 bg-bg-base border border-border rounded text-sm font-medium text-text-primary focus:outline-none focus:border-accent"
                      />
                      <select
                        value={s.pace}
                        onChange={e => updateScene(s.sceneId, { pace: e.target.value as ScenePace })}
                        className={`px-2 py-1 text-xs rounded border-0 ${PACE_COLORS[s.pace]}`}
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
                        className="w-20 px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                      />
                      <button
                        onClick={() => deleteScene(s.sceneId)}
                        className="p-1 text-text-muted hover:text-error"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <textarea
                      value={s.summary}
                      onChange={e => updateScene(s.sceneId, { summary: e.target.value })}
                      placeholder="一句话场景概要..."
                      rows={2}
                      className="w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary resize-none focus:outline-none focus:border-accent"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={s.location}
                        onChange={e => updateScene(s.sceneId, { location: e.target.value })}
                        placeholder="📍 地点"
                        className="px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                      />
                      <input
                        value={s.conflict}
                        onChange={e => updateScene(s.sceneId, { conflict: e.target.value })}
                        placeholder="⚔ 核心冲突"
                        className="px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                      />
                    </div>
                    {s.notes && (
                      <textarea
                        value={s.notes}
                        onChange={e => updateScene(s.sceneId, { notes: e.target.value })}
                        placeholder="备注 / AI 建议..."
                        rows={3}
                        className="w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-muted resize-y focus:outline-none focus:border-accent"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
